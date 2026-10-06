"""S4 Archetype construction (methodology §6.3, §14). Phase-1 S6.

Every archetype is a combination of 4 to 6 attribute values (Sai, 2026-10-01), mixing the three tiers:
  Tier 1 universal look/physical (material, colour tone/family, size), Tier 2 functional (node-specific type and
  features), Tier 3 lifestyle (style, vibe, node-specific theme/pattern/audience). Price band is NOT an attribute:
  price is analysed separately (price-band coverage, archetype price ladder, PPG and PPR).

  1. Candidates: the node's facet list per tier (config) plus "gap facets" (credible value-level gaps of the
     multi-label tags where the competitor carries more, e.g. "Water-resistant: yes / not stated"; Sai 2026-10-03),
     minus fields that failed
     validation (G2) or are unknown for more than `max_unknown_share` of either retailer.
     A gap facet that repeats a node attribute (its name, or a value of a single-value attribute: "water-resistant",
     "men") is dropped; tags named in gap_facets.merge_into fold into that attribute instead (men + women ->
     "Audience: men & women"); at most one gap facet per source tag list sits in one combination (Sai 2026-10-04).
  2. Attribute sets ("lenses", Sai 2026-10-04): every 4-facet combination (with at least tier_min facets from each
     tier) is scored = balanced share of both retailers' families in supported cells + entropy_weight x mean entropy
     + divergence_weight x mean JSD between Staples and the competitor (Sai 2026-10-03: prefer attributes on which
     the two assortments differ). Up to lenses.max_per_node sets are kept, best first, each differing from every
     kept set by >= lenses.min_new_facets attributes and scoring >= lenses.min_score_ratio x the best. Each set cuts
     the node into its own archetypes, so a family belongs to one archetype per set.
  3. Refinement: a 5th, then 6th facet splits a cell only when >= 2 children are supported and the rest of the cell
     (other values or not stated) is itself supported or empty; that rest keeps the cell as "<facet>: other".
  4. Families outside every supported cell of every set form the node's long tail (reported, not scored). A node listed in
     relaxed_nodes.json (fewer than gates.final.min_per_node gate-passing recommendations on the first pass; written
     by run_pipeline) uses the smaller pooled bar archetypes.small_node.min_pooled.
  5. Cross-check against UMAP + HDBSCAN clusters of the source-neutral card (ARI/AMI, bootstrap stability).
"""
from __future__ import annotations

import itertools
import json
import re
import warnings

import numpy as np
import pandas as pd
from sklearn.cluster import HDBSCAN
from sklearn.metrics import adjusted_mutual_info_score, adjusted_rand_score

from . import embed
from .cards import neutral_card, tier2_attrs, tier3_attrs
from .common import (cfg, interim, jsd, load, load_json, log, money, nice_breaks, node_config, prob_greater, save,
                     save_json, smoothed_dist, split_multi)

TIERS = ("tier1", "tier2", "tier3")
UNIVERSAL_T1 = ["material_class", "colour_tone", "colour_family", "size_class"]
UNIVERSAL_T3 = ["style_family", "vibe"]
FACET_LABELS = {"material_class": "Material", "colour_tone": "Colour tone", "colour_family": "Colour",
                "size_class": "Size", "style_family": "Style", "vibe": "Vibe"}
SKIP_WORDS = {"no", "other", "plain", "none", "general", "solid", ""}
GAP_PREFIX = "gap__"
RELAXED_FILE = "relaxed_nodes.json"


def relaxed_nodes() -> list[str]:
    f = interim(RELAXED_FILE)
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


def write_relaxed_nodes(nids: list[str]) -> None:
    interim(RELAXED_FILE).write_text(json.dumps(sorted(nids)), encoding="utf-8")


def is_gap_facet(f: str) -> bool:
    return str(f).startswith(GAP_PREFIX)


def gap_parts(f: str) -> tuple[str, str]:
    """'gap__key_benefits__water-resistant' -> ('key_benefits', 'water-resistant')"""
    _, attr, val = f.split("__", 2)
    return attr, val


