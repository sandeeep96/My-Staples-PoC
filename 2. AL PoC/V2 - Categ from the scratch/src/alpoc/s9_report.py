"""S9 Outputs: PNG figures, CSV tables, and one self-contained static HTML report (§9, §14). Phase-1 S11.

Phase-2 report rules (Sai, 2026-10-01): every focus node is in the dropdown (no node filter); "node", never
"shelf"; every archetype is shown as "Archetype (Attributes Combination)"; every metric abbreviation carries its full
name, e.g. "TG (Total Gap)"; in Tab 2 the final recommendations follow the attribute-level gaps and the Method 1 /
Method 2 detail sits at the bottom; price is its own section, outside the archetypes.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import re

import numpy as np
import pandas as pd
from jinja2 import Environment, FileSystemLoader

from . import figures as F
from .common import METRICS, ROOT, cfg, display_name, hash_text, load, load_json, m, money, out, slug, split_multi
from .cards import tier2_attrs
from .s4_archetypes import facet_label, pretty_value
from .s5_vector import AESTHETIC, APPROVE

TIER1_ATTRS = {"colour_family", "colour_tone", "material_class", "size_class"}
TIER_NAMES = {1: "Tier 1 · universal", 2: "Tier 2 · functional", 3: "Tier 3 · lifestyle"}
STATUS_LABEL = {"scored": "scored", "thin": "thin: descriptive only", "staples_only": "competitor data pending"}


def _b64(p) -> str | None:
    if p is None:
        return None
    return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()


def _nan(x) -> bool:
    return x is None or (isinstance(x, float) and np.isnan(x))


def _pct(x, d=0):
    return "–" if _nan(x) else f"{x:.{d}%}"


def _num(x, d=0):
    return "–" if _nan(x) else f"{x:,.{d}f}"


def _money(x):
    return "–" if _nan(x) else money(x)


def node_display(node_id: str) -> str:
    return node_id.replace(" > ", " → ")


def arch(name: str, combo: str, full: str = "") -> dict:
    """Archetype (Attributes Combination): rendered as bold name + muted combo (stated attributes only) in brackets;
    the full combination, with "not stated" values, is the tooltip (Sai 2026-10-04)."""
    full = "" if full is None or (isinstance(full, float) and pd.isna(full)) else full
    return {"name": name, "combo": combo or "", "full": full if full and full != combo else ""}


def _aas_ranges(qv) -> dict:
    """AAS T_low / T_high across L2 peer groups, as "a–b" (or "a" when equal), for the decision map."""
    T = [q["thresholds"] for q in qv.values() if isinstance(q, dict) and "thresholds" in q]
    if not T:
        return {"low": "–", "high": "–"}
    rng = lambda k: (lambda lo, hi: f"{lo:.0f}" if round(lo) == round(hi) else f"{lo:.0f}–{hi:.0f}")(
        min(t[k] for t in T), max(t[k] for t in T))
    return {"low": rng("aas_low"), "high": rng("aas_high")}


def _set(r) -> str:
    """Attribute-set letter (A, B, C) of an archetype row."""
    k = getattr(r, "lens", None)
    return chr(64 + int(k)) if k is not None and not pd.isna(k) and int(k) > 0 else ""


def arch_text(name: str, combo: str) -> str:
    return f"{name} ({combo})" if combo else name


def next_report_path(stem: str):
    """Versioned report: <stem>_v<N>.html with N one above the highest version already in outputs/report."""
    d = out("report", "x").parent
    vs = [int(mt.group(1)) for f in d.glob(f"{stem}*.html") if (mt := re.fullmatch(re.escape(stem) + r"_v(\d+)\.html", f.name))]
    if (d / f"{stem}.html").exists():
        vs.append(1)
    return d / f"{stem}_v{max(vs, default=0) + 1}.html"


def agreement_insight(rho, n_strong: int, n_short: int) -> str:
    """One-line reading of the VOS-TG Spearman for the Final recommendations block."""
    if rho is None:
        return "Too few archetypes on this node to measure agreement."
    level = ("Broad agreement" if rho >= 0.5 else "Partial agreement" if rho >= 0.2
             else "Weak agreement" if rho >= 0 else "The methods pull in opposite directions")
    if not n_short:
        return f"{level}; no archetype passed both the safety gate and the agreement bar here."
    tail = (" Treat single-method recommendations as leads for a merchant's review." if n_strong < n_short else "")
    if n_short == 1:
        return f"{level}: the one recommendation is {'' if n_strong else 'not '}backed by both methods (Strong tier).{tail}"
    return f"{level}: {n_strong} of {n_short} recommendations are backed by both methods (Strong tier).{tail}"


def gate(status: str, value: str, target: str, name: str, metric: str, note: str = "") -> dict:
    return {"name": name, "metric": metric, "value": value, "target": target, "status": status, "note": note}


def build_gates(qm, qx, qa6, qv, qi) -> list[dict]:
    q = cfg()["qa"]
    gs = []
    la, nb = qm["staples_loo_knn"], qm["none_balanced_acc"]
    ok1 = la >= q["g1_leaf_acc"] and nb >= q["g1_none_bal"]
    gs.append(gate("PASS" if ok1 else "FAIL",
                   f"node k-NN {la:.1%}; NONE bal. acc {nb:.1%} (in-scope kept {qm['in_scope_recall']:.0%}, out-of-scope rejected {qm['out_scope_rejection']:.0%})",
                   f"≥ {q['g1_leaf_acc']:.0%}; ≥ {q['g1_none_bal']:.0%}", "G1 Mapping",
                   "Staples node classifier (leave-one-out) and the NONE decision on known in/out-of-scope products",
                   "Whole out-of-scope pages are removed by the page crosswalk first; this checks the product-level "
                   "scope check. Human-labelled gold set still pending: this is a proxy."))
    fails = {nid: v["g2_fail"] for nid, v in qx["nodes"].items() if v["g2_fail"]}
    n_p = sum(len(v["g2_pass"]) for v in qx["nodes"].values())
    n_f = sum(len(v) for v in fails.values())
    gs.append(gate("PASS" if n_f == 0 else "PARTIAL", f"{n_p} node-fields pass, {n_f} fail",
                   f"≥ {q['g2_field_acc']:.0%} per field", "G2 Extraction (physical facts)",
                   "Text extractor (on Staples title, paragraph and bullets) vs Staples specs, accuracy when found",
                   "Failing: " + "; ".join(f"{nid.split(' > ')[-1]}: {', '.join(v)}" for nid, v in fails.items())
                   + ". Failing fields are kept out of gap scores and archetype definitions."))
    gs.append(gate("PENDING", "–", "κ ≥ 0.6", f"G3 Lifestyle tags & {m('DFI')}", "Two-rater human labels",
                   "Needs human-labelled families. Style, vibe, theme/pattern tags and DFI are provisional until then."))
    gs.append(gate("PENDING", "audit files written", "precision ≥ 95%", "G4 Families & dedup",
                   "Manual audit of 100 family merges and identical-product pairs",
                   "Audit samples: outputs/tables/audit_*.csv"))
    g5 = [v["g5"] for k, v in qv.items() if isinstance(v, dict) and "g5" in v]
    nn_ = [x["neutral"] for x in g5 if x.get("neutral") is not None]
    tt_ = [x["title_card"] for x in g5 if x.get("title_card") is not None]
    a5, b5 = (float(np.mean(nn_)) if nn_ else None), (float(np.mean(tt_)) if tt_ else None)
    gs.append(gate("PASS" if a5 is not None and a5 <= q["g5_max_source_auc"] else ("FAIL" if a5 is not None else "PENDING"),
                   f"source {m('AUC')} {_num(a5, 2)} (title-bearing card: {_num(b5, 2)})", f"≤ {q['g5_max_source_auc']}",
                   "G5 Embedding", "How well a classifier can tell the retailer from the card (0.5 = indistinguishable)",
                   "Some separability is genuine assortment difference; the title-bearing card shows how much copy style it removed."))
    aris = [v["ari"] for v in qa6.values() if v.get("ari") is not None]
    stabs = [v["stability"] for v in qa6.values() if v.get("stability") is not None]
    ma, ms = (float(np.median(aris)) if aris else None), (float(np.median(stabs)) if stabs else None)
    st6 = "PASS" if (ma is not None and ma >= q["g6_ari"] and ms is not None and ms >= q["g6_stability"]) else "FAIL"
    gs.append(gate(st6, f"median {m('ARI')} {_num(ma, 2)}, stability {_num(ms, 2)}",
                   f"ARI ≥ {q['g6_ari']}, stab ≥ {q['g6_stability']}", "G6 Archetypes",
                   "4–6-attribute archetypes vs HDBSCAN clusters (UMAP of card embeddings)",
                   "Low ARI means clusters split on something the attributes do not capture; nameability test pending."))
    st = qi["sensitivity"]
    tgs, vos = st["tg"]["mean_topn_retention"], st["vos"]["mean_topn_retention"]
    aucs = [v["calibration"].get("auc") for k, v in qv.items() if isinstance(v, dict) and "calibration" in v]
    aucs = [a for a in aucs if a is not None]
    ok7 = all(x is not None and x >= q["g7_topn_stability"] for x in (tgs, vos)) and aucs and min(aucs) >= q["g7_auc"]
    gs.append(gate("PASS" if ok7 else "FAIL",
                   f"top-5 kept: TG {_pct(tgs)}, VOS {_pct(vos)}; CRS calibration AUC {min(aucs):.2f}–{max(aucs):.2f}" if aucs else "–",
                   f"≥ {q['g7_topn_stability']:.0%}; AUC ≥ {q['g7_auc']}", "G7 Scores",
                   f"Weight sensitivity (Dirichlet) of {m('TG')} and {m('VOS')}; weak-supervision calibration of {m('CRS')}",
                   "AUC is on Staples-only weak pairs; the business calibration session replaces it."))
    de = qv["data_error_share"]
    gs.append(gate("PASS" if de <= q["g8_data_error"] else "FAIL", f"DATA-ERROR share {de:.1%}",
                   f"≤ {q['g8_data_error']:.0%}", "G8 Sanity", f"Low {m('AAS')} + high {m('CRS')} (should be rare)",
                   "Merchant spot-check of 20 recommendations pending."))
    return gs


def build_safety_gates(qm, mp, cand, fa, recs, se, qv) -> list[dict]:
    """The filters that actually cut recommendations (§14.6), grouped Common -> Method 1 -> Method 2 -> Final,
    with this run's counts. Same columns as the quality-gate table; Status = FILTER (removes) or PICK (selects)."""
    v, gc, g1, g2, gf, sk = (cfg()["vector"], cfg()["gates"]["common"], cfg()["gates"]["method1"],
                             cfg()["gates"]["method2"], cfg()["gates"]["final"], cfg()["skus"])
    pct = lambda x, n: f"{x / max(n, 1):.0%}"
    n_all, n_map = len(mp), int((mp["status"] == "mapped").sum())
    a = fa[fa["depth"] > 0]
    va = a[a["valid"]]
    lc, n_c = cand["label"].value_counts(), len(cand)
    safe = int(lc.reindex(APPROVE).fillna(0).sum())
    rej = int(lc.reindex(["SUBSTITUTE", "UNDERCUT", "OFF-BRAND", "EXCLUDE"]).fillna(0).sum())
    l2c = cand["m2_label"].value_counts() if "m2_label" in cand.columns else pd.Series(dtype=int)
    T = [q["thresholds"] for q in qv.values() if isinstance(q, dict) and "thresholds" in q]
    t_low = f"{min(t['aas_low'] for t in T):.0f}–{max(t['aas_low'] for t in T):.0f}"
    t_high = f"{min(t['aas_high'] for t in T):.0f}–{max(t['aas_high'] for t in T):.0f}"
    sl = fa[fa["shortlisted"]]
    tc = sl["tier"].value_counts()
    per = sl.groupby("node_id").size()

    def G(grp, *args):
        return {**gate(*args), "group": grp}

    return [
        G("Common", "FILTER", f"{n_map:,} of {n_all:,} competitor products kept ({pct(n_map, n_all)})",
          f"page on a focus node AND predicted node = page node AND affinity ≥ {qm['tau_none']:.3f}", "C1 Node scope (S2)",
          "The product belongs on a focus node: page crosswalk, vote of the nearest Staples products (all nodes), distance",
          "S2 · s2_mapping.py run(). Removed products go to the backlog; most are pages of other Staples categories."),
        G("Common", "FILTER", f"{len(va)} of {len(a)} archetypes valid",
          f"≥ 4 attributes AND no “other (mixed)” value AND ≥ {gc['min_competitor_families']} competitor families",
          "C2 Valid archetype (attributes combination) (S4)", "Nameable archetype with enough competitor products to judge",
          "S4 · s4_archetypes.py run()."),
        G("Method 1 · vector view", "FILTER",
          f"{safe:,} safe ({pct(safe, n_c)}) · {int(lc.get('REVIEW', 0)):,} REVIEW · {rej:,} reject ({pct(rej, n_c)}) of {n_c:,} products",
          f"CRS high {v['crs_high']} / low {v['crs_low']}; PPR < {v['ppr_undercut']} undercut, ≥ {v['ppr_tradeup']} trade-up; "
          f"AD ≥ {v['ad_threshold']}; AAS T_low {t_low}, T_high {t_high} (per L2)", "M1-a Product labels (S5)",
          "Decision tree per product: identical → EXCLUDE; AAS < T_low → OFF-BRAND; CRS ≥ high: PPR < undercut → UNDERCUT, "
          "PPR ≥ trade-up & upgrade → TRADE-UP, AD ≥ threshold → STYLE-EXTENSION, else SUBSTITUTE; low ≤ CRS < high → "
          "LEAN-APPROVE if AD ≥ threshold and AAS ≥ T_high, else REVIEW; CRS < low: CURATE or EDGE",
          "S5 · s5_vector.py label(). Safe = CURATE, STYLE-EXTENSION, TRADE-UP, LEAN-APPROVE."),
        G("Method 1 · vector view", "FILTER", f"{int(va['m1_gate'].sum())} of {len(va)} valid archetypes pass",
          f"≥ {g1['min_safe_products']} safe products AND safe share ≥ {g1['min_safe_share']:.0%} of decided AND "
          f"substitute + undercut < {g1['max_reject_share']:.0%}", "M1-b Archetype (attributes combination) gate (S5)",
          "Method 1's own cannibalisation check on the archetype's products",
          "S5 · s5_vector.py run(). Reason per archetype in the node tables."),
        G("Method 1 · vector view", "PICK", f"{int(a['m1_list'].sum())} archetypes on the Method 1 list",
          f"top {g1['top_n']} per node by VOS", "M1-c Method 1 list (S5)", "Ranked by VOS (Vector Opportunity Score)",
          "S5 · s5_vector.py run()."),
        G("Method 2 · attribute view", "FILTER",
          f"{int(l2c.get('ATTR-UNDERCUT', 0)):,} attribute undercut · {int(l2c.get('ATTR-SUBSTITUTE', 0)):,} attribute substitute · "
          f"{int(l2c.get('ATTR-TRADE-UP', 0)):,} trade-up · {int(l2c.get('ATTR-STYLE-EXT', 0)):,} style-ext · {int(l2c.get('NO-TWIN', 0)):,} no twin",
          f"twin = same values on all known validated functional attributes (≥ {g2['twin_min_attrs']} compared); price ÷ twins' median "
          f"< {g2['undercut_ppr']} → undercut; < {g2['tradeup_ppr']} and same colour tone → substitute",
          "M2-a Product labels (S6)", "Attribute twin = a Staples family anywhere in the node with the same function; then price and look",
          "S6 · s6_gaps.py m2_labels(). Uses attributes and price only, no Method 1 scores."),
        G("Method 2 · attribute view", "FILTER", f"{int(va['m2_gate'].sum())} of {len(va)} valid archetypes pass",
          f"(LSR credibility ≥ {g2['min_credibility']:.0%} OR absent at Staples) AND ACR < {g2['max_acr']:.0%} AND "
          f"≥ {g2['min_ok_products']} non-cannibalising products", "M2-b Archetype (attributes combination) gate (S6)",
          f"The competitor credibly over-indexes, and its products rarely have a cheaper or same-look Staples twin "
          f"({m('ACR')} = attribute undercuts + substitutes ÷ products)", "S6 · s6_gaps.py run(). Reason per archetype in the node tables."),
        G("Method 2 · attribute view", "PICK", f"{int(a['m2_list'].sum())} archetypes on the Method 2 list",
          f"top {g2['top_n']} per node by TG", "M2-c Method 2 list (S6)", "Ranked by TG (Total Gap)", "S6 · s6_gaps.py run()."),
        G("Final", "FILTER", f"{len(sl)} recommended: " + ", ".join(f"{int(tc[t])} {t}" for t in
                                                                  ("Strong", "Vector-led", "Gap-led", "Conditional") if t in tc),
          "union of the two lists; Strong = both, Vector-led = Method 1 only, Gap-led = Method 2 only",
          "F1 Union & tier (S7)", "Each method's list counts on its own; agreement shows as the tier",
          "S7 · s7_integrate.py run(). Ordered Strong first, then by fused rank 0.5·rank(VOS) + 0.5·rank(TG)."),
        G("Final", "PICK", f"{int(per.min()) if len(per) else 0}–{int(per.max()) if len(per) else 0} per scored node",
          f"min {gf['min_per_node']}, max {gf['max_per_node']} per node", "F2 Per-node size (S7)",
          "Below the minimum, the best remaining valid archetypes with a product safe under either method are added as Conditional",
          "S7 · s7_integrate.py run()."),
        G("Final", "PICK", f"{len(recs)} exemplar products · {len(se)} style-extension products",
          f"≤ {sk['n_exemplars']} per recommended archetype; ≤ {sk['style_extension_n']} style extensions per node",
          "F3 SKU picks (S8)", "Only products safe under the method(s) that recommended the archetype: Method 1 labels for "
          "Vector-led, no cheaper or same-look Staples attribute twin for Gap-led, both for Strong",
          "S8 · s8_skus.py allowed()."),
    ]


