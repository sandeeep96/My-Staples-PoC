"""S4 Archetype construction (methodology §6.3, §14). Phase-1 S6.

Every archetype is a combination of 4 to 6 attribute values (Sai, 2026-10-01), mixing the three tiers:
  Tier 1 universal look/physical (material, colour tone/family, size), Tier 2 functional (node-specific type and
  features), Tier 3 lifestyle (style, vibe, node-specific theme/pattern/audience). Price band is NOT an attribute:
  price is analysed separately (price-band coverage, archetype price ladder, PPG and PPR).

  1. Candidates: the node's facet list per tier (config), minus fields that failed validation (G2) or are unknown
     for more than `max_unknown_share` of either retailer.
  2. Core: the 4-facet combination (with at least tier_min facets from each tier) that puts the largest balanced
     share of both retailers' families into supported cells (ties: higher mean entropy).
  3. Refinement: a 5th, then 6th facet splits a cell only when >= 2 children are supported and the rest of the cell
     (other values or not stated) is itself supported or empty; that rest keeps the cell as "<facet>: other".
  4. Families outside every supported cell form the node's long tail (reported, not scored).
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
from .common import cfg, load, load_json, log, money, nice_breaks, node_config, save, save_json

TIERS = ("tier1", "tier2", "tier3")
UNIVERSAL_T1 = ["material_class", "colour_tone", "colour_family", "size_class"]
UNIVERSAL_T3 = ["style_family", "vibe"]
FACET_LABELS = {"material_class": "Material", "colour_tone": "Colour tone", "colour_family": "Colour",
                "size_class": "Size", "style_family": "Style", "vibe": "Vibe"}
SKIP_WORDS = {"no", "other", "plain", "none", "general", "solid", ""}


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


def facet_tiers(nid: str) -> dict:
    af = node_config(nid).get("archetype_facets")
    if af:
        return {t: list(af.get(t) or []) for t in TIERS}
    return {"tier1": UNIVERSAL_T1[:2], "tier2": tier2_attrs(nid), "tier3": UNIVERSAL_T3 + tier3_attrs(nid)}


def facet_candidates(df: pd.DataFrame, nid: str, fails: set, c: dict, comp: str):
    cands, scores = [], []
    for tier, fl in facet_tiers(nid).items():
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


def choose_core(df: pd.DataFrame, cands: list[tuple], c: dict, comp: str, type_facets: list[str]):
    ent = {f: _norm_entropy(df[f]) for f, _ in cands}
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
        best = None
        for combo in itertools.combinations(cands, k):
            counts = {t: sum(1 for _, tt in combo if tt == t) for t in TIERS}
            if any(counts[t] < mins.get(t, 0) for t in TIERS):
                continue
            fs = [f for f, _ in combo]
            if not _combo_ok(fs, c, type_facets):
                continue
            score = balanced_coverage(df, fs, c, comp) + c["entropy_weight"] * np.mean([ent[f] for f in fs])
            if best is None or score > best[0]:
                best = (score, combo)
        if best is not None:
            return list(best[1]), best[0], relaxed
    return [], 0.0, relaxed


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
    return (node_config(nid).get("facet_labels") or {}).get(f) or FACET_LABELS.get(f) or f.replace("_", " ").capitalize()


def _word(nid: str, f: str, v: str) -> str:
    labels = (node_config(nid).get("labels") or {}).get(f) or {}
    if v in labels:
        return labels[v]
    if v == "yes":
        return f"with {facet_label(nid, f).lower()}"
    if v in SKIP_WORDS or f in ("colour_tone", "colour_family"):
        return ""
    return pretty_value(v)


def archetype_name(nid: str, fv: list[tuple]) -> tuple[str, str]:
    """-> (short merchant name, attribute combo). The report shows 'Name (combo)'."""
    nc = node_config(nid)
    d = dict(fv)
    order = nc.get("name_order") or [f for f, _ in fv]
    words = [w for w in (_word(nid, f, d[f]) for f in order if f in d) if w][:4]
    noun = nc.get("noun", "")
    noun_tokens = set(re.findall(r"[a-z]+", noun.lower()))
    last = words[-1].lower() if words else ""
    if noun and not any(last.endswith(t) for t in noun_tokens):
        words.append(noun)
    name = " ".join(words).strip() or noun or "Archetype"
    name = name[0].upper() + name[1:]
    combo = " · ".join(f"{facet_label(nid, f)}: {pretty_value(v)}" for f, v in fv)
    return name, combo


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
        c = {**c, "_min_c": max(c["min_competitor"], int(round(c["min_competitor_share"] * n_c))),
             "_min_s": max(c["min_staples"], int(round(c["min_staples_share"] * n_s)))}
        df = df.copy()
        for f in {x for t in facet_tiers(nid).values() for x in t if x in df.columns}:
            vc = df[f].dropna().value_counts(normalize=True)
            rare = set(vc[vc < c["rare_value_share"]].index)
            if rare and len(vc) - len(rare) >= 1:
                df[f] = df[f].where(~df[f].isin(rare), "other")
        cands, fscores = facet_candidates(df, nid, fails, c, comp)
        from .cards import type_attrs
        core, score, relaxed = choose_core(df, cands, c, comp, type_attrs(nid))
        rest = [x for x in cands if x not in core]
        cells, tail, used = build_grid(df, core, rest, c, comp)
        lab = pd.Series("long tail", index=df.index)
        for cid, cell in cells.items():
            fv = cell["facets"]
            aid = f"{nid} :: " + " · ".join(f"{f}={v}" for f, v in fv)
            name, combo = archetype_name(nid, fv)
            mem = cell["members"]
            lab.loc[mem] = aid
            arches.append({"archetype_id": aid, "node_id": nid, "l2_key": nd["l2_key"], "competitor": comp,
                           "depth": len(fv), "facets": json.dumps(dict(fv)), "name": name, "combo": combo,
                           "n_staples": int((df.loc[mem, "retailer"] == "staples").sum()),
                           "n_competitor": int((df.loc[mem, "retailer"] == comp).sum())})
            members += [(f, aid) for f in df.loc[mem, "family_id"]]
        if len(tail):
            aid = f"{nid} :: long tail"
            arches.append({"archetype_id": aid, "node_id": nid, "l2_key": nd["l2_key"], "competitor": comp,
                           "depth": 0, "facets": "{}", "name": "Long tail",
                           "combo": f"not in any {c['core_facets']}-attribute combination with enough families",
                           "n_staples": int((df.loc[tail, "retailer"] == "staples").sum()),
                           "n_competitor": int((df.loc[tail, "retailer"] == comp).sum())})
            members += [(f, aid) for f in df.loc[tail, "family_id"]]
        E = embed.encode([neutral_card(r, tier2_attrs(nid)) for _, r in df.iterrows()])
        v = validate(E, lab.values, c, rng)
        depths = [len(cell["facets"]) for cell in cells.values()]
        qa[nid] = {"core_facets": [f for f, _ in core], "core_tiers": [t for _, t in core],
                   "refinement_facets": [f for f, _ in used], "tier_min_relaxed": relaxed,
                   "coverage_score": score, "facet_scores": fscores, "price_breaks": br, "min_support": {"competitor": c["_min_c"], "staples": c["_min_s"]},
                   "admitted_near_misses": [sc["facet"] + ": " + sc["reason"] for sc in fscores if sc.get("admitted") and sc["facet"] in [f for f, _ in core + used]],
                   "n_archetypes": len(cells), "depth_counts": pd.Series(depths).value_counts().to_dict() if depths else {},
                   "long_tail_share": float(len(tail) / len(df)),
                   "long_tail_share_staples": float((df.loc[tail, "retailer"] == "staples").sum() / max((df["retailer"] == "staples").sum(), 1)),
                   "long_tail_share_competitor": float((df.loc[tail, "retailer"] == comp).sum() / max((df["retailer"] == comp).sum(), 1)),
                   "below_min_facets": len(core) < c["core_facets"], **v}
        log(f"S4 {nid.split(' > ')[-1]}: {len(cells)} archetypes; core {[f for f, _ in core]} + {[f for f, _ in used]}; "
            f"long tail {len(tail) / len(df):.0%}; ARI={v['ari']}")
    save(att, "family_table.parquet")          # attributes + family info + node price band
    arches = pd.DataFrame(arches)
    # C2 valid archetype (common gate): >= 4 attributes (not long tail), nameable (no grouped "other"), and enough
    # competitor families to judge it
    arches["valid"] = ((arches["depth"] > 0) & ~arches["facets"].str.contains('"other"')
                       & (arches["n_competitor"] >= cfg()["gates"]["common"]["min_competitor_families"]))
    save(arches, "archetypes.parquet")
    save(pd.DataFrame(members, columns=["family_id", "archetype_id"]), "archetype_members.parquet")
    save_json(qa, "qa_archetypes.json")
    return qa