# ----------------------------------------------------------------------------- price bands (price insights only)
def price_bands(prices: pd.Series, n: int) -> tuple[list[float], list[str]]:
    qs = prices.dropna().quantile([i / n for i in range(1, n)]).tolist()
    br = nice_breaks(qs)
    labels, lo = [], 0
    for b in br:
        labels.append(f"{money(lo)}–{money(b)}" if lo else f"under {money(b)}")
        lo = b
    labels.append(f"{money(lo)}+")
    return br, labels


def assign_band(p, br, labels):
    if p is None or np.isnan(p):
        return None
    return labels[int(np.searchsorted(br, p, side="right"))]


# ----------------------------------------------------------------------------- facet candidates
def _norm_entropy(s: pd.Series) -> float:
    vc = s.dropna().value_counts()
    if len(vc) < 2:
        return 0.0
    p = vc / vc.sum()
    return float(-(p * np.log(p)).sum() / np.log(len(p)))


def facet_jsd(df: pd.DataFrame, f: str, comp: str) -> float:
    """JSD between the Staples and competitor value mixes (known values, Jeffreys-smoothed), as in the report."""
    s, cpt = df.loc[df["retailer"] == "staples", f].dropna(), df.loc[df["retailer"] == comp, f].dropna()
    if not len(s) or not len(cpt):
        return 0.0
    support = sorted(set(s) | set(cpt))
    return jsd(smoothed_dist(s.value_counts(), support), smoothed_dist(cpt.value_counts(), support))


def _norm_word(x) -> str:
    return re.sub(r"[\s_\-/&']+", " ", str(x).lower()).strip()


def node_vocab(nid: str) -> dict:
    """{attribute: {"values": [...], "default": ...}} for the node's own single-value attributes (tier 2 / tier 3)."""
    nc = node_config(nid)
    out = {}
    for t in ("tier2", "tier3"):
        for a, spec in (nc.get(t) or {}).items():
            if isinstance(spec, dict) and spec.get("mode", "priority") != "multi":
                out[a] = {"values": list((spec.get("values") or {}).keys()), "default": spec.get("default")}
    return out


def redundant_with(nid: str, value: str) -> str | None:
    """The node attribute a tag value repeats (same name, or a value of a single-value attribute), else None."""
    v = _norm_word(value)
    facets = {f for fl in facet_tiers(nid).values() for f in fl}
    for f in sorted(facets):
        if _norm_word(f) == v:
            return f
    for a, spec in node_vocab(nid).items():
        if a in facets and v in {_norm_word(x) for x in spec["values"]}:
            return a
    return None


def merge_tags_into(df: pd.DataFrame, nid: str, c: dict) -> dict:
    """gap_facets.merge_into {tag list: attribute}: tag values that are values of the attribute fold into it, e.g.
    end_user_segment {men, women} -> audience "men & women"; a default ("general") takes a single tag value.
    -> {attribute: number of families changed}"""
    out = {}
    for tag_attr, attr in ((c.get("gap_facets") or {}).get("merge_into") or {}).items():
        spec = node_vocab(nid).get(attr)
        if not spec or tag_attr not in df.columns or attr not in df.columns:
            continue
        allowed = {_norm_word(x): x for x in spec["values"]}
        order = [_norm_word(x) for x in spec["values"]]

        def merged(row):
            tags = sorted({allowed[_norm_word(t)] for t in split_multi(row[tag_attr]) if _norm_word(t) in allowed},
                          key=lambda x: order.index(_norm_word(x)))
            cur = row[attr]
            if len(tags) >= 2:
                return " & ".join(tags)
            if tags and (pd.isna(cur) or cur == spec["default"]):
                return tags[0]
            return cur
        new = df.apply(merged, axis=1)
        out[attr] = int((new.fillna("") != df[attr].fillna("")).sum())
        df[attr] = new
    return out