def attr_label(nid: str, a: str) -> str:
    return facet_label(nid, a)


def node_insights(nid, ns_row, bands, gaps, fa, cand, vend, comp, price_lines=()) -> list[dict]:
    """Insights grouped for the report: [{'group': title, 'lines': [text, ...]}], empty groups dropped."""
    groups: dict[str, list[str]] = {}

    def add(g, t):
        groups.setdefault(g, []).append(t)

    deeper = f"Where {comp} is deeper (credible gaps)"
    g = gaps[(gaps["credibility"] >= 0.9) & (~gaps["descriptive_only"]) & (gaps["delta"] > 0.04)]
    for r in g.nlargest(3, "delta").itertuples():
        add(deeper, f"{attr_label(nid, r.attribute)} “{pretty_value(r.value)}”: {comp} {r.share_competitor:.0%} vs Staples {r.share_staples:.0%}.")
    st = gaps[(gaps["credibility"] <= 0.1) & (~gaps["descriptive_only"]) & (gaps["delta"] < -0.08)]
    for r in st.nsmallest(2, "delta").itertuples():
        add("Where Staples is deeper (not a gap)",
            f"{attr_label(nid, r.attribute)} “{pretty_value(r.value)}”: Staples {r.share_staples:.0%} vs {comp} {r.share_competitor:.0%}.")
    add("Price", f"Median price: {comp} {_money(ns_row['price_median_competitor'])} vs Staples {_money(ns_row['price_median_staples'])}.")
    for line in price_lines:
        add("Price", line)
    if not _nan(ns_row["design_forward_share_competitor"]):
        add("Design", f"Design-forward share ({m('DFI')} ≥ {cfg()['gaps']['dfi_forward']}): {comp} "
                      f"{ns_row['design_forward_share_competitor']:.0%} vs Staples {ns_row['design_forward_share_staples']:.0%}.")
    rec = "Recommendation"
    if fa is not None and len(fa):
        sl = fa[fa["shortlisted"]].sort_values("final_rank")
        if len(sl):
            r = sl.iloc[0]
            add(rec, f"Top pick: {arch_text(r['name'], r['combo'])} ({r['tier']}).")
            tc = sl["tier"].value_counts()
            add(rec, f"{len(sl)} recommended: " + ", ".join(f"{int(tc[t])} {t}" for t in
                     ("Strong", "Vector-led", "Gap-led", "Conditional") if t in tc) + ".")
        else:
            add(rec, "No archetype passed either method's safety gate here; see the excluded list below.")
    if cand is not None and len(cand):
        lc = cand["label"].value_counts()
        add(rec, f"Method 1: {lc.reindex(APPROVE).fillna(0).sum():.0f} of {len(cand):,} {comp} products safe to add "
                 f"({lc.get('CURATE', 0)} CURATE, {lc.get('STYLE-EXTENSION', 0)} STYLE-EXTENSION, {lc.get('TRADE-UP', 0)} TRADE-UP, "
                 f"{lc.get('LEAN-APPROVE', 0)} LEAN-APPROVE); {lc.get('SUBSTITUTE', 0) + lc.get('UNDERCUT', 0)} substitute or undercut a Staples item.")
        if "m2_label" in cand.columns:
            l2c = cand["m2_label"].value_counts()
            add(rec, f"Method 2: {int(l2c.get('ATTR-UNDERCUT', 0) + l2c.get('ATTR-SUBSTITUTE', 0))} of {len(cand):,} {comp} products "
                     f"have a cheaper or same-look Staples attribute twin; {int(l2c.get('NO-TWIN', 0))} have no Staples twin.")
    if vend is not None and len(vend):
        k = int(vend["brand_on_staples"].sum())
        if k:
            add(rec, f"Quick-win sellers: {k} brand(s) behind recommended products already sell on Staples.")
    return [{"group": k, "lines": v} for k, v in groups.items()]


