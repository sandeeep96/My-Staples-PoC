"""S7 Integration (Phase-1 S9) - the final gate (§14.6).

VOS (Method 1) and TG (Method 2) stay separate scores, and each method has already applied its OWN safety gate
(S5: Method 1 product labels; S6: Method 2 attribute cannibalisation, ACR) and produced its own list. Here:
  * tier = which method lists the archetype: both -> Strong, Method 1 only -> Vector-led, Method 2 only -> Gap-led;
  * union of the two lists per node, Strong first, then by the fused rank 0.5 rank(VOS) + 0.5 rank(TG);
  * max_per_node recommended; below min_per_node a labelled "Conditional" fill (best remaining valid archetypes
    that hold at least one product safe under either method);
  * several attribute sets per node (Sai 2026-10-04): at most max(max_per_lens, ceil(max_per_node / sets)) picks
    per set, and a pick sharing more than max_overlap of its competitor families (Jaccard) with a higher-ranked pick
    is skipped, so the same products are not recommended twice;
  * picks of one attribute set that differ in a single attribute value are folded into the higher-ranked pick
    (Sai 2026-10-06): one recommendation listing the values ("wood/bamboo or metal/wire"), or "All" / "Any" when
    one variant leaves the attribute unstated (audience general, a yes/no attribute at "no").
Also the Dirichlet weight-sensitivity analysis for both scores (G7)."""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from .common import cfg, load, log, pct_rank, save, save_json
from .s4_archetypes import _stated, _word, archetype_name, facet_label, pretty_value

TIER_ORDER = ["Strong", "Vector-led", "Gap-led", "Conditional", "Not listed"]


def _m1_reason(r) -> str:
    g = cfg()["gates"]["method1"]
    if r["m1_list"]:
        return ""
    if pd.isna(r.get("safe_share")):
        return "no products labelled"
    out = []
    if r["n_safe"] < g["min_safe_products"]:
        out.append(f"{int(r['n_safe'])} safe products (< {g['min_safe_products']})")
    elif r["safe_share"] < g["min_safe_share"]:
        out.append(f"safe share {r['safe_share']:.0%} (< {g['min_safe_share']:.0%})")
    if r["reject_share"] >= g["max_reject_share"]:
        out.append(f"{r['reject_share']:.0%} substitute/undercut (≥ {g['max_reject_share']:.0%})")
    return "; ".join(out) or f"passed, outside the top {g['top_n']} by VOS"


def _m2_reason(r) -> str:
    g = cfg()["gates"]["method2"]
    if r["m2_list"]:
        return ""
    out = []
    if not r.get("m2_overindex", False):
        out.append(f"share gap not credible ({r['lsr_credibility']:.0%} < {g['min_credibility']:.0%})")
    if r.get("acr", 0) >= g["max_acr"]:
        out.append(f"ACR {r['acr']:.0%} (≥ {g['max_acr']:.0%}): cheaper or same-look Staples twins")
    if r.get("n_ok2", 0) < g["min_ok_products"]:
        out.append(f"{int(r.get('n_ok2', 0) or 0)} non-cannibalising products (< {g['min_ok_products']})")
    return "; ".join(out) or f"passed, outside the top {g['top_n']} by TG"


def _exclusion_reason(r) -> str:
    if r["shortlisted"]:
        return ""
    if r["depth"] == 0:
        return "long tail: not in any supported 4-attribute combination"
    if not r["valid"]:
        if '"other"' in str(r["facets"]):
            return "includes a grouped “other (mixed)” value: not a nameable archetype"
        return f"only {int(r['n_competitor'])} competitor families (< {cfg()['gates']['common']['min_competitor_families']})"
    if r.get("final_block"):
        return r["final_block"]
    if r["m1_list"] or r["m2_list"]:
        return f"passed a method gate but outside the node's top {cfg()['gates']['final']['max_per_node']}"
    return f"Method 1: {_m1_reason(r)} · Method 2: {_m2_reason(r)}"