def gap_facets(df: pd.DataFrame, comp: str, c: dict, rng: np.random.Generator, nid: str = ""
               ) -> tuple[dict, list, list, list]:
    """Credible value-level gaps of the multi-label tags where the competitor carries more -> yes / no columns
    usable as archetype facets. Values that repeat a node attribute are skipped (Sai 2026-10-04).
    -> ({column: Series}, [(column, tier)], [info rows], [skipped rows])"""
    g = c.get("gap_facets") or {}
    S, C = df[df["retailer"] == "staples"], df[df["retailer"] == comp]
    NS, NC = len(S), len(C)
    if not g or not NS or not NC:
        return {}, [], [], []
    rows, skipped = [], []
    for attr, tier in (g.get("tiers") or {}).items():
        if attr not in df.columns:
            continue
        tags = df[attr].map(split_multi)
        vals = sorted({t for ts in tags for t in ts})
        for t in vals:
            rep = redundant_with(nid, t) if nid else None
            if rep:
                skipped.append({"attribute": attr, "value": t, "repeats": rep})
                continue
            has = tags.map(lambda ts, t=t: t in ts)
            ks, kc = int(has[S.index].sum()), int(has[C.index].sum())
            ss, sc = ks / NS, kc / NC
            cred = prob_greater(kc, NC, ks, NS, cfg()["gaps"]["mc_draws"], rng)
            if cred >= g["min_credibility"] and sc >= g["min_share"]:     # competitor carries more
                rows.append({"facet": f"{GAP_PREFIX}{attr}__{t}", "attribute": attr, "value": t, "tier": tier,
                             "share_staples": ss, "share_competitor": sc, "credibility": cred, "diff": sc - ss,
                             "has": has})
    rows.sort(key=lambda r: -abs(r["diff"]))
    rows = rows[: g.get("max_per_node", 4)]
    cols = {r["facet"]: r.pop("has").map({True: "yes", False: "no"}) for r in rows}
    return cols, [(r["facet"], r["tier"]) for r in rows], rows, skipped


def facet_tiers(nid: str) -> dict:
    af = node_config(nid).get("archetype_facets")
    if af:
        return {t: list(af.get(t) or []) for t in TIERS}
    return {"tier1": UNIVERSAL_T1[:2], "tier2": tier2_attrs(nid), "tier3": UNIVERSAL_T3 + tier3_attrs(nid)}


def facet_candidates(df: pd.DataFrame, nid: str, fails: set, c: dict, comp: str, extra: list | None = None):
    cands, scores = [], []
    tiers = facet_tiers(nid)
    for f, tier in extra or []:
        tiers[tier] = tiers.get(tier, []) + [f]
    for tier, fl in tiers.items():
        for f in fl:
            if f not in df.columns:
                scores.append({"facet": f, "tier": tier, "eligible": False, "reason": "not extracted"})
                continue
            unk = {r: float(df.loc[df["retailer"] == r, f].isna().mean()) for r in ("staples", comp)}
            ent = _norm_entropy(df[f])
            vc = df[f].dropna().value_counts(normalize=True)
            dom = float(vc.iloc[0]) if len(vc) else 1.0
            reason = ("failed validation (G2)" if f in fails else
                      f"unknown > {c['max_unknown_share']:.0%}" if max(unk.values()) > c["max_unknown_share"] else
                      "one value only" if df[f].nunique() < 2 or ent <= 0.05 else
                      f"one value covers {dom:.0%}" if dom > c["max_dominant_share"] else "")
            scores.append({"facet": f, "tier": tier, "entropy": ent, "unknown": unk, "dominant_share": dom,
                           "jsd": facet_jsd(df, f, comp), "gap_facet": is_gap_facet(f),
                           "eligible": not reason, "reason": reason})
            if not reason:
                cands.append((f, tier))
    need = c["core_facets"] - len(cands)
    if need > 0 and c.get("admit_near_misses"):
        rank = {"one value covers": 0, "unknown": 1, "failed validation": 2}
        miss = [sc for sc in scores if not sc["eligible"] and any(sc["reason"].startswith(k) for k in rank)]
        miss.sort(key=lambda sc: (next(v for k, v in rank.items() if sc["reason"].startswith(k)), -sc.get("entropy", 0)))
        for sc in miss[:need]:
            sc["admitted"] = True
            cands.append((sc["facet"], sc["tier"]))
    return cands, scores


# ----------------------------------------------------------------------------- grid
def _supported(stats: pd.DataFrame, c: dict) -> pd.Series:
    return (stats["n"] >= c["min_pooled"]) & ((stats["nc"] >= c["_min_c"]) | (stats["ns"] >= c["_min_s"]))