def price_insights(bands, nfa, comp, ppr_up, ppr_down) -> tuple[list[str], list[dict]]:
    lines, ladder = [], []
    b = bands.assign(d=lambda x: x["share_competitor"] - x["share_staples"])
    up = b[(b["credibility"] >= 0.9) & (b["d"] > 0.03)]
    if len(up):
        r = up.nlargest(1, "d").iloc[0]
        lines.append(f"{comp} is credibly deeper in the {r['band']} band: {r['share_competitor']:.0%} of its range vs Staples {r['share_staples']:.0%}.")
    dn = b[(b["credibility"] <= 0.1) & (b["d"] < -0.03)]
    if len(dn):
        r = dn.nsmallest(1, "d").iloc[0]
        lines.append(f"Staples is deeper in the {r['band']} band: {r['share_staples']:.0%} vs {comp} {r['share_competitor']:.0%}.")
    if nfa is not None and len(nfa):
        d = nfa[(nfa["depth"] > 0)].copy()
        d["ratio"] = d["price_median_competitor"] / d["price_median_staples"]
        prem = d[(d["ratio"] >= ppr_up) & (d["n_staples"] >= 3) & (d["n_competitor"] >= 3)]
        val = d[(d["ratio"] < ppr_down) & (d["n_staples"] >= 3) & (d["n_competitor"] >= 3)]
        if len(prem):
            lines.append(f"{len(prem)} archetype(s) where {comp}'s typical price is ≥ {ppr_up}× Staples' (premium versions Staples does not carry).")
        if len(val):
            lines.append(f"{len(val)} archetype(s) where {comp} is priced below {ppr_down}× Staples' (cheaper versions; adding them risks undercutting).")
        for r in d.sort_values("price_median_competitor", ascending=False).itertuples():
            ladder.append({"a": arch(r.name, r.combo), "ns": r.n_staples, "nc": r.n_competitor,
                           "ps": _money(r.price_median_staples), "pc": _money(r.price_median_competitor),
                           "ratio": (f"{r.ratio:.2f}×" if not _nan(r.ratio) else "–"),
                           "dir": ("premium" if not _nan(r.ratio) and r.ratio >= ppr_up else
                                   "cheaper" if not _nan(r.ratio) and r.ratio < ppr_down else
                                   "parity" if not _nan(r.ratio) else "one side only"),
                           "ppg": _num(r.ppg, 2)})
    return lines, ladder