def fold_one_apart(a: pd.DataFrame, nid: str, picked: list, gf: dict) -> tuple[list, dict]:
    """Fold picks (rank order) that share a lead's attributes and differ from it in exactly one value; a lead folds
    along one attribute only. -> (leads, {lead: [folded picks]}). Updates the lead's name, combos, family counts."""
    fv = {i: json.loads(a.at[i, "facets"]) for i in picked}
    leads, axis, groups = [], {}, {}
    for i in picked:
        f = fv[i]
        for j in leads:
            g = fv[j]
            if a.at[j, "lens"] != a.at[i, "lens"] or set(g) != set(f):
                continue
            diff = [k for k in f if f[k] != g[k]]
            if len(diff) == 1 and axis.get(j, diff[0]) == diff[0]:
                axis[j] = diff[0]
                groups[j].append(i)
                break
        else:
            leads.append(i)
            groups[i] = []
    for j, mem in groups.items():
        if not mem:
            continue
        f = axis[j]
        vals = list(dict.fromkeys([fv[j][f]] + [fv[i][f] for i in mem]))
        if any(not _stated(nid, f, v) for v in vals):
            shown = gf.get("any_label", "Any") if set(vals) <= {"yes", "no"} else gf.get("all_label", "All")
            word = ""
        else:
            shown = " or ".join(pretty_value(v) for v in vals)
            word = " or ".join(w for w in (_word(nid, f, v) for v in vals) if w)
        name, combo, full = archetype_name(nid, list(fv[j].items()), {f: (word, shown)})
        a.at[j, "name"], a.at[j, "combo"], a.at[j, "combo_full"] = name, combo, full
        a.at[j, "merged_ids"] = "|".join(a.at[i, "archetype_id"] for i in mem)
        a.at[j, "merged_attr"] = facet_label(nid, f)
        a.at[j, "merged_values"] = shown
        for c in ("n_staples", "n_competitor"):
            a.at[j, c] = int(a.at[j, c] + sum(a.at[i, c] for i in mem))
    return leads, groups


def topn_stability(a: pd.DataFrame, score_fn, draws, alpha, n, rng) -> pd.Series:
    """Share of weight draws in which each archetype stays in its node's top-n (eligible only)."""
    base = a.assign(s=score_fn(None))
    base_top = {nid: set(g.nlargest(n, "s")["archetype_id"]) for nid, g in base[base["eligible"]].groupby("node_id")}
    hits = pd.Series(0.0, index=a["archetype_id"])
    for _ in range(draws):
        s = a.assign(s=score_fn(rng))
        for nid, g in s[s["eligible"]].groupby("node_id"):
            for aid in g.nlargest(n, "s")["archetype_id"]:
                hits[aid] += 1
    return hits / draws, base_top