def cell_stats(df: pd.DataFrame, idx: pd.Index, facets: list[str], comp: str) -> tuple[pd.Series, pd.DataFrame]:
    sub = df.loc[idx, facets]
    sub = sub[sub.notna().all(axis=1)]
    key = sub.astype(str).agg("||".join, axis=1) if len(sub) else pd.Series(dtype=object)
    is_c = (df.loc[key.index, "retailer"] == comp).astype(int)
    stats = pd.DataFrame({"key": key, "c": is_c}).groupby("key").agg(n=("c", "size"), nc=("c", "sum"))
    stats["ns"] = stats["n"] - stats["nc"]
    return key, stats


def balanced_coverage(df: pd.DataFrame, facets: list[str], c: dict, comp: str) -> float:
    key, stats = cell_stats(df, df.index, facets, comp)
    if stats.empty:
        return 0.0
    hit = key[key.isin(stats[_supported(stats, c)].index)].index
    r = df.loc[hit, "retailer"]
    ns, nc = (df["retailer"] == "staples").sum(), (df["retailer"] == comp).sum()
    return 0.5 * ((r == "staples").sum() / max(ns, 1) + (r == comp).sum() / max(nc, 1))


def _combo_ok(fs: list[str], c: dict, type_facets: list[str]) -> bool:
    if any(sum(f in grp for f in fs) > 1 for grp in c.get("exclusive_facets") or []):
        return False
    return not type_facets or any(f in type_facets for f in fs)


def choose_lenses(df: pd.DataFrame, cands: list[tuple], c: dict, comp: str, type_facets: list[str]):
    """-> ([(combo, score), ...] best first, tiers relaxed). Up to lenses.max_per_node attribute sets, each
    differing from every kept set by >= min_new_facets attributes and scoring >= min_score_ratio x the best."""
    lc = c.get("lenses") or {}
    scored, relaxed = choose_core(df, cands, c, comp, type_facets, keep_all=True)
    # attributes that carry the same information (configured exclusive pairs such as colour tone / colour family,
    # and near-duplicate gap facets) count as one attribute when sets are compared
    root = {}

    def find(f):
        while root.get(f, f) != f:
            f = root[f]
        return f
    for grp in c.get("_same_info") or []:
        for f in grp[1:]:
            root[find(f)] = find(grp[0])
    key = lambda combo: {find(f) for f, _ in combo}
    kept = []
    # first sets that differ by >= min_new_facets concepts; if a small node cannot fill max_per_node that way,
    # sets that differ by fallback_min_new_facets (Sai 2026-10-04)
    for need in dict.fromkeys([lc.get("min_new_facets", 2), lc.get("fallback_min_new_facets", lc.get("min_new_facets", 2))]):
        for combo, score in scored:
            if len(kept) >= lc.get("max_per_node", 1):
                break
            if kept and score < lc.get("min_score_ratio", 0.8) * kept[0][1]:
                break
            if any(combo == k for k, _ in kept):
                continue
            if all(len(key(combo) - key(k)) >= need for k, _ in kept):
                kept.append((combo, score))
    return kept, relaxed


def choose_core(df: pd.DataFrame, cands: list[tuple], c: dict, comp: str, type_facets: list[str],
                keep_all: bool = False):
    ent = {f: _norm_entropy(df[f]) for f, _ in cands}
    div = {f: facet_jsd(df, f, comp) for f, _ in cands}
    type_facets = [f for f in type_facets if f in ent] if c.get("require_type_facet") else []
    k = min(c["core_facets"], len(cands))
    mins = dict(c["tier_min"])
    # a tier with no usable facet cannot be represented: relax it first, then others only if still infeasible
    relaxed = [t for t in TIERS if mins.get(t, 0) and not any(tt == t for _, tt in cands)]
    for t in relaxed:
        mins[t] = 0
    for drop in [None, "tier3", "tier2", "tier1"]:
        if drop:
            if not mins.get(drop):
                continue
            mins[drop] = 0
            relaxed.append(drop)
        best, all_scored = None, []
        for combo in itertools.combinations(cands, k):
            counts = {t: sum(1 for _, tt in combo if tt == t) for t in TIERS}
            if any(counts[t] < mins.get(t, 0) for t in TIERS):
                continue
            fs = [f for f, _ in combo]
            if not _combo_ok(fs, c, type_facets):
                continue
            score = (balanced_coverage(df, fs, c, comp) + c["entropy_weight"] * np.mean([ent[f] for f in fs])
                     + c.get("divergence_weight", 0.0) * np.mean([div[f] for f in fs]))
            all_scored.append((list(combo), float(score)))
            if best is None or score > best[0]:
                best = (score, combo)
        if best is not None:
            if keep_all:
                return sorted(all_scored, key=lambda x: -x[1]), relaxed
            return list(best[1]), best[0], relaxed
    return ([], relaxed) if keep_all else ([], 0.0, relaxed)