def staples_profile(nft: pd.DataFrame, nid: str) -> list[dict]:
    """Staples-only nodes: top values per attribute, so the node has a profile until competitor data arrives."""
    from .cards import tier2_attrs, tier3_attrs
    rows = []
    for a in ["colour_family", "material_class", "style_family", "size_class", "vibe"] + tier2_attrs(nid) + tier3_attrs(nid):
        if a not in nft.columns:
            continue
        vc = nft[a].dropna().value_counts(normalize=True)
        if vc.empty:
            continue
        rows.append({"attr": attr_label(nid, a), "known": _pct(nft[a].notna().mean()),
                     "top": ", ".join(f"{pretty_value(v)} {s:.0%}" for v, s in vc.head(4).items())})
    return rows


def _compact(n) -> str:
    return f"{n / 1000:.1f}K" if n >= 10000 else f"{n:,}"


def _and(xs: list[str]) -> str:
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


def exec_summary(nodes, nsum, fa, cand, recs, vend, bands, qi, gaps) -> dict:
    """Executive Summary tab (Sai, 2026-10-06): KPI tiles, funnel, key findings and a node scorecard, all computed from
    this run with generic rules (no per-node text), static (no clicks)."""
    top = cfg()["report"].get("exec", {}).get("top_n", 3)
    cred = cfg()["gaps"]["credible"]
    tiers = ["Strong", "Vector-led", "Gap-led", "Conditional"]
    sc = nodes[nodes["status"] == "scored"].sort_values("rank")
    leaf = lambda nid: nid.split(" > ")[-1]
    short = lambda nid: leaf(nid).split(",")[0]
    comp_of = dict(zip(nodes["node_id"], nodes["competitor"].map(lambda c: display_name(c) if c else "–")))
    arch_all = fa[fa["depth"] > 0]
    rec = fa[fa["shortlisted"]]
    n_rec, n_new = len(rec), int((rec["n_staples"] == 0).sum())
    tc = rec["tier"].value_counts()
    tier_bar = lambda d, n: [{"tier": t, "n": int(d.get(t, 0)), "w": 100 * d.get(t, 0) / n, "c": F.TIER[t]}
                             for t in tiers if d.get(t, 0)] if n else []
    n_st, n_co = int(sc["n_staples"].sum()), int(sc["n_competitor"].sum())
    comps = sc["competitor"].map(display_name).value_counts()
    n_ex = int(recs["family_id"].nunique()) if len(recs) else 0
    vo = vend[vend["brand_on_staples"].fillna(False)].assign(b=lambda x: x["brand"].fillna("").astype(str).str.strip())         if len(vend) else pd.DataFrame(columns=["b", "products"])
    vo = vo[vo["b"] != ""].sort_values("products", ascending=False)
    on_st = list(vo.groupby(vo["b"].str.lower(), sort=False)["b"].first())   # most products first
    kpis = [
        {"k": "Nodes analysed", "v": f"{len(sc)}", "s": " · ".join(f"{n} vs {c}" for c, n in comps.items())},
        {"k": "Families compared", "v": _compact(n_st + n_co), "s": f"{n_st:,} Staples · {n_co:,} competitor"},
        {"k": "Archetypes built", "v": f"{len(arch_all):,}", "s": "attribute combinations, 4–6 attributes each"},
        {"k": "Safe recommendations", "v": f"{n_rec}", "s": "", "bar": tier_bar(tc, n_rec)},
    ]

    # funnel: bar width on a log scale so 20K and 99 both read
    n_fam = n_st + n_co
    either = int((arch_all["m1_gate"] | arch_all["m2_gate"]).sum())
    stages = [("Product families compared", n_fam, f"{n_st:,} Staples · {n_co:,} competitor"),
              ("Archetypes built", len(arch_all), f"across {len(sc)} nodes"),
              ("Valid archetypes", int(arch_all["valid"].sum()), "in scope, ≥ 4 attributes, enough products"),
              ("Pass a method's safety gate", either, f"Method 1: {int(arch_all['m1_gate'].sum())} · Method 2: {int(arch_all['m2_gate'].sum())}"),
              ("Recommended", n_rec, "after the final gate (≤ 10 per node, no near-duplicates)")]
    lmax = np.log10(max(n_fam, 10))
    funnel = [{"k": k, "v": f"{n:,}", "s": s, "w": max(6.0, 100 * np.log10(max(n, 1)) / lmax)} for k, n, s in stages]
    funnel[-1]["bar"] = tier_bar(tc, n_rec)

    # ---- key findings (generic rules; nodes named by size of the effect)
    ns = nsum.loc[sc["node_id"]]
    df_c, df_s = ns["design_forward_share_competitor"], ns["design_forward_share_staples"]
    diff = (df_c - df_s).sort_values(ascending=False)
    ahead = [leaf(n) for n in diff.index if diff[n] < 0]
    # each finding: headline value "v", caption "s" (what the number is), bullets "b"
    find = []
    b = [f"Competitor ahead on {int((diff > 0).sum())} of {len(diff)} nodes."]
    b += [f"Widest gap: {short(n)} ({df_c[n]:.0%} vs {df_s[n]:.0%})." for n in diff.index[:top]]
    if ahead:
        b.append(f"Staples ahead: {_and([short(n) for n in diff.index if diff[n] < 0])}.")
    find.append({"t": "Design gap", "v": f"{df_c.mean():.0%} vs {df_s.mean():.0%}",
                 "s": "design-forward share, competitor vs Staples", "b": b})
    lo, hi = [], []
    for nid in sc["node_id"]:
        bb = bands[bands["node_id"] == nid].sort_values("price_mid")
        if len(bb) < 2:
            continue
        for row, lst in ((bb.iloc[0], lo), (bb.iloc[-1], hi)):
            if row["credibility"] >= cred:
                lst.append((row["share_competitor"] - row["share_staples"], nid, row))
    at = lambda band: band if str(band).lower().startswith("under") else f"at {band}"
    ex1 = lambda lst: (lambda n, r: f"{short(n)}: {r['share_competitor']:.0%} vs {r['share_staples']:.0%} {at(r['band'])}")(
        *max(lst, key=lambda x: x[0])[1:])
    med = nsum.loc[[n for n in sc["node_id"] if n in nsum.index]]
    st_hi = int((med["price_median_staples"] > med["price_median_competitor"]).sum())
    b = ([f"Budget gap, e.g. {ex1(lo)}."] if lo else []) + ([f"Premium gap, e.g. {ex1(hi)}."] if hi else []) +         [f"Staples' median price is higher on {st_hi} of {len(med)} nodes."]
    find.append({"t": "Price gap", "v": f"Cheaper on {len(lo)} · pricier on {len(hi)}",
                 "s": "nodes where the competitor has more low- / high-priced products (competitor vs Staples share)", "b": b})
    lc = cand["label"].value_counts()
    n_c = len(cand)
    rej1 = int(lc.get("SUBSTITUTE", 0) + lc.get("UNDERCUT", 0))
    l2 = cand["m2_label"].value_counts() if "m2_label" in cand.columns else pd.Series(dtype=int)
    rej2 = int(l2.get("ATTR-SUBSTITUTE", 0) + l2.get("ATTR-UNDERCUT", 0))
    find.append({"t": "Cannibalisation guard", "v": _pct(rej1 / n_c) if n_c else "–",
                 "s": f"of {n_c:,} competitor products would substitute or undercut a Staples item (Method 1)",
                 "b": [f"Method 1: {rej1:,} products are labelled SUBSTITUTE or UNDERCUT.",
                       f"Method 2: {rej2:,} ({_pct(rej2 / n_c)}) have a cheaper or same-look Staples twin.",
                       "Example products are shown only where the recommending method marks them safe."]})
    hs, n_ind = [], 0
    if len(vend):
        vv = vend.assign(comp=vend["node_id"].map(comp_of), b=vend["brand"].fillna("").astype(str).str.strip())
        vv = vv[vv["b"] != ""]
        for c, g in vv.groupby("comp"):
            if g["house_brand"].mean() > 0:
                hs.append(f"{g['house_brand'].mean():.0%} of {c}'s brands are house brands: source the archetype, not the brand.")
        n_ind = int(vv.loc[~vv["house_brand"].fillna(False) & ~vv["brand_on_staples"].fillna(False), "b"].str.lower().nunique())
    b = ([f"Quick wins: {_and(on_st[:3])}{' …' if len(on_st) > 3 else '.'}"] if on_st else []) + hs + \
        [f"{n_ind} independent brands to recruit as marketplace sellers."]
    find.append({"t": "Sourcing", "v": f"{len(on_st)} brands", "s": "behind safe products already sell on Staples", "b": b})
    # missing looks: look values (the fields AD reads) the competitor carries credibly more of, counted over nodes
    lg = gaps[gaps["node_id"].isin(sc["node_id"]) & (gaps["credibility"] >= cred) & (gaps["delta"] > 0)
              & gaps["attribute"].isin(AESTHETIC + ["aesthetic_tags"])]
    lk = lg.groupby(["attribute", "value"]).agg(n=("node_id", "nunique"), d=("delta", "mean"), nid=("node_id", "first"))         .reset_index().sort_values(["n", "d"], ascending=False)
    if len(lk):
        b = []
        for a_, g in lk.groupby("attribute", sort=False):
            if g["n"].iloc[0] * 2 < len(sc):      # a look field counts when its top value is credible on at least half the nodes
                continue
            b.append(f"{attr_label(g['nid'].iloc[0], a_)}: " + ", ".join(f"{pretty_value(r.value)} ({r.n})" for r in g.head(3).itertuples()) + ".")
        find.append({"t": "Missing looks", "v": f"{' · '.join(pretty_value(v) for v in lk['value'].head(2))}: {int(lk['n'].iloc[0])} of {len(sc)}".capitalize(),
                     "s": "look values the competitor carries clearly more of; (n) = nodes where the gap is credible", "b": b})
    # picks fit the core-adjacent idea: example products vs their nearest Staples product
    ex = recs.drop_duplicates("family_id") if len(recs) else recs
    ex = ex[ex["dfi"].notna() & ex["st_dfi"].notna()] if len(ex) else ex
    if len(ex):
        up = ex["dfi"] > ex["st_dfi"]
        bn = ex.assign(up=up).groupby("node_id")["up"].mean()
        v_ = cfg()["vector"]
        pp = ex["ppr"].dropna()
        hi_p, lo_p = (pp >= v_["ppr_tradeup"]).mean(), (pp < v_["ppr_undercut"]).mean()
        b = [f"Median {m('DFI')}: {ex['dfi'].median():.2f} vs {ex['st_dfi'].median():.2f}."]
        full = [short(n) for n in bn.index if bn[n] >= 1]
        if full:
            b.append(f"100% on {_and(full)}.")
        b.append(f"{hi_p:.0%} priced at ≥ {v_['ppr_tradeup']}× Staples: room for margin.")
        find.append({"t": "Picks fit the “White Chair” idea", "v": f"{up.mean():.0%} more design-led",
                     "s": f"{len(ex)} example products vs their nearest Staples product", "b": b})

    order = ["Design gap", "Price gap", "Cannibalisation guard", "Missing looks", "Picks fit the “White Chair” idea", "Sourcing"]
    find.sort(key=lambda f: order.index(f["t"]) if f["t"] in order else len(order))

    # ---- node scorecard
    rows = []
    for nd in sc.itertuples():
        nid, r = nd.node_id, rec[rec["node_id"] == nd.node_id]
        t1 = r.sort_values("final_rank").head(1)
        s_ = nsum.loc[nid]
        rows.append({"rank": int(nd.rank), "leaf": short(nid), "path": node_display(nid), "comp": comp_of[nid],
                     "ns": int(nd.n_staples), "nc": int(nd.n_competitor),
                     "dfs": float(np.nan_to_num(s_["design_forward_share_staples"])),
                     "dfc": float(np.nan_to_num(s_["design_forward_share_competitor"])),
                     "ps": _money(s_["price_median_staples"]), "pc": _money(s_["price_median_competitor"]),
                     "n": len(r), "bar": tier_bar(r["tier"].value_counts(), 10), "new": int((r["n_staples"] == 0).sum()),
                     "top": t1["name"].iloc[0] if len(t1) else "–",
                     "top_full": (t1["combo_full"].fillna(t1["combo"]).iloc[0] if len(t1) else ""),
                     "top_tier": t1["tier"].iloc[0] if len(t1) else ""})
    answer = (f"{n_rec} archetypes (attributes combinations) across {len(sc)} nodes are safe for Staples to add; "
              f"{_pct(n_new / n_rec) if n_rec else '–'} are new to Staples, and {n_ex} example competitor products show what to source.")
    return {"kpis": kpis, "funnel": funnel, "findings": find, "scorecard": rows, "answer": answer,
            "tiers": [{"tier": t, "c": F.TIER[t]} for t in tiers]}