def run() -> dict:
    ic, sc, gf = cfg()["integration"], cfg()["sensitivity"], cfg()["gates"]["final"]
    m1 = load("archetype_m1.parquet")
    m2 = load("archetype_m2.parquet")
    keep2 = [c for c in m2.columns if c not in m1.columns or c == "archetype_id"]
    a = m1.merge(m2[keep2], on="archetype_id", how="left")
    for col in ("valid", "m1_gate", "m1_list", "m2_gate", "m2_list", "m2_overindex"):
        a[col] = a[col].fillna(False).astype(bool)
    # eligible = passed at least one method's safety gate (used for sensitivity and the "failed gate" shading)
    a["eligible"] = a["m1_gate"] | a["m2_gate"]
    a["tier"] = np.select([a["m1_list"] & a["m2_list"], a["m1_list"], a["m2_list"]],
                          ["Strong", "Vector-led", "Gap-led"], "Not listed")
    # fused rank among valid archetypes: orders the union, never gates
    v = a["valid"]
    a["final"] = np.nan
    a.loc[v, "final"] = 100 * (ic["w_vos"] * a[v].groupby("node_id")["vos"].transform(pct_rank)
                               + ic["w_tg"] * a[v].groupby("node_id")["tg"].transform(pct_rank))
    rk_v = a[v].groupby("node_id")["vos"].rank(ascending=False)
    rk_t = a[v].groupby("node_id")["tg"].rank(ascending=False)
    a.loc[v, "rrf"] = 1 / (ic["rrf_k"] + rk_v) + 1 / (ic["rrf_k"] + rk_t)
    a["shortlisted"] = False
    a["final_rank"] = np.nan
    a["final_block"] = ""
    for c in ("merged_ids", "merged_attr", "merged_values", "merged_into"):
        a[c] = ""
    mem = load("archetype_members.parquet").merge(load("family_table.parquet")[["family_id", "retailer"]], on="family_id")
    comp_sets = mem[mem["retailer"] != "staples"].groupby("archetype_id")["family_id"].agg(set).to_dict()
    if "lens" not in a.columns:
        a["lens"] = 1
    order = {"Strong": 0, "Vector-led": 1, "Gap-led": 1}
    for nid, g in a[v].groupby("node_id"):
        n_sets = max(1, int(g["lens"].nunique()))
        cap = max(gf.get("max_per_lens", gf["max_per_node"]), math.ceil(gf["max_per_node"] / n_sets))
        picked, per_set = [], {}

        def block(i):
            k = a.at[i, "lens"]
            if per_set.get(k, 0) >= cap:
                return f"attribute set {chr(64 + int(k))} already has {cap} picks"
            s = comp_sets.get(a.at[i, "archetype_id"], set())
            for rank, j in enumerate(picked, start=1):
                t = comp_sets.get(a.at[j, "archetype_id"], set())
                jac = len(s & t) / max(1, len(s | t))
                if jac > gf.get("max_overlap", 1.0):
                    return f"shares {jac:.0%} of its {a.at[i, 'competitor']} families with pick #{rank}"
            return ""

        def take(idx, limit):
            for i in idx:
                if len(picked) >= limit:
                    break
                why = block(i)
                if why:
                    a.at[i, "final_block"] = why
                    continue
                picked.append(i)
                per_set[a.at[i, "lens"]] = per_set.get(a.at[i, "lens"], 0) + 1

        u = g[g["tier"] != "Not listed"].assign(_o=lambda x: x["tier"].map(order)) \
            .sort_values(["_o", "final"], ascending=[True, False])
        take(u.index, gf["max_per_node"])
        if len(picked) < gf["min_per_node"]:
            rest = g[~g.index.isin(picked) & (g["tier"] == "Not listed")
                     & ((g["n_safe"].fillna(0) >= 1) | (g["n_ok2"].fillna(0) >= 1))]
            fill = rest.assign(_s=rest["n_safe"].fillna(0) + rest["n_ok2"].fillna(0)) \
                .sort_values(["_s", "final"], ascending=False)
            n0 = len(picked)
            take(fill.index, gf["min_per_node"])
            a.loc[picked[n0:], "tier"] = "Conditional"
        if gf.get("merge_one_apart"):
            picked, groups = fold_one_apart(a, nid, picked, gf)
        a.loc[picked, "shortlisted"] = True
        a.loc[picked, "final_rank"] = range(1, len(picked) + 1)
        a.loc[picked, "final_block"] = ""
        if gf.get("merge_one_apart"):
            for rank, j in enumerate(picked, start=1):
                for i in groups[j]:
                    a.at[i, "merged_into"] = a.at[j, "archetype_id"]
                    a.at[i, "final_block"] = f"merged into pick #{rank} (differs only in {a.at[j, 'merged_attr']})"
    a["exclusion_reason"] = a.apply(_exclusion_reason, axis=1)
    a["m1_reason"] = a.apply(_m1_reason, axis=1)
    a["m2_reason"] = a.apply(_m2_reason, axis=1)
    el = a["eligible"]

    # --- sensitivity (Dirichlet around base weights), both scores
    rng = np.random.default_rng(5)
    gw, vw = cfg()["gaps"]["tg_weights"], cfg()["vector"]["vos_weights"]
    shrink = np.where(a["lsr_credibility"].fillna(0) >= cfg()["gaps"]["credible"], 1.0, cfg()["gaps"]["noncredible_shrink"])

    def tg_fn(r):
        w = dict(zip(gw, rng.dirichlet(sc["alpha_scale"] * np.array(list(gw.values()))))) if r is not None else gw
        return 100 * (w["lsr"] * a["pct_lsr"] * shrink + w["ppg"] * a["pct_ppg"] + w["cg"] * a["pct_cg"]
                      + w["msg"] * a["pct_msg"] + w["dfg"] * a["pct_dfg"])

    def vos_fn(r):
        w = dict(zip(vw, rng.dirichlet(sc["alpha_scale"] * np.array(list(vw.values()))))) if r is not None else vw
        return 100 * (w["vw"] * a["pct_vw"] + w["aas"] * a["aas"] / 100 + w["ad"] * a["pct_ad"]) \
            * (1 - a["crs"] / 100) ** cfg()["vector"]["gamma"]

    stab = {}
    for name, fn in (("tg", tg_fn), ("vos", vos_fn)):
        hits, base_top = topn_stability(a, fn, sc["draws"], sc["alpha_scale"], sc["top_n"], rng)
        a[f"stability_{name}"] = a["archetype_id"].map(hits)
        per_node = {nid: float(np.mean([hits[x] for x in top])) for nid, top in base_top.items() if top}
        stab[name] = {"mean_topn_retention": float(np.mean(list(per_node.values()))) if per_node else None,
                      "per_node": per_node}
    # --- per-node agreement
    agree = {}
    for nid, g in a.groupby("node_id"):
        g = g.dropna(subset=["vos", "tg"])
        agree[nid] = float(spearmanr(g["vos"], g["tg"]).statistic) if len(g) >= 4 else None
    save(a, "final_archetypes.parquet")
    qa = {"sensitivity": stab, "spearman_vos_tg": agree,
          "n_eligible": int(el.sum()), "n_shortlisted": int(a["shortlisted"].sum()),
          "tier_counts": a.loc[a["shortlisted"], "tier"].value_counts().to_dict(),
          "n_merged_away": int((a["merged_into"] != "").sum()),
          "m1_gate_pass": int(a["m1_gate"].sum()), "m2_gate_pass": int(a["m2_gate"].sum()),
          "m1_listed": int(a["m1_list"].sum()), "m2_listed": int(a["m2_list"].sum()),
          "n_valid": int(a["valid"].sum()), "n_archetypes": int((a["depth"] > 0).sum())}
    save_json(qa, "qa_integration.json")
    log(f"S7: {qa['n_eligible']} passed a method gate, {qa['n_shortlisted']} recommended {qa['tier_counts']}; stability TG="
        f"{stab['tg']['mean_topn_retention']}, VOS={stab['vos']['mean_topn_retention']}")
    return qa