def build_grid(df: pd.DataFrame, core: list[tuple], rest: list[tuple], c: dict, comp: str):
    """-> {cell_id: {"facets": [(facet, value), ...], "members": Index}}, long-tail Index, refinement facets used."""
    fs = [f for f, _ in core]
    key, stats = cell_stats(df, df.index, fs, comp)
    good = stats[_supported(stats, c)].index
    cells = {}
    for kv in good:
        vals = kv.split("||")
        cells[kv] = {"facets": list(zip(fs, vals)), "members": key[key == kv].index}
    tail = df.index.difference(key[key.isin(good)].index)
    used = []
    remaining = list(rest)
    for _depth in range(len(fs) + 1, c["max_facets"] + 1):
        best = None
        for f, tier in remaining:
            if any(f in grp and any(x in grp for x, _ in core + used) for grp in c.get("exclusive_facets") or []):
                continue
            moved, plan = 0, {}
            for cid, cell in cells.items():
                if len(cell["facets"]) != len(fs) + len(used) or f in [x for x, _ in cell["facets"]]:
                    continue
                m = cell["members"]
                ck, cs = cell_stats(df, m, [f], comp)
                sup = cs[_supported(cs, c)].index
                if len(sup) < 2:
                    continue
                inside = ck[ck.isin(sup)].index
                resid = m.difference(inside)
                if len(resid):
                    rn = len(resid)
                    rc = int((df.loc[resid, "retailer"] == comp).sum())
                    if not (rn >= c["min_pooled"] and (rc >= c["_min_c"] or rn - rc >= c["_min_s"])):
                        continue
                plan[cid] = (ck, sup, resid)
                moved += len(inside)
            n_after = len(cells) + sum(len(sup) - 1 + (1 if len(resid) else 0) for _, sup, resid in plan.values())
            if moved and n_after <= c["max_archetypes"] and (best is None or moved > best[0]):
                best = (moved, f, tier, plan)
        if best is None:
            break
        _, f, tier, plan = best
        for cid, (ck, sup, resid) in plan.items():
            parent = cells.pop(cid)
            for v in sup:
                cells[f"{cid}||{f}={v}"] = {"facets": parent["facets"] + [(f, v)], "members": ck[ck == v].index}
            if len(resid):
                cells[f"{cid}||{f}=other"] = {"facets": parent["facets"] + [(f, "other")], "members": resid}
        used.append((f, tier))
        remaining = [x for x in remaining if x[0] != f]
    return cells, tail, used


# ----------------------------------------------------------------------------- naming
def pretty_value(v) -> str:
    """Merchant-readable value. Yes/no features are 'mentioned' measures, so 'no' reads 'not stated'."""
    v = str(v)
    if v == "no":
        return "not stated"
    if v == "other":
        return "other (mixed)"
    v = re.sub(r"^([a-z])_", lambda mt: mt.group(1).upper() + "-", v)
    return v.replace("_", " ")


def facet_label(nid: str, f: str) -> str:
    if is_gap_facet(f):
        v = gap_parts(f)[1]
        return v[:1].upper() + v[1:]
    return (node_config(nid).get("facet_labels") or {}).get(f) or FACET_LABELS.get(f) or f.replace("_", " ").capitalize()


def _word(nid: str, f: str, v: str) -> str:
    if is_gap_facet(f):
        return gap_parts(f)[1] if v == "yes" else ""
    labels = (node_config(nid).get("labels") or {}).get(f) or {}
    if v in labels:
        return labels[v]
    if v == "yes":
        return f"with {facet_label(nid, f).lower()}"
    if v in SKIP_WORDS or f in ("colour_tone", "colour_family"):
        return ""
    return pretty_value(v)


def _stated(nid: str, f: str, v: str) -> bool:
    """False for values that say nothing: a yes/no or gap attribute at "no" (= not stated) or a default value with an
    empty name label (e.g. "Audience: general")."""
    if str(v) == "no":
        return False
    return ((node_config(nid).get("labels") or {}).get(f) or {}).get(v, None) != ""