def run() -> dict:
    v = cfg()["vector"]
    nodes = load("nodes.parquet")
    fa = load("final_archetypes.parquet")
    cand_all = load("candidates.parquet").merge(load("m2_labels.parquet"), on="family_id", how="left")
    cand = cand_all.drop_duplicates("family_id")   # product-level counts: one row per family (several attribute sets)
    gaps = load("attr_gaps.parquet")
    bands = load("price_bands.parquet")
    nsum = load("node_summary.parquet").set_index("node_id")
    recs = load("sku_recs.parquet")
    se = load("style_extensions.parquet")
    vend = load("vendor_view.parquet")
    mp = load("mapping.parquet")
    ft = load("family_table.parquet")
    fam = load("families.parquet")
    qm, qx, qa6 = load_json("qa_mapping.json"), load_json("qa_extraction.json"), load_json("qa_archetypes.json")
    qv, qi = load_json("qa_vector.json"), load_json("qa_integration.json")
    arch_names = fa.set_index("archetype_id")[["name", "combo"]]
    # look fields as AD (Aesthetic Delta) reads them (text-extracted value where one exists)
    look = pd.DataFrame({k: ft["txt_" + k] if "txt_" + k in ft.columns else ft[k] for k in AESTHETIC + ["aesthetic_tags"]}) \
        .set_index(ft["family_id"])

    # ---- tables (CSV) + audit samples
    fa_out = fa.assign(archetype=[arch_text(n, c) for n, c in zip(fa["name"], fa["combo"])])
    for name, df in {"final_archetypes": fa_out, "candidates": cand_all, "attribute_gaps": gaps, "price_bands": bands,
                     "sku_recommendations": recs, "style_extensions": se, "vendor_view": vend, "nodes": nodes}.items():
        df.to_csv(out("tables", f"{name}.csv"), index=False)
    backlog = mp[~mp["status"].isin(["mapped", "mapped_other_competitor"])].merge(
        fam[["family_id", "title", "price", "url", "brand"]], on="family_id")
    backlog.to_csv(out("tables", "new_node_backlog.csv"), index=False)
    stf = fam[(fam["retailer"] == "staples") & (fam["n_skus"] > 1)]
    stf.sample(min(100, len(stf)), random_state=1)[["family_id", "title", "n_skus", "sku_ids", "colours_observed", "leaf_path"]] \
        .to_csv(out("tables", "audit_family_merges.csv"), index=False)
    ident = cand[cand["identical"]].merge(ft[["family_id", "title", "price"]], on="family_id") \
        .merge(ft[["family_id", "title", "price"]].add_prefix("st_"), left_on="identical_staples", right_on="st_family_id")
    ident.head(100).to_csv(out("tables", "audit_identical_pairs.csv"), index=False)

    # ---- report order: picks ranked by final score within each node (tables above keep S7's rank)
    fa = fa.copy()
    sl = fa["shortlisted"].fillna(False).astype(bool)
    fa.loc[sl, "final_rank"] = fa[sl].sort_values(["final", "tg"], ascending=False) \
        .groupby("node_id").cumcount().add(1).reindex(fa[sl].index)

    # ---- overview figures
    F.node_coverage(nodes.assign(status=nodes["status"].replace({"staples_only": "thin"})), "Competitor",
                    out("figures", "overview", "node_coverage.png"))           # PNG only

    # ---- per-node payloads (every node, in the focus order)
    node_list, sections = [], []
    for _, nd in nodes.sort_values("rank").iterrows():
        nid = nd["node_id"]
        comp_key = nd["competitor"]
        comp = display_name(comp_key) if comp_key else "Competitor"
        planned = [display_name(r) for r in str(nd["competitors_planned"]).split("|") if r]
        sid = slug(nid)
        if len(sid) > 70:
            sid = sid[:60] + "_" + hash_text(nid)[:6]
        d = out("figures", sid, "x").parent
        nft = ft[ft["node_id"] == nid]
        figs, acc_img = {}, None
        qn = qx["nodes"].get(nid, {})
        if qn.get("validation"):
            acc_img = _b64(F.extractor_accuracy(qn["validation"], cfg()["qa"]["g2_field_acc"], d / "extractor_accuracy.png"))
        base = {"id": sid, "label": node_display(nid), "status": nd["status"], "status_label": STATUS_LABEL[nd["status"]],
                "segment": nd["segment"], "rank": int(nd["rank"]), "l2": nd["l2_key"], "comp": comp,
                "planned": ", ".join(planned) or "–", "ns": int(nd["n_staples"]), "nc": int(nd["n_competitor"]),
                "provisional": not nd["node_config_reviewed"], "acc_img": acc_img,
                "parity": qn.get("parity_chars")}
        node_list.append({"id": sid, "label": node_display(nid), "l1": nid.split(" > ")[0], "status": nd["status"],
                          "status_label": STATUS_LABEL[nd["status"]]})
        if nd["status"] == "staples_only":
            sb = nft["price_band"].value_counts(normalize=True)
            base.update({"profile": staples_profile(nft, nid),
                         "price_median": _money(nft["price"].median()),
                         "bands": [{"band": b, "share": _pct(s)} for b, s in
                                   sorted(sb.items(), key=lambda kv: nft.loc[nft["price_band"] == kv[0], "price"].median())]})
            sections.append(base)
            continue

        nb = bands[bands["node_id"] == nid].sort_values("price_mid")
        ng = gaps[gaps["node_id"] == nid]
        figs = {
            "price": _b64(F.price_bands(nb, comp, d / "price_bands.png")) if len(nb) else None,
            "dfi": _b64(F.dfi_density(nft.loc[nft["retailer"] == "staples", "dfi"], nft.loc[nft["retailer"] != "staples", "dfi"],
                                      comp, d / "dfi_density.png")),
            "jsd": _b64(F.attribute_jsd(ng, d / "attribute_jsd.png")) if len(ng) else None,
            "gaps": _b64(F.value_gaps(ng, comp, d / "value_gaps.png")) if len(ng) else None,
        }
        nfa = fa[fa["node_id"] == nid].copy()
        ncand = cand[cand["node_id"] == nid]
        nvend = vend[vend["node_id"] == nid] if len(vend) else vend
        scored = nd["status"] == "scored" and len(nfa) > 0
        if scored:
            T = qv[nd["l2_key"]]["thresholds"]
            figs["decision"] = _b64(F.decision_scatter(ncand, T, v, d / "decision_scatter.png"))
            figs["agreement"] = _b64(F.agreement(nfa, d / "agreement.png"))
            figs["labelmix"] = _b64(F.label_mix(nfa, d / "label_mix.png"))
            gp = cfg()["gaps"]
            figs["vos"] = _b64(F.vos_components(nfa, v["vos_weights"], v["gamma"], d / "vos_components.png"))
            figs["tg"] = _b64(F.tg_components(nfa, gp["tg_weights"], gp["credible"], gp["noncredible_shrink"],
                                              d / "tg_components.png"))
        ns_row = nsum.loc[nid]
        p_lines, ladder = price_insights(nb, nfa if scored else None, comp, v["ppr_tradeup"], v["ppr_undercut"])
        ins = node_insights(nid, ns_row, nb, ng, nfa if scored else None, ncand if scored else None, nvend, comp, p_lines)
        nfa = nfa.sort_values(["final", "tg"], ascending=False)
        m1 = [{"a": arch(r.name, r.combo_full or r.combo), "set": _set(r), "ns": r.n_staples, "nc": r.n_competitor, "vw": _num(r.vw, 2),
               "aas": _num(r.aas), "ad": _num(r.ad, 2), "crs": _num(r.crs), "ppr": _num(r.ppr, 2),
               "safe": _pct(r.safe_share), "nsafe": _num(r.n_safe), "rej": _pct(r.reject_share), "vos": _num(r.vos, 1),
               "elig": "pass" if r.m1_gate else "fail", "listed": bool(r.m1_list), "why": r.m1_reason}
              for r in nfa.sort_values("vos", ascending=False).itertuples()]
        m2 = [{"a": arch(r.name, r.combo_full or r.combo), "set": _set(r), "ps": _pct(r.p_staples), "pc": _pct(r.p_competitor), "lsr": _num(r.lsr, 2),
               "cred": _pct(r.lsr_credibility), "flag": "absent at Staples" if r.absent else ("thin at Staples" if r.thin else ""),
               "ppg": (_num(r.ppg, 2) + (" ↑" if r.ppg_dir > 0 else " ↓" if r.ppg_dir < 0 else "")) if not pd.isna(r.ppg) else "–",
               "cg": _num(r.cg, 2), "msg": _num(r.msg, 2), "dfg": _num(r.dfg, 2), "tg": _num(r.tg, 1),
               "tgo": _num(r.tg_original, 1), "miss": (r.missing_colours or "").replace("|", ", "),
               "acr": _pct(r.acr), "nok": _num(r.n_ok2), "elig": "pass" if r.m2_gate else "fail", "listed": bool(r.m2_list),
               "why": r.m2_reason}
              for r in nfa.sort_values("tg", ascending=False).itertuples()]
        fin = [{"rank": int(r.final_rank), "a": arch(r.name, r.combo_full or r.combo), "tier": r.tier, "set": _set(r),
                "vos": _num(r.vos, 1), "tg": _num(r.tg, 1), "final": _num(r.final, 1),
                "m1": "✓" if r.m1_list else "✗", "m2": "✓" if r.m2_list else "✗",
                "nsafe": _num(r.n_safe), "acr": _pct(r.acr), "short": True, "ns": r.n_staples, "nc": r.n_competitor}
               for r in nfa[nfa["shortlisted"]].sort_values("final_rank").itertuples()]
        excl = [{"a": arch(r.name, r.combo, r.combo_full), "set": _set(r), "reason": r.exclusion_reason, "tier": r.tier, "vos": _num(r.vos, 1), "tg": _num(r.tg, 1)}
                for r in nfa[~nfa["shortlisted"] & (nfa["depth"] > 0)].itertuples()]
        nrec = recs[recs["node_id"] == nid] if len(recs) else recs
        sku_groups = []
        for r in nfa[nfa["shortlisted"]].sort_values("final_rank").itertuples():
            rows = nrec[nrec["archetype_id"] == r.archetype_id].sort_values("exemplar_rank")
            sku_groups.append({"rank": int(r.final_rank), "a": arch(r.name, r.combo_full or r.combo), "tier": r.tier,
                               "cards": [_card(x, comp) for x in rows.itertuples()]})
        nse = se[se["node_id"] == nid] if len(se) else se
        se_cards = []
        for x in nse.drop_duplicates("title").itertuples():    # same listing under several ids: show once
            c_ = _card(x, comp, arch_names)
            c_["ext"] = _extended(x, look, nid)
            se_cards.append(c_)
        vend_rows = [{"brand": _brand(r.brand), "products": r.products, "arch": r.archetypes, "path": r.recruit_path,
                      "on": r.brand_on_staples, "house": r.house_brand} for r in nvend.head(25).itertuples()]
        gsel = ng[(ng["credibility"] >= 0.9) | (ng["credibility"] <= 0.1)].assign(a=lambda x: x["delta"].abs()).nlargest(30, "a")
        gap_rows = []
        t2 = set(tier2_attrs(nid))
        tier_of = lambda a: (1 if a in TIER1_ATTRS else 2 if a in t2 else 3)
        amax = gsel.groupby("attribute")["a"].max()
        for attr in sorted(amax.index, key=lambda a: (tier_of(a), -amax[a])):
            gg = gsel[gsel["attribute"] == attr].sort_values("delta", ascending=False)
            gap_rows.append({"attr": attr_label(nid, attr), "desc": bool(gg["descriptive_only"].any()),
                             "tier": TIER_NAMES[tier_of(attr)],
                             "rows": [{"val": pretty_value(r.value), "sc": _pct(r.share_competitor), "ss": _pct(r.share_staples),
                                       "delta": f"{r.delta:+.0%}", "cred": _pct(r.credibility), "pos": r.delta > 0}
                                      for r in gg.itertuples()]})
        q6 = qa6.get(nid, {})
        sets_txt = []
        for lq in q6.get("lenses") or [q6]:
            tiers = dict(zip(lq.get("core_facets", []), lq.get("core_tiers", [])))
            t = ", ".join(f"{facet_label(nid, f)} ({tiers[f].replace('tier', 'T')})" for f in lq.get("core_facets", []))
            if lq.get("refinement_facets"):
                t += "; refined by " + ", ".join(facet_label(nid, f) for f in lq["refinement_facets"])
            if t:
                sets_txt.append((f"Set {chr(64 + lq['lens'])}: " if len(q6.get("lenses") or []) > 1 else "") + t)
        facets_txt = ""
        if q6.get("small_node_relaxed"):
            facets_txt += (f"Small node: combinations of ≥ {q6['min_support']['pooled']} families allowed "
                           f"(standard {cfg()['archetypes']['min_pooled']})")
        base.update({
            "rho": qi["spearman_vos_tg"].get(nid),
            "rho_note": agreement_insight(qi["spearman_vos_tg"].get(nid), int((nfa["shortlisted"] & (nfa["tier"] == "Strong")).sum()),
                                          int(nfa["shortlisted"].sum())),
            "insights": ins, "figs": figs, "facets": facets_txt, "facet_sets": sets_txt, "n_sets": len(q6.get("lenses") or []),
            "n_arch": int((nfa["depth"] > 0).sum()), "tail": q6.get("long_tail_share"),
            "relaxed": q6.get("tier_min_relaxed") or [],
            "m1": m1, "m2": m2, "final": fin, "excluded": excl, "skus": sku_groups, "style_ext": se_cards,
            "vendors": vend_rows, "gaps": gap_rows, "price_lines": p_lines, "ladder": ladder,
            "price_median_c": _money(ns_row["price_median_competitor"]), "price_median_s": _money(ns_row["price_median_staples"]),
            "highconf": 1 - float(np.nan_to_num(mp.loc[(mp["node_id"] == nid) & (mp["status"] == "mapped"), "low_conf"].mean())),
            "backlog": int(((mp["pred_node"] == nid) & mp["status"].isin(["none_misshelved", "none_far"])).sum()),
        })
        sections.append(base)

    node_list = sorted(node_list, key=lambda n: (n["l1"], n["label"]))
    st_counts = nodes["status"].value_counts().to_dict()
    ctx = {
        "title": cfg()["report"]["title"], "date": dt.date.today().isoformat(),
        "encoder": qm["encoder"], "bakeoff": qm["bakeoff"], "backend": qx["backend"],
        "gates": build_gates(qm, qx, qa6, qv, qi), "nodes": node_list, "sections": sections,
        "safety_gates": build_safety_gates(qm, mp, cand, fa, recs, se, qv),
        "focus": [{"rank": s["rank"], "segment": s["segment"], "label": s["label"], "status": s["status"],
                   "status_label": s["status_label"], "comp": s["planned"].split(",")[0].strip() if s["status"] == "staples_only" else s["comp"]}
                  for s in sections],
        "n_scored": st_counts.get("scored", 0), "n_thin": st_counts.get("thin", 0), "n_pending": st_counts.get("staples_only", 0),
        "n_st_fam": int(nodes["n_staples"].sum()), "n_comp_fam": int(nodes["n_competitor"].sum()),
        "n_backlog": int(len(backlog)),
        "low_conf_prob": cfg()["mapping"]["low_conf_prob"], "mapping_k": cfg()["mapping"]["k"],
        "cfg": cfg(), "label_counts": qv["label_counts"], "tier_counts": qi["tier_counts"], "M": METRICS, "m": m,
        "calib": {l2: q["calibration"] for l2, q in qv.items() if isinstance(q, dict) and "calibration" in q},
        "thresholds": {l2: q["thresholds"] for l2, q in qv.items() if isinstance(q, dict) and "thresholds" in q},
        "aas_t": _aas_ranges(qv),
        "ex": exec_summary(nodes, nsum, fa, cand, recs, vend, bands, qi, gaps),
    }
    env = Environment(loader=FileSystemLoader(str(ROOT / "src" / "alpoc" / "templates")), autoescape=True)
    html = env.get_template("report.html.j2").render(**ctx)
    p = next_report_path(cfg()["report"]["file_stem"])
    p.write_text(html, encoding="utf-8")
    log_msg = f"S9 report: {p} ({p.stat().st_size / 1e6:.1f} MB), {len(sections)} node sections"
    from .common import log
    log(log_msg)
    return {"report": str(p), "size_mb": p.stat().st_size / 1e6}


def _brand(b) -> str:
    return b if isinstance(b, str) and b.strip() else "(brand not shown)"


def _s(v) -> str:
    return "–" if v is None or (isinstance(v, float) and np.isnan(v)) or v == "" else str(v)


def _card(x, comp, arch_names=None) -> dict:
    a = None
    if arch_names is not None and isinstance(getattr(x, "archetype_id", None), str) and x.archetype_id in arch_names.index:
        r = arch_names.loc[x.archetype_id]
        a = arch(r["name"], r["combo"])
    return {"title": x.title, "url": x.url, "price": _money(x.price), "brand": _brand(x.brand),
            "house": bool(x.house_brand), "on": bool(x.brand_on_staples), "label": x.label, "colour": _s(x.colour_family),
            "material": _s(x.material_class), "style": _s(x.style_family), "dfi": _num(x.dfi, 2),
            "crs": _num(x.crs), "ppr": _num(x.ppr, 2), "ad": _num(x.ad, 2), "arch": a,
            "basis": x.basis if isinstance(getattr(x, "basis", None), str) else None,
            "m2": (x.m2_label.replace("ATTR-", "attribute ").replace("NO-TWIN", "no Staples twin").lower()
                   if isinstance(getattr(x, "m2_label", None), str) else None),
            "st_title": x.st_title, "st_url": x.st_url, "st_price": _money(x.st_price),
            "st_colour": _s(x.st_colour_family), "st_material": _s(x.st_material_class), "comp": comp,
            "ext": []}


def _extended(x, look, nid) -> list:
    """What a style extension changes vs its nearest Staples product: the same look fields AD (Aesthetic Delta) uses."""
    if look is None or x.family_id not in look.index or x.st_family_id not in look.index:
        return []
    c, st = look.loc[x.family_id], look.loc[x.st_family_id]
    out_ = []
    for k in AESTHETIC:
        cv, sv = c[k], st[k]
        if _s(cv) != "–" and str(cv) != str(sv):
            out_.append({"k": attr_label(nid, k), "c": pretty_value(cv), "st": pretty_value(sv) if _s(sv) != "–" else "not stated"})
    new_tags = [t for t in split_multi(c["aesthetic_tags"]) if t not in split_multi(st["aesthetic_tags"])]
    if new_tags:
        out_.append({"k": attr_label(nid, "aesthetic_tags"), "c": ", ".join(pretty_value(t) for t in new_tags),
                     "st": ", ".join(pretty_value(t) for t in split_multi(st["aesthetic_tags"])) or "not stated"})
    return out_