def archetype_name(nid: str, fv: list[tuple], merged: dict | None = None) -> tuple[str, str, str]:
    """-> (short merchant name, stated attribute combo, full attribute combo). The report shows 'Name (combo)'; the
    full combo (with "not stated" values) is in the tooltip and the method tables (Sai 2026-10-04).
    merged = {facet: (name word, shown value)} for a final pick that folds variants one attribute apart (S7)."""
    merged = merged or {}
    nc = node_config(nid)
    d = dict(fv)
    order = [f for f, _ in fv if is_gap_facet(f)] + (nc.get("name_order") or [f for f, _ in fv if not is_gap_facet(f)])
    words, seen = [], set()
    for f in dict.fromkeys(order):                 # a facet once, a word once (no "Women women ... backpack")
        if f not in d:
            continue
        w = merged[f][0] if f in merged else _word(nid, f, d[f])
        toks = set(re.findall(r"[a-z0-9]+", w.lower()))
        if not w or (toks and toks <= seen):
            continue
        seen |= toks
        words.append(w)
    # a word whose tokens all appear in the other words is dropped ("Outdoor hiking/outdoor backpack")
    tok = lambda w: set(re.findall(r"[a-z0-9]+", w.lower()))
    for w in list(words):
        rest = set().union(*[tok(x) for x in words if x is not w]) if len(words) > 1 else set()
        if tok(w) and tok(w) <= rest:
            words.remove(w)
    words = words[:4]
    noun = nc.get("noun", "")
    noun_tokens = set(re.findall(r"[a-z]+", noun.lower()))
    last = words[-1].lower() if words else ""
    if noun and not any(last.endswith(t) for t in noun_tokens):
        words.append(noun)
    name = " ".join(words).strip() or noun or "Archetype"
    name = name[0].upper() + name[1:]
    shown = lambda f, v: merged[f][1] if f in merged else pretty_value(v)
    full = " · ".join(f"{facet_label(nid, f)}: {shown(f, v)}" for f, v in fv)
    combo = " · ".join(f"{facet_label(nid, f)}: {shown(f, v)}" for f, v in fv if f in merged or _stated(nid, f, v))
    return name, combo, full


# ----------------------------------------------------------------------------- validation
def validate(E: np.ndarray, labels: np.ndarray, c: dict, rng: np.random.Generator) -> dict:
    n = len(E)
    if n < 60 or len(set(labels)) < 2:
        return {"ari": None, "ami": None, "stability": None, "n_clusters": None, "noise_share": None}
    import umap
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        Z = umap.UMAP(n_neighbors=15, min_dist=0.0, n_components=c["umap_components"], random_state=42).fit_transform(E)
    mcs = max(8, n // 30)
    hl = HDBSCAN(min_cluster_size=mcs, cluster_selection_method="leaf").fit_predict(Z)
    keep = hl >= 0
    ari = adjusted_rand_score(labels[keep], hl[keep]) if keep.sum() > 10 else np.nan
    ami = adjusted_mutual_info_score(labels[keep], hl[keep]) if keep.sum() > 10 else np.nan
    boots = []
    for _ in range(c["bootstrap"]):
        idx = rng.choice(n, int(0.8 * n), replace=False)
        hb = HDBSCAN(min_cluster_size=mcs, cluster_selection_method="leaf").fit_predict(Z[idx])
        k = hb >= 0
        if k.sum() > 10:
            boots.append(adjusted_rand_score(labels[idx][k], hb[k]))
    return {"ari": float(ari), "ami": float(ami), "stability": float(np.mean(boots)) if boots else None,
            "n_clusters": int(hl.max() + 1), "noise_share": float((~keep).mean())}


def run() -> dict:
    c = cfg()["archetypes"]
    att = load("attributes.parquet")
    fam = load("families.parquet")[["family_id", "title", "title_clean", "brand", "url", "house_brand",
                                    "brand_on_staples", "colours_observed", "n_colourways"]]
    att = att.merge(fam, on="family_id", how="left")
    nodes = load("nodes.parquet")
    qx = load_json("qa_extraction.json")["nodes"]
    rng = np.random.default_rng(7)
    grng = np.random.default_rng(11)
    relaxed_list = set(relaxed_nodes())
    members, arches, qa = [], [], {}
    att["price_band"] = None
    for _, nd in nodes.iterrows():
        nid, comp = nd["node_id"], nd["competitor"]
        idx = att.index[att["node_id"] == nid]
        if not len(idx):
            continue
        br, labels = price_bands(att.loc[idx, "price"], c["price_bands"])
        att.loc[idx, "price_band"] = att.loc[idx, "price"].map(lambda p: assign_band(p, br, labels))
        if nd["status"] != "scored":
            qa[nid] = {"price_breaks": br, "status": nd["status"]}
            continue
        df = att.loc[idx]
        fails = set(qx.get(nid, {}).get("g2_fail", []))
        n_s, n_c = int((df["retailer"] == "staples").sum()), int((df["retailer"] == comp).sum())
        c = {**cfg()["archetypes"], "_min_c": max(c["min_competitor"], int(round(c["min_competitor_share"] * n_c))),
             "_min_s": max(c["min_staples"], int(round(c["min_staples_share"] * n_s)))}
        small = nid in relaxed_list
        if small:
            c["min_pooled"] = int(min(c["min_pooled"], (c.get("small_node") or {}).get("min_pooled", 5)))
        df = df.copy()
        merged = merge_tags_into(df, nid, c)       # before rare-value grouping (Sai 2026-10-04)
        for attr in merged:
            att.loc[idx, attr] = df[attr]
        for f in {x for t in facet_tiers(nid).values() for x in t if x in df.columns}:
            vc = df[f].dropna().value_counts(normalize=True)
            rare = set(vc[vc < c["rare_value_share"]].index)
            if rare and len(vc) - len(rare) >= 1:
                df[f] = df[f].where(~df[f].isin(rare), "other")
        gcols, gextra, ginfo, gskip = gap_facets(df, comp, c, grng, nid)
        for col, ser in gcols.items():
            df[col] = ser
            att.loc[idx, col] = ser
        excl = [list(x) for x in c.get("exclusive_facets") or []]
        same = [list(x) for x in excl]
        for attr, other in ((c.get("gap_facets") or {}).get("exclusive_with") or {}).items():
            for col in gcols:
                if gap_parts(col)[0] == attr:
                    excl.append([col, other])
        by_src = {}
        for col in gcols:                          # at most one gap facet per source tag list in a combination
            by_src.setdefault(gap_parts(col)[0], []).append(col)
        excl += [cols for cols in by_src.values() if len(cols) > 1]
        mo = (c.get("gap_facets") or {}).get("max_overlap", 1.0)
        gl = list(gcols)
        for i, a in enumerate(gl):                 # near-duplicate gap facets (mostly the same families): never both
            for b in gl[i + 1:]:
                ya, yb = gcols[a] == "yes", gcols[b] == "yes"
                if (ya & yb).sum() / max(1, (ya | yb).sum()) >= mo:
                    excl.append([a, b])
                    same.append([a, b])
        c["_same_info"] = same
        c["exclusive_facets"] = excl
        cands, fscores = facet_candidates(df, nid, fails, c, comp, gextra)
        from .cards import type_attrs
        lenses, relaxed = choose_lenses(df, cands, c, comp, type_attrs(nid))
        E = embed.encode([neutral_card(r, tier2_attrs(nid)) for _, r in df.iterrows()])
        covered = pd.Index([])
        lens_qa = []
        for k, (core, score) in enumerate(lenses, start=1):
            rest = [x for x in cands if x not in core]
            cells, tail_k, used = build_grid(df, core, rest, c, comp)
            lab = pd.Series("long tail", index=df.index)
            lens_txt = " · ".join(f for f, _ in core)
            for cid, cell in cells.items():
                fv = cell["facets"]
                aid = f"{nid} :: L{k} :: " + " · ".join(f"{f}={v}" for f, v in fv)
                name, combo, full = archetype_name(nid, fv)
                mem = cell["members"]
                lab.loc[mem] = aid
                covered = covered.union(mem)
                arches.append({"archetype_id": aid, "node_id": nid, "l2_key": nd["l2_key"], "competitor": comp,
                               "lens": k, "lens_facets": lens_txt,
                               "depth": len(fv), "facets": json.dumps(dict(fv)), "name": name, "combo": combo,
                               "combo_full": full,
                               "n_staples": int((df.loc[mem, "retailer"] == "staples").sum()),
                               "n_competitor": int((df.loc[mem, "retailer"] == comp).sum())})
                members += [(f, aid, k) for f in df.loc[mem, "family_id"]]
            v = validate(E, lab.values, c, rng)
            depths = [len(cell["facets"]) for cell in cells.values()]
            lens_qa.append({"lens": k, "core_facets": [f for f, _ in core], "core_tiers": [t for _, t in core],
                            "refinement_facets": [f for f, _ in used], "coverage_score": score,
                            "n_archetypes": len(cells),
                            "depth_counts": pd.Series(depths).value_counts().to_dict() if depths else {},
                            "long_tail_share": float(len(tail_k) / len(df)),
                            "admitted_near_misses": [sc["facet"] + ": " + sc["reason"] for sc in fscores
                                                     if sc.get("admitted") and sc["facet"] in [f for f, _ in core + used]],
                            **v})
        tail = df.index.difference(covered)
        if len(tail):
            aid = f"{nid} :: long tail"
            arches.append({"archetype_id": aid, "node_id": nid, "l2_key": nd["l2_key"], "competitor": comp,
                           "lens": 0, "lens_facets": "", "depth": 0, "facets": "{}", "name": "Long tail",
                           "combo": f"not in any {c['core_facets']}-attribute combination with enough families",
                           "combo_full": "",
                           "n_staples": int((df.loc[tail, "retailer"] == "staples").sum()),
                           "n_competitor": int((df.loc[tail, "retailer"] == comp).sum())})
            members += [(f, aid, 0) for f in df.loc[tail, "family_id"]]
        l1 = lens_qa[0] if lens_qa else {}
        qa[nid] = {"core_facets": l1.get("core_facets", []), "core_tiers": l1.get("core_tiers", []),
                   "refinement_facets": l1.get("refinement_facets", []), "tier_min_relaxed": relaxed,
                   "coverage_score": l1.get("coverage_score", 0.0), "lenses": lens_qa,
                   "facet_scores": fscores, "price_breaks": br,
                   "min_support": {"pooled": c["min_pooled"], "competitor": c["_min_c"], "staples": c["_min_s"]},
                   "small_node_relaxed": small, "gap_facets": ginfo, "gap_facets_skipped": gskip,
                   "tags_merged": merged,
                   "admitted_near_misses": sorted({x for lq in lens_qa for x in lq["admitted_near_misses"]}),
                   "n_archetypes": int(sum(lq["n_archetypes"] for lq in lens_qa)),
                   "long_tail_share": float(len(tail) / len(df)),
                   "long_tail_share_staples": float((df.loc[tail, "retailer"] == "staples").sum() / max((df["retailer"] == "staples").sum(), 1)),
                   "long_tail_share_competitor": float((df.loc[tail, "retailer"] == comp).sum() / max((df["retailer"] == comp).sum(), 1)),
                   "below_min_facets": len(l1.get("core_facets", [])) < c["core_facets"],
                   **{key: l1.get(key) for key in ("ari", "ami", "stability", "n_clusters", "noise_share")}}
        log(f"S4 {nid.split(' > ')[-1]}: {qa[nid]['n_archetypes']} archetypes in {len(lens_qa)} attribute sets "
            f"{[lq['core_facets'] for lq in lens_qa]}; long tail {len(tail) / len(df):.0%}; merged {merged}; "
            f"skipped gap facets {[x['value'] for x in gskip]}")
    save(att, "family_table.parquet")          # attributes + family info + node price band
    arches = pd.DataFrame(arches)
    # C2 valid archetype (common gate): >= 4 attributes (not long tail), nameable (no grouped "other"), and enough
    # competitor families to judge it
    arches["valid"] = ((arches["depth"] > 0) & ~arches["facets"].str.contains('"other"')
                       & (arches["n_competitor"] >= cfg()["gates"]["common"]["min_competitor_families"]))
    save(arches, "archetypes.parquet")
    save(pd.DataFrame(members, columns=["family_id", "archetype_id", "lens"]), "archetype_members.parquet")
    save_json(qa, "qa_archetypes.json")
    return qa
