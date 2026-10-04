#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=====================================================================================
 STAPLES MARKETPLACE PoC  -  CATEGORY-LEVEL RECOMMENDATION  (report builder)
 build_html.py : the client deliverable - one self-contained, two-tab static HTML page
=====================================================================================

Run AFTER run_framework.py. Reads only what the pipeline wrote, so every number on the page traces to
outputs/final/summary_v3.json, units_all.csv, opportunities.csv or Category_Recommendations_v3.xlsx:

   Tab 1  Approach & Methodology   question, data (every Excel row reconciled), flow (Methods V and G in
                                   parallel), scores, framework charts (AAS vs CRS zones, brand gate),
                                   matching quality (in-sample vs cross-validated), robustness, caveats
   Tab 2  Gaps & Recommendations   KPIs, decision picture (collapsible), category opportunities: zone /
                                   theme filter -> sub-category table (by opportunity, descending) ->
                                   opportunity deep dives (collapsed); findability, pass and watch lists
                                   (collapsed)

Styling follows the product-level PoC page (report_style.css: same tokens, light/dark, tabs, tables).
Figures are embedded as base64 PNG, so the file opens offline.

Run:  python build_html.py          (writes <project>/reports/Staples_Category_Recommendations_<version>.html)
Each published change gets a new version (REPORT_VERSION or env POC_REPORT_VERSION); older reports stay in
reports/ untouched.
"""
import base64
import html
import io
import json
import os
import re

import numpy as np
import pandas as pd

import poc_common as pc
from poc_common import CONFIG, LABEL_COLOR

FINAL = pc.out_path("final", "")
REPORT_VERSION = os.environ.get("POC_REPORT_VERSION", "v4")
REPORTS_DIR = os.path.join(pc.HERE, "..", "..", "reports")
OUT_HTML = os.environ.get("POC_HTML", os.path.join(REPORTS_DIR, f"Staples_Category_Recommendations_{REPORT_VERSION}.html"))
V2_SUMMARY = os.environ.get("POC_V2_SUMMARY", os.path.join(pc.HERE, "..", "..", "Outputs", "final", "summary.json"))
SHORT = {"OfficeDepot": "Office Depot", "WestElm": "West Elm", "Wayfair": "Wayfair", "Amazon": "Amazon",
         "Walmart": "Walmart", "Staples": "Staples", "Target": "Target"}
ACT = ["CURATE", "VERTICAL EXTENSION", "REVIEW", "1P-CORE GAP"]


# ---------------------------------------------------------------------------------------
# small HTML helpers
# ---------------------------------------------------------------------------------------
def e(x):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return ""
    return html.escape(str(x))


def n0(x):
    return "" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:,.0f}"


def pct(x, d=0):
    return "–" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.{d}f}%"


def f2(x):
    return "" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.2f}"


def arrow(p):
    return e(str(p)).replace(" &gt; ", " → ")


def zslug(z):
    return re.sub(r"[^A-Za-z0-9]", "", str(z))


def chip(z):
    return f'<span class="chip z-{zslug(z)}">{e(z)}</span>'


def table(headers, rows, num=(), cls="sortable", grp=None):
    """headers: list of str; rows: list of lists of HTML-ready cell strings; num: indexes right-aligned."""
    th = "".join(f'<th class="{"num" if i in num else ""}">{h}</th>' for i, h in enumerate(headers))
    body = []
    for r in rows:
        body.append("<tr>" + "".join(f'<td class="{"num" if i in num else ""}">{c}</td>' for i, c in enumerate(r))
                    + "</tr>")
    return f'<div class="tbl-wrap"><table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{"".join(body)}' \
           f'</tbody></table></div>'


def fig(name, caption, solo=False):
    p = os.path.join(FINAL, "figures", name)
    if not os.path.exists(p):
        return f'<p class="muted small">(figure {e(name)} not produced in this run)</p>'
    b64 = base64.b64encode(open(p, "rb").read()).decode()
    return f'<figure class="fig{" solo" if solo else ""}"><img alt="{e(caption)}" loading="lazy" ' \
           f'src="data:image/png;base64,{b64}"><figcaption>{e(caption)}</figcaption></figure>'


def fig_png(figobj, caption, solo=False):
    """Embed a matplotlib figure made by this builder (report-only charts)."""
    buf = io.BytesIO()
    figobj.savefig(buf, format="png", dpi=170, bbox_inches="tight", facecolor="white")
    import matplotlib.pyplot as plt
    plt.close(figobj)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f'<figure class="fig{" solo" if solo else ""}"><img alt="{e(caption)}" loading="lazy" ' \
           f'src="data:image/png;base64,{b64}"><figcaption>{e(caption)}</figcaption></figure>'


def _zone_axes(ax, C, labels=True, alpha=0.10):
    """Shade the CRS (x) x AAS (y) decision zones."""
    from matplotlib.patches import Rectangle
    zones = [("1P-CORE GAP", C["crs_hi"], 100, 0, 100), ("REVIEW", C["crs_lo"], C["crs_hi"], 0, 100),
             ("CURATE", 0, C["crs_lo"], C["aas_hi"], 100), ("VERTICAL EXTENSION", 0, C["crs_lo"], C["aas_lo"], C["aas_hi"]),
             ("OFF-BRAND", 0, C["crs_lo"], 0, C["aas_lo"])]
    for lab, x0, x1, y0, y1 in zones:
        ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc=LABEL_COLOR[lab], alpha=alpha, lw=0, zorder=0))
        if labels:
            ax.text((x0 + x1) / 2, y1 - 3, lab.replace("VERTICAL EXTENSION", "VERTICAL\nEXTENSION").replace(
                "1P-CORE GAP", "1P-CORE\nGAP"), ha="center", va="top", fontsize=9.5, weight="bold", color="#2b2b2b",
                zorder=5)
    for x in (C["crs_lo"], C["crs_hi"]):
        ax.axvline(x, color="#8a8984", lw=0.8, ls=(0, (3, 3)), zorder=1)
    for y in (C["aas_lo"], C["aas_hi"]):
        ax.plot([0, C["crs_lo"]], [y, y], color="#8a8984", lw=0.8, ls=(0, (3, 3)), zorder=1)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.set_xlabel("Cannibalisation risk to Staples 1P  (CRS, 0-100)  →")
    ax.set_ylabel("Adjacency to what Staples sells  (AAS, 0-100)  →")
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)


def framework_figures(S, U):
    """Three charts that explain the framework: the AAS x CRS zone map, every unit on it, and the brand gate."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    C = S["config"]
    out = []
    # 1 - the rule as a map
    f, ax = plt.subplots(figsize=(8.6, 5.6))
    _zone_axes(ax, C)
    notes = [(C["crs_lo"] / 2, (C["aas_hi"] + 100) / 2 - 8, "gap right next to\nwhat Staples sells,\nlittle 1P at stake"),
             (C["crs_lo"] / 2, (C["aas_lo"] + C["aas_hi"]) / 2 - 3, "one step further out:\nenter via a vertical"),
             (C["crs_lo"] / 2, C["aas_lo"] / 2 - 3, "far from Staples'\ncustomers: pass"),
             ((C["crs_lo"] + C["crs_hi"]) / 2, 45, "sits next to a\n1P line: merchant\ndecision"),
             ((C["crs_hi"] + 100) / 2, 45, "competes with Staples'\nown core shelf:\nfix in 1P")]
    for x, y, t in notes:
        ax.text(x, y, t, ha="center", va="center", fontsize=8.6, color="#52514e")
    ax.set_title("The decision framework: adjacency (AAS) x cannibalisation risk (CRS)", fontsize=11.5, loc="left")
    f.text(0.01, -0.04, f"Applied after the brand-safety screen (EXCLUDED). Below the brand gate (BFS < {C['bfs_gate']}) "
                        f"a low-CRS category is OFF-BRAND whatever its adjacency; residential categories drop one zone.",
           fontsize=8.3, color="#52514e")
    out.append(fig_png(f, "The decision framework as a map: each zone is a region of the AAS x CRS plane"))
    # 2 - every consensus unit on the map
    R = recommendable(U)
    R = R[~R.label.isin(["EXCLUDED"])]
    f, ax = plt.subplots(figsize=(8.6, 5.8))
    _zone_axes(ax, C, alpha=0.07)
    rj = np.random.default_rng(3)
    for lab in ["OFF-BRAND", "1P-CORE GAP", "REVIEW", "VERTICAL EXTENSION", "CURATE", "VERIFY"]:
        d = R[R.label == lab]
        x = np.where(d.CRS < 1, d.CRS + rj.uniform(0, 2.5, len(d)), d.CRS).clip(0, 99.5)
        mk = dict(facecolors="none", edgecolors=LABEL_COLOR[lab], linewidths=1.1) if lab == "VERIFY" else \
            dict(c=LABEL_COLOR[lab], edgecolors="white", linewidths=0.5)
        ax.scatter(x, d.AAS.clip(0, 100), s=18 + 140 * d.O.clip(0, 1) ** 1.5, alpha=0.45 if lab == "OFF-BRAND" else 0.85,
                   label=f"{lab} ({len(d)})", zorder=3, **mk)
    ax.legend(loc="lower right", fontsize=7.8, frameon=True, facecolor="white", edgecolor="#e6e5e0")
    ax.set_title("Every sub-category seen at 2+ competitors, placed by the framework", fontsize=11.5, loc="left")
    f.text(0.01, -0.04, "Grey dots inside the CURATE / VERTICAL EXTENSION regions are OFF-BRAND by the brand gate or the "
                        "residential downgrade; hollow violet = VERIFY (probably already sold). Size = opportunity O.",
           fontsize=8.3, color="#52514e")
    out.append(fig_png(f, "All consensus sub-categories on the AAS x CRS plane (colour = final zone)"))
    # 3 - the brand gate for the low-CRS units
    L = R[(R.CRS < C["crs_lo"]) & R.label.isin(["CURATE", "VERTICAL EXTENSION", "OFF-BRAND"])]
    f, ax = plt.subplots(figsize=(8.6, 5.2))
    ax.axhspan(0, C["bfs_gate"], color=LABEL_COLOR["OFF-BRAND"], alpha=0.10, lw=0)
    ax.axhline(C["bfs_gate"], color="#8a8984", lw=0.9, ls=(0, (3, 3)))
    for x in (C["aas_lo"], C["aas_hi"]):
        ax.axvline(x, color="#8a8984", lw=0.8, ls=(0, (3, 3)))
    for lab in ["OFF-BRAND", "VERTICAL EXTENSION", "CURATE"]:
        d = L[L.label == lab]
        res = d.residential.astype(bool)
        ax.scatter(d.AAS[~res], d.BFS[~res], s=30, c=LABEL_COLOR[lab], alpha=0.8, edgecolors="white", lw=0.5,
                   label=f"{lab}")
        ax.scatter(d.AAS[res], d.BFS[res], s=34, marker="^", c=LABEL_COLOR[lab], alpha=0.8, edgecolors="white", lw=0.5)
    ax.scatter([], [], marker="^", color="#8a8984", label="residential (drops one zone)")
    ax.text(1, C["bfs_gate"] - 3, f"brand gate: BFS < {C['bfs_gate']} → OFF-BRAND", fontsize=8.5, color="#52514e", va="top")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.set_xlabel("Adjacency (AAS)  →")
    ax.set_ylabel("Workplace brand fit (BFS)  →")
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.legend(loc="upper left", fontsize=8, frameon=True, facecolor="white", edgecolor="#e6e5e0")
    ax.set_title(f"The brand gate, for low-risk categories (CRS < {C['crs_lo']})", fontsize=11.5, loc="left")
    out.append(fig_png(f, "Why adjacency alone is not enough: the brand gate removes adjacent but residential / leisure categories"))
    return out


def _labels(ax, pts):
    """Place text labels without overlaps (adjustText when available)."""
    texts = [ax.text(x, y, t, fontsize=8.4, zorder=6, color="#0b0b0b") for x, y, t in pts]
    try:
        from adjustText import adjust_text
        adjust_text(texts, ax=ax, arrowprops=dict(arrowstyle="-", color="#8a8984", lw=0.6),
                    expand=(1.2, 1.5), force_text=(0.4, 0.6))
    except Exception:  # noqa
        pass


def short_name(x, n=30):
    x = str(x).split(" (e.g.")[0]
    return x if len(x) <= n else x[:n - 1].rstrip() + "…"


def opp_crs_chart(S, Opp):
    """Decision picture 1: the category opportunities (same units as the tiles) on the AAS x CRS plane.
    Label = the opportunity's lead sub-category; top 5 labelled in CURATE, VERTICAL EXTENSION, REVIEW."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    C = S["config"]
    oz = Opp.label.value_counts()
    f, ax = plt.subplots(figsize=(11, 6.8))
    _zone_axes(ax, C, alpha=0.08)
    ax.set_xlim(-5, 100)
    size = lambda o: 50 + 800 * np.sqrt(np.clip(o, 0, None) / max(Opp.O_sum.max(), 1e-9))
    pts = []
    for lab in ["1P-CORE GAP", "REVIEW", "VERTICAL EXTENSION", "CURATE"]:
        d = Opp[Opp.label == lab]
        ax.scatter(d.CRS.clip(0, 99), d.AAS.clip(0, 100), s=size(d.O_sum), c=LABEL_COLOR[lab], alpha=0.8,
                   edgecolors="white", lw=1, zorder=3)
        if lab != "1P-CORE GAP":
            pts += [(min(r.CRS, 99), r.AAS, short_name(r["lead"])) for _, r in d.head(5).iterrows()]
    _labels(ax, pts)
    ax.set_title(f"{oz.get('CURATE', 0)} CURATE, {oz.get('VERTICAL EXTENSION', 0)} VERTICAL EXT, "
                 f"{oz.get('REVIEW', 0)} REVIEW & {oz.get('1P-CORE GAP', 0)} 1P-CORE GAP: Adjacency vs Cannibalisation",
                 fontsize=12, loc="left", weight="bold")
    return fig_png(f, "Each dot is one category opportunity: related sub-categories in one zone and one Staples "
                      "department. Size = its total opportunity score; label = its lead sub-category (top 5 per zone; "
                      "1P-CORE GAP unlabelled). Only sub-categories carried by 2 or more competitors count.")


def opp_bfs_chart(S, Opp):
    """Decision picture 2: brand fit vs adjacency for the same opportunities, labelled by lead sub-category."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    C = S["config"]
    f, ax = plt.subplots(figsize=(11, 6.6))
    ax.axhspan(0, C["bfs_gate"], color=LABEL_COLOR["OFF-BRAND"], alpha=0.10, lw=0)
    ax.axhline(C["bfs_gate"], color="#8a8984", lw=0.8, ls=(0, (3, 3)))
    for x in (C["aas_lo"], C["aas_hi"]):
        ax.axvline(x, color="#8a8984", lw=0.8, ls=(0, (3, 3)))
    size = lambda o: 50 + 800 * np.sqrt(np.clip(o, 0, None) / max(Opp.O_sum.max(), 1e-9))
    pts = []
    for lab in ["1P-CORE GAP", "REVIEW", "VERTICAL EXTENSION", "CURATE"]:
        d = Opp[Opp.label == lab]
        ax.scatter(d.AAS.clip(0, 100), d.BFS.clip(0, 100), s=size(d.O_sum), c=LABEL_COLOR[lab], alpha=0.8,
                   edgecolors="white", lw=1, zorder=3, label=lab)
        if lab != "1P-CORE GAP":
            pts += [(r.AAS, r.BFS, short_name(r["lead"])) for _, r in d.head(5).iterrows()]
    _labels(ax, pts)
    ax.text(1, C["bfs_gate"] + 1, f"brand gate (BFS {C['bfs_gate']})", fontsize=8, color="#52514e")
    ax.set_xlim(0, 102)
    ax.set_ylim(0, 102)
    ax.set_xlabel("Adjacency to what Staples already sells (AAS, 0-100)  →")
    ax.set_ylabel("Workplace brand fit (BFS, 0-100)  →")
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.legend(loc="lower right", fontsize=8.5, markerscale=0.5, frameon=True, facecolor="white", edgecolor="#e6e5e0")
    ax.set_title(f"{len(Opp)} category opportunities: brand fit vs adjacency", fontsize=12, loc="left", weight="bold")
    return fig_png(f, "Same opportunities: workplace brand fit vs adjacency. Size = total opportunity score; label = lead "
                      "sub-category (top 5 per zone; 1P-CORE GAP unlabelled).")


def bar(v, color="var(--accent)"):
    v = 0 if v is None or (isinstance(v, float) and np.isnan(v)) else max(0, min(100, float(v)))
    return f'<span class="bar"><i style="width:{v:.0f}%;background:{color}"></i></span><span class="bv">{v:.0f}</span>'


def lede(txt):
    return f'<p class="lede">{txt}</p>'


# ---------------------------------------------------------------------------------------
def load():
    S = json.load(open(os.path.join(FINAL, "summary_v3.json"), encoding="utf-8"))
    U = pd.read_csv(os.path.join(FINAL, "units_all.csv"))
    Opp = pd.read_csv(os.path.join(FINAL, "opportunities.csv")) if os.path.exists(
        os.path.join(FINAL, "opportunities.csv")) else pd.DataFrame()
    xl = os.path.join(FINAL, "Category_Recommendations_v3.xlsx")
    recon = pd.read_excel(xl, sheet_name="Row_Reconciliation")
    V2 = json.load(open(V2_SUMMARY, encoding="utf-8")) if os.path.exists(V2_SUMMARY) else {}
    return S, U, Opp, recon, V2


def recommendable(U):
    return U[(U.gap_type == "DEEPEN") | (U.k >= 2)]


# ---------------------------------------------------------------------------------------
# TAB 1 - APPROACH & METHODOLOGY
# ---------------------------------------------------------------------------------------
def tab_method(S, U, Opp, recon, V2):
    C = S["config"]
    R = S["retailers"]
    cal = S["calibration"]
    o = []
    o.append('<h2 style="margin-top:0">The question</h2>')
    o.append("<p>Staples does not sell everything a workplace buys. Some categories are missing, or carried only "
             "thinly, on Staples.com while Office Depot and the big marketplaces sell them. This PoC uses only the "
             "public category trees of Staples and five competitors to answer four questions:</p>")
    o.append("<ul><li><b>Where are the gaps?</b> Categories competitors carry that Staples does not (<i>new</i>), "
             "or carries much more thinly (<i>deepen</i>).</li>"
             "<li><b>Are they within Staples' brand reach?</b> Would a business, school, clinic, hotel or home-office "
             "buyer expect to find them at Staples? Antique collectables would fail this test.</li>"
             "<li><b>Are they easy to open, and do they help Staples compete with the marketplaces?</b></li>"
             "<li><b>Are they safe for Staples' own (1P) assortment?</b> Would a marketplace there take sales from "
             "Staples' core shelves?</li></ul>")
    o.append(lede("<b>Brand reach, as defined for this PoC: workplace-first.</b> A category is in reach when a "
                  "workplace buyer mission plausibly includes it: office, home office, breakroom, janitorial and "
                  "facilities, safety, school and classroom, healthcare, hospitality and foodservice, retail store "
                  "and shipping, workspace décor, and commercial grounds. Residential lifestyle categories "
                  "(bedding, kids' and teen bedrooms, home décor) are <i>downgraded</i>, not banned. Brand-unsafe "
                  "categories (adult, weapons, tobacco, alcohol making, Rx and similar) are excluded outright."))

    # ---- data
    o.append("<h2>The evidence: six category trees, every row accounted for</h2>")
    o.append('<p class="ink2">One adapter per retailer reads its tree into a common table. Office Depot is the '
             'closest B2B peer (the mirror). West Elm and Wayfair are the design lens; Wayfair also has a '
             'Professional (B2B) section. Amazon and Walmart are the scale marketplaces Staples competes with; '
             'Walmart also has Walmart for Business.</p>')
    rows = []
    for r, d in R.items():
        c = cal.get(r, {})
        cnt = {"terminal_only": "Leaf pages", "cumulative": "All pages", "partial": "L1–L2 only",
               "none": "None (breadth only)"}[d["count_mode"]]
        rows.append([f"<b>{e(SHORT[r])}</b>", e(d["role"]), n0(d.get("rows_in_file")), n0(d["shelves_in_scope"]),
                     n0(d["leaf_shelves"]), f"L{d['max_depth']}", e(cnt),
                     n0(c.get("n_labelled")) if c else "–", pct(c.get("top1_V")) if c else "–",
                     pct(c.get("top1_V_nested_cv")) if c else "–"])
    o.append(table(["Retailer", "Role", "Rows in file", "Shelves in scope", "Leaf shelves", "Depth",
                    "Item counts", "Labelled rows", "Top-1 match", "Top-1 (CV)"], rows, num={2, 3, 4, 7, 8, 9}))
    o.append('<p class="muted small">Leaf shelves count Walmart, Office Depot and West Elm L5 pages folded into '
             'their L4 parent. Top-1 match = share of labelled competitor shelves whose predicted Staples shelf is '
             'right (or its parent/child), Method V. CV = the encoder choice made inside 5-fold cross-validation.</p>')

    rr = S.get("row_reconciliation", {})
    tot = rr.get("by_status", {})
    o.append("<h3>Row reconciliation: every sheet, every row</h3>")
    o.append(f"<p>All {n0(rr.get('sheets'))} sheets in the 7 workbooks ({n0(rr.get('total_rows'))} data rows) are "
             f"accounted for: <b>{n0(tot.get('used'))}</b> rows used in the analysis, "
             f"<b>{n0(tot.get('dropped'))}</b> dropped with a stated reason, <b>{n0(tot.get('reference'))}</b> in "
             f"reference-only sheets (summaries, logs, notes) and <b>{n0(tot.get('not used'))}</b> in the Target "
             f"file the team marked 'not using'. "
             f"Sheets where the status counts do not add up to the rows: <b>{n0(rr.get('mismatched_sheets'))}</b>.</p>")
    fr = []
    for (f_, sh), g in recon.groupby(["file", "sheet"], sort=False):
        bys = g.groupby("status")["rows"].sum()
        det = "; ".join(f"{e(d)} ({n0(n)})" for d, n in g.sort_values("rows", ascending=False)[["detail", "rows"]]
                        .itertuples(index=False))
        fr.append([e(f_), e(sh), n0(g["rows_in_sheet"].iloc[0]), n0(bys.get("used", 0)), n0(bys.get("dropped", 0)),
                   n0(bys.get("reference", 0) + bys.get("not used", 0)), f'<span class="small">{det}</span>'])
    o.append(f'<details><summary>Show the reconciliation by sheet ({len(fr)} sheets)</summary>'
             + table(["File", "Sheet", "Rows", "Used", "Dropped", "Reference / not used", "Detail"], fr,
                     num={2, 3, 4, 5}) + "</details>")

    # ---- flow
    o.append("<h2>How we approached it</h2>")
    o.append("<p>Nine stages in four phases: make the comparison fair, match every competitor shelf to Staples two "
             "independent ways, turn gaps into units and opportunities, then score and decide.</p>")
    steps = [
        ("1 · Make the comparison fair", None),
        ("S0", ("Load, scope & reconcile",
                "Six adapters build one table. A common department universe applies to every retailer, and "
                "merchandising pages, facets and headings are removed.",
                ["Every row → used / dropped / reference", "L5 folded into L4", "OD unmapped pages placed",
                 "Breakroom & classroom whitelist"],
                "Node table, Row_Reconciliation sheet", "pandas · openpyxl · regex adapters")),
        ("S1", ("Represent every shelf",
                "Each shelf is its label plus whatever path its retailer shows above it, with weights that decay "
                "going up the path (level-agnostic).",
                ["Own label 0.40 (Staples 0.70)", "Ancestors, decaying", "Headings skipped"],
                "Path vectors; wording + thesaurus profiles", "sentence-transformers · BAAI/bge-base-en-v1.5 (bake-off winner) · TF-IDF")),
        ("2 · Match two independent ways, in parallel", None),
        ("FORK", [
            ("S2a", ("Method V · vectors",
                     "The 50 nearest Staples shelves come from a Qdrant vector database (one collection per "
                     "retailer) and are re-scored on wording. Thresholds are calibrated per competitor.",
                     ["Top-50 by cosine", "+ wording rerank", "τ_V per competitor"],
                     "Verdict, AAS_V, CRS_V per shelf", "bge-base · Qdrant")),
            ("S2b", ("Method G · knowledge graph",
                     "The six trees form one graph. A match is more likely when the parents and children also "
                     "match (similarity flooding); adjacency comes from PageRank. Thresholds are calibrated per "
                     "competitor.",
                     ["Wording + thesaurus", "3 rounds of flooding", "τ_G per competitor"],
                     "Verdict, AAS_G, CRS_G per shelf", "NetworkX · Neo4j export")),
        ]),
        ("S3", ("Combine & verify",
                "The two verdicts are combined: a gap needs both methods to find nothing close (one confident "
                "match means not a gap; gap + likely is a soft gap). AAS and CRS are averaged. Verified labels "
                "override both methods.",
                ["V ∧ G → carried / soft gap / hard gap", "AAS, CRS = mean(V, G)", "Verification loop"],
                "Ensemble status per shelf", "run_framework.build_node_table")),
        ("3 · From gaps to opportunities", None),
        ("S4", ("Build units",
                "<i>New</i>: competitor subtrees whose shelves Staples mostly lacks, merged across competitors and "
                "searched in every competitor's collection. <i>Deepen</i>: Staples aisles where two or more "
                "competitors are at least twice as deep after size normalisation.",
                ["ENTER concepts", "DEEPEN aisles", "peer coverage k of 5"], "Units", "agglomerative clustering")),
        ("S5", ("Dock & roll up",
                "Each unit docks into a Staples aisle by mission similarity plus graph/vector votes; catch-all "
                "departments are never docks. Consensus units roll up into category opportunities: one per zone and "
                "Staples department.",
                ["Mission-aware docking", "zone × department opportunities", "Watch list = 1 competitor"],
                "Opportunities sheet", "bge-base · graph votes")),
        ("4 · Score & decide", None),
        ("S6", ("Score",
                "Adjacency (AAS), cannibalisation risk (CRS), workplace brand fit (BFS), ease (EASE), peer "
                "consensus split into B2B and marketplace channels, and gap size, combined into one opportunity "
                "score O.",
                ["AAS · CRS · BFS", "EASE · PC b2b / mkt · GS", "O"], "Scores per unit and opportunity",
                "NumPy")),
        ("S7", ("Decide",
                "The zone rule applies the safety screen first, then cannibalisation, then the brand gate, then "
                "adjacency. Residential categories drop one zone.",
                ["EXCLUDED → 1P-CORE GAP → REVIEW", "OFF-BRAND gate", "CURATE / VERTICAL EXT.", "VERIFY"],
                "Zone, reason and action per unit", "rules in poc_common.label_row")),
        ("S8", ("Stress-test",
                "500 runs re-draw the weights, jitter every threshold and the brand gate, and scale CRS by ±20%. "
                "A further 200 gold-label bootstraps re-fit the thresholds and re-test every gap verdict.",
                ["p_zone", "p_top_n", "p_gap"], "Stability per unit", "NumPy")),
    ]
    def step_html(tag, body):
        h, p_, chain, out_, tech = body
        cls = " m1" if "Method V" in h else " m2" if "Method G" in h else ""
        ch = '<span class="to">→</span>'.join(f'<span class="pill">{e(c)}</span>' for c in chain)
        return (f'<div class="fc-step{cls}"><div class="fc-tag">{e(tag)}</div><div><h4>{e(h)}</h4><p>{p_}</p>'
                f'<div class="chain">{ch}</div><div class="meta"><span class="k">Output</span>{e(out_)}</div>'
                f'<div class="meta"><span class="k">Tech</span><span class="tech">{e(tech)}</span></div></div></div>')

    two_arrows = '<div class="fc-fork"><div class="fc-arrow"></div><div class="fc-arrow"></div></div>'
    fc = ['<div class="fc">']
    for tag, body in steps:
        if body is None:
            fc.append(f'<div class="fc-phase">{e(tag)}</div>')
            continue
        if tag == "FORK":
            fc[-1] = two_arrows if fc[-1] == '<div class="fc-arrow"></div>' else fc[-1]
            fc.append('<div class="fc-fork">' + "".join(step_html(t, b) for t, b in body) + "</div>")
            fc.append(two_arrows)
            continue
        fc.append(step_html(tag, body))
        fc.append('<div class="fc-arrow"></div>')
    fc = fc[:-1] + ["</div>"]
    o.append("".join(fc))

    # ---- scores and zones
    w = C["rank_weights"]
    o.append("<h2>The scores</h2>")
    srow = [
        ["<b>AAS</b> adjacency", "0–100", "How embedded the category is in what Staples already sells. 100 = as "
         "embedded as a typical shelf Staples carries.", "Mean of Method V (density of the 10 nearest Staples "
         "shelves) and Method G (PageRank lift + sibling coverage), on one pooled quantile scale"],
        ["<b>CRS</b> cannibalisation risk", "0–100", "How much Staples 1P revenue a marketplace here would put at "
         "risk.", "Closeness to a Staples shelf × that shelf's coreness (paper and office supplies high, décor "
         f"low). V3 halves it when the driver shelf is not about the same thing (similarity &lt; "
         f"{C['crs_driver_min_sim']:.2f})"],
        ["<b>BFS</b> brand fit <span class='planned'>new in V3</span>", "0–100", "Workplace-first fit with the "
         "Staples brand.", f"{C['bfs_w_mission']:.1f} × mission score (zero-shot: closeness to 12 workplace buyer "
         f"missions vs 5 residential/leisure missions; 100 = a typical Staples core shelf) + {C['bfs_w_b2b']:.1f} × "
         "share of the 3 B2B channels carrying it"],
        ["<b>EASE</b> <span class='planned'>new in V3</span>", "0–100", "How easy it is to open to sellers.",
         "50 + 50 × marketplace supply (share of Amazon/Walmart carrying it) − 25 per complexity flag (bulky "
         "freight, install required, regulated, perishable); DEEPEN +15"],
        ["<b>PC_b2b / PC_mkt</b> <span class='planned'>new in V3</span>", "0–1", "Peer consensus by channel.",
         "Share of B2B channels (Office Depot, Wayfair Professional, Walmart for Business) and of scale "
         "marketplaces (Amazon, Walmart) that carry it (new) or are ≥ 2× deeper (deepen)"],
        ["<b>GS</b> gap size", "0–1", "How big the missing assortment is.", "Percentile of the missing chunk in "
         "the carrier's L1–L3 catalogue (shelves; items where counts exist)"],
        ["<b>O</b> opportunity", "0–1", "Ranking inside a zone.",
         f"[{w['pc_b2b']:.2f} PC_b2b + {w['pc_mkt']:.2f} PC_mkt + {w['gs']:.2f} GS + {w['aas']:.2f} AAS + "
         f"{w['bfs']:.2f} BFS + {w['ease']:.2f} EASE] × (1 − CRS/100)"],
    ]
    o.append(table(["Score", "Range", "Meaning", "How it is built"], srow, cls=""))
    o.append("<h3>Workplace buyer missions used for brand fit</h3>")
    o.append("<p class='small ink2'><b>Workplace:</b> " + " · ".join(e(k) for k in pc.WORK_MISSIONS) +
             "<br><b>Residential / leisure:</b> " + " · ".join(e(k) for k in pc.RES_MISSIONS) + "</p>")
    o.append("<h2>The decision rule</h2>")
    zr = [
        [chip("EXCLUDED"), "Brand-safety term in the name or path", e(pc.ACTION["EXCLUDED"])],
        [chip("1P-CORE GAP"), f"CRS ≥ {C['crs_hi']}", e(pc.ACTION["1P-CORE GAP"])],
        [chip("REVIEW"), f"{C['crs_lo']} ≤ CRS &lt; {C['crs_hi']}", e(pc.ACTION["REVIEW"])],
        [chip("OFF-BRAND"), f"BFS &lt; {C['bfs_gate']}, or AAS &lt; {C['aas_lo']}", e(pc.ACTION["OFF-BRAND"])],
        [chip("CURATE"), f"CRS &lt; {C['crs_lo']}, BFS ≥ {C['bfs_gate']}, AAS ≥ {C['aas_hi']}", e(pc.ACTION["CURATE"])],
        [chip("VERTICAL EXTENSION"), f"CRS &lt; {C['crs_lo']}, BFS ≥ {C['bfs_gate']}, {C['aas_lo']} ≤ AAS &lt; "
                                     f"{C['aas_hi']}", e(pc.ACTION["VERTICAL EXTENSION"])],
        [chip("VERIFY"), "New category not yet confirmed missing (mostly a soft gap, or peers' equivalents match "
                         "a Staples shelf)", e(pc.ACTION["VERIFY"])],
    ]
    o.append(table(["Zone", "Rule (in this order)", "Action"], zr, cls=""))
    o.append("<p class='small ink2'>A residential-lifestyle category, one closer to a residential mission than to any "
             "workplace mission, drops one zone: CURATE → VERTICAL EXTENSION → OFF-BRAND. Evidence grade: A = 3+ "
             "competitors and both methods agree; B = 2+ competitors or the methods agree; C = neither.</p>")
    o.append("<h3>The framework in pictures</h3>")
    ff = framework_figures(S, U)
    o.append(ff[0])
    o.append(ff[1])
    o.append(ff[2])

    # ---- matching quality
    o.append("<h2>How good is the matching?</h2>")
    cq = []
    for c, d in cal.items():
        cq.append([f"<b>{e(SHORT[c])}</b>", n0(d["n_labelled"]), pct(d.get("base_rate_carried")),
                   pct(d.get("top1_V")), pct(d.get("top1_V_nested_cv")), f2(d.get("auc_V")),
                   pct(d.get("acc_V_in_sample")), pct(d.get("acc_V_cv")), pct(d.get("top1_G")), f2(d.get("auc_G")),
                   pct(d.get("acc_G_cv"))])
    o.append(table(["Competitor", "Labelled", "Carried (random)", "V top-1", "V top-1 (CV)", "V AUC",
                    "V acc. in-sample", "V acc. (CV)", "G top-1", "G AUC", "G acc. (CV)"], cq,
                   num=set(range(1, 11))))
    bk = S.get("encoder_bakeoff", {})
    o.append(f"<p>The encoder is chosen by a bake-off on the labelled rows (pooled top-1 after the rerank): "
             + ", ".join(f"<b>{e(k)}</b> {pct(v, 1)}" for k, v in sorted(bk.items(), key=lambda x: -x[1]))
             + (f". Not available on this machine: {e(', '.join(S.get('encoder_unavailable', [])))}" if
                S.get("encoder_unavailable") else "") + ". The thresholds re-calibrate for whichever encoder wins. "
             "The CV columns are held-out estimates: the encoder choice and τ are refitted without the fold "
             "being scored.</p>")
    la = S.get("label_agreement")
    if la:
        o.append(f"<p><b>How reliable are the labels?</b> A blind second pass re-labelled {la['n']} labelled rows "
                 f"(12 per competitor) without seeing the original labels: {pct(la['agreement'])} agreement, Cohen's "
                 f"κ = {la['kappa']:.2f} ('substantial'). The original labels call a category carried more often "
                 f"({pct(la['gold_carried'])} vs {pct(la['second_pass_carried'])}). They accept a parent or "
                 f"neighbouring shelf (smart boards for interactive whiteboards, the dental department for dental "
                 f"anesthesia). The gold set is therefore slightly lenient, which makes the gap list conservative.</p>")
    try:
        bk_ = pd.read_excel(os.path.join(FINAL, "Category_Recommendations_v3.xlsx"), sheet_name="Encoder_Bakeoff")
        bw = bk_[(bk_.status == "ok") & (bk_.encoder == max(bk.items(), key=lambda x: x[1])[0])]
        hv = np.average(bw.top1_hybrid, weights=bw.n_labelled)
        vo = np.average(bw.top1_vector_only, weights=bw.n_labelled)
        o.append(f"<p class='small ink2'><b>Finding for the next iteration:</b> with the winning encoder, vector-only "
                 f"matching ({pct(vo, 1)} pooled top-1) beats the 0.65 × cosine + 0.35 × wording rerank "
                 f"({pct(hv, 1)}). That weighting was tuned for V2's weaker word-vector encoder. It is kept here so "
                 f"it is not re-tuned on the same labels, and should be re-tuned on fresh labels.</p>")
    except Exception:  # noqa
        pass
    o.append(fig("fig03_match_quality.png", "Matching quality by competitor (Methods V and G)"))
    ver = S["verification"]
    o.append(f"<p><b>Verification loop.</b> Matching outside Office Depot is imperfect, so a model-flagged gap is "
             f"not trusted on sight. Of {n0(ver['checked'])} model-flagged shelves checked against the Staples "
             f"tree, <b>{n0(ver['carried_under_other_name'])}</b> were already sold under another name and "
             f"{n0(ver['confirmed_gaps'])} were real gaps. These checks are stored as labels that override the "
             f"models, and they are excluded from threshold fitting (the model chose them, so they would bias τ). "
             f"Concepts cleared this way form the VERIFY findability list.</p>")
    o.append(fig("fig05_verification_loop.png", "Verification loop: flagged gaps checked, by competitor", solo=True))

    # ---- robustness
    st = S.get("stability", {})
    o.append("<h2>How stable are the answers?</h2>")
    o.append(f"<p>Two separate tests. <b>Decision stability</b>: in 500 runs the weights are re-drawn, every zone "
             f"threshold and the brand gate are jittered by ±5, CRS is scaled by ±20% (coreness is a judgement "
             f"proxy) and the penalty exponent varies from 0.5× to 2×. "
             f"{n0(st.get('recommended_p_zone_ge_0.8'))} of {n0(st.get('recommended_units'))} recommended units keep "
             f"their zone in at least 80% of runs. <b>Matching stability</b>: 200 bootstraps of the labelled rows "
             f"re-fit each competitor's thresholds and re-test every member shelf of every new-category unit. "
             f"{n0(st.get('recommended_p_gap_ge_0.8'))} recommended units stay gaps in at least 80% of them (median "
             f"over all new-category units: {pct(st.get('p_gap_median_enter'))}).</p>")
    o.append(fig("fig19_sensitivity.png", "Stress test of the top CURATE sub-categories", solo=True))

    # ---- caveats
    o.append("<h2>Assumptions and caveats</h2><ul>"
             "<li><b>Category trees only.</b> There is no sales, margin, search or traffic data. Demand is proxied by "
             "marketplace breadth (how many shelves Amazon and Walmart devote to a category, and Walmart's item "
             "counts). The code has a hook (<code>external_signals.csv</code>) for real demand signals.</li>"
             "<li><b>Coreness is a judgement proxy</b> (paper and office supplies 1.0, furniture 0.6, décor 0.1–0.2, "
             "+0.1 for departments in Staples' header navigation). It should be replaced with Staples' category sales "
             "bands, which is the most valuable single upgrade.</li>"
             "<li><b>Brand fit is zero-shot</b>, from sentence embeddings against written mission descriptions. The "
             "descriptions are editable in <code>poc_common.py</code> and should be reviewed with Staples "
             "merchants.</li>"
             "<li><b>Labels</b> were produced by the analysis team with Claude, against the Staples tree and live "
             "pages. They are marked for review with the Staples team.</li>"
             "<li><b>Snapshots</b> are from September 2026. Amazon and Wayfair publish no item counts, so they "
             "contribute breadth only. The Target tree is not used.</li>"
             "<li><b>Category level only.</b> Product and archetype gaps are covered by the separate product-level "
             "PoC.</li></ul>")
    return "\n".join(o)


# ---------------------------------------------------------------------------------------
# TAB 2 - GAPS & RECOMMENDATIONS
# ---------------------------------------------------------------------------------------
def tab_recs(S, U, Opp, V2):
    o = []
    R = recommendable(U)
    rec = R[R.label.isin(pc.RECOMMEND)]
    o.append('<h2 style="margin-top:0">The answer on one page</h2>')
    oz = Opp.label.value_counts() if len(Opp) else pd.Series(dtype=int)
    kp = [("Category opportunities", n0(len(Opp)), "zone × Staples department"),
          ("Open now (CURATE)", n0(oz.get("CURATE", 0)), f"{n0((rec.label == 'CURATE').sum())} sub-categories"),
          ("Phase 2 (VERTICAL EXT.)", n0(oz.get("VERTICAL EXTENSION", 0)),
           f"{n0((rec.label == 'VERTICAL EXTENSION').sum())} sub-categories"),
          ("Keep in 1P / review", n0(oz.get("1P-CORE GAP", 0) + oz.get("REVIEW", 0)), "fix or decide in 1P"),
          ("Findability (VERIFY)", n0((R.label == "VERIFY").sum()), "probably sold under another name"),
          ("Pass / excluded", n0(U.label.isin(["OFF-BRAND", "EXCLUDED"]).sum()), "wrong store or unsafe")]
    o.append('<div class="kpis">' + "".join(f'<div class="kpi"><div class="kv">{v}</div><div class="kl">{e(k)}</div>'
                                            f'<div class="ks">{e(s)}</div></div>' for k, v, s in kp) + "</div>")

    # ---- decision picture (collapsible, open by default)
    o.append('<details class="sec" open><summary><h2>The decision picture</h2>'
             '<span class="hint">click to collapse / expand</span></summary>')
    if len(Opp):
        o.append(opp_crs_chart(S, Opp))
        o.append(opp_bfs_chart(S, Opp))
    o.append(fig("fig15_peer_consensus.png", "Peer evidence behind the top recommendations", solo=True))
    o.append("</details>")

    # ---- category opportunities: filter -> table -> deep dives
    A = R[R.label.isin(ACT)].copy()
    A = A.merge(Opp[["opportunity_id", "O_sum"]], on="opportunity_id", how="left") if len(Opp) else A.assign(O_sum=np.nan)
    A = A.sort_values("O", ascending=False)                    # final opportunity score, highest first
    themes = sorted(set(A.theme.dropna()) | (set(Opp.theme.dropna()) if len(Opp) else set()))
    o.append("<h2>Category opportunities</h2>")
    o.append('<p class="ink2">An opportunity groups the sub-categories that two or more competitors carry (or the Staples '
             'aisles at least two competitors stock twice as deeply) within one zone and one Staples department. '
             'Choose a zone and a theme: the table and the deep dives below follow the selection.</p>')
    o.append('<div class="controls"><label for="zSel">Zone</label><select id="zSel" style="flex:0 1 240px">'
             + "".join(f'<option value="{zslug(z)}"{" selected" if z == "CURATE" else ""}>{e(z)}</option>' for z in ACT)
             + '</select><label for="tSel">Theme</label><select id="tSel" style="flex:0 1 260px">'
               '<option value="ALL" selected>All themes</option>'
             + "".join(f'<option value="{e(t)}">{e(t)}</option>' for t in themes) + '</select>'
             '<span class="sel-status" id="oppCount"></span></div>')
    o.append("<h3>Sub-categories in the selection <span class='hint small muted'>ordered by the final opportunity "
             "score O, highest first (click a heading to re-sort)</span></h3>")
    o.append(filtered_unit_table(A))
    o.append('<details class="sec" id="deep"><summary><h2>Opportunity deep dives</h2>'
             '<span class="hint">one card per opportunity in the selected zone and theme. Click to expand</span>'
             '</summary>')
    for _, r in Opp.iterrows():
        o.append(opp_card(r, U))
    o.append("</details>")

    # ---- other lists, collapsed
    vv = R[R.label == "VERIFY"].sort_values("O", ascending=False)
    rows = [[e(r["display"]), e(r["carriers"]), arrow(r["aisle"]), e(str(r.get("verify_outcome", "")).replace(
        "already carried: ", "found: ")), n0(r["BFS"])] for _, r in vv.iterrows()]
    o.append(f'<details class="sec"><summary><h2>Fix findability first (VERIFY)</h2><span class="hint">{len(vv)} '
             f'sub-categories. Click to expand</span></summary>'
             "<p class='ink2'>The models first flagged these as missing. Most of each is a soft gap, or the "
             "competitors' equivalent shelves match a Staples shelf. Where the verification loop found the Staples "
             "shelf, it is shown. Customers who search with competitor vocabulary may not find these.</p>"
             + table(["Category", "Competitors", "Staples aisle", "Outcome", "Brand fit"], rows, num={4}) + "</details>")
    allob = U[U.label.isin(["OFF-BRAND", "EXCLUDED"])]
    ob = allob[(allob.gap_type == "DEEPEN") | (allob.k >= 2)].sort_values("O", ascending=False).head(60)
    rows = [[e(r["display"]), chip(r["label"]), e(r["carriers"]), e(r.get("competitor_dept", "")),
             n0(r["BFS"]), n0(r["AAS"]), f'<span class="small">{e(r["zone_reason"])}</span>'] for _, r in ob.iterrows()]
    o.append(f'<details class="sec"><summary><h2>Pass: off-brand or excluded</h2><span class="hint">{n0(len(allob))} '
             f'sub-categories. Click to expand</span></summary>'
             f"<p class='ink2'>Real gaps, but the wrong store for Staples. Showing the {len(ob)} largest seen at two or "
             f"more competitors.</p>"
             + table(["Category", "Zone", "Competitors", "Competitor dept", "Brand fit", "AAS", "Why"], rows, num={4, 5})
             + "</details>")
    wl = U[(U.gap_type == "ENTER") & (U.k < 2) & U.label.isin(pc.RECOMMEND)].sort_values("O", ascending=False)
    rows = [[e(r["display"]), chip(r["label"]), e(r["carriers"]), arrow(r["aisle"]), n0(r["BFS"]), f2(r["O"])]
            for _, r in wl.iterrows()]
    o.append(f'<details class="sec"><summary><h2>Watch list: seen at one competitor only</h2><span class="hint">'
             f'{len(wl)} sub-categories. Click to expand</span></summary>'
             "<p class='ink2'>These would qualify, but only one competitor shows them, so they do not drive any "
             "call.</p>" + table(["Category", "Zone", "Competitor", "Staples aisle", "Brand fit", "O"], rows, num={4, 5})
             + "</details>")
    return "\n".join(o)


H = {"Opp": "Opportunity ID",
     "BFS": "BFS<br><span class='hd'>Brand Fit Score</span>",
     "AAS": "AAS<br><span class='hd'>Adjacency Affinity Score</span>",
     "CRS": "CRS<br><span class='hd'>Cannibalisation Risk Score</span>",
     "EASE": "EASE<br><span class='hd'>Ease of launch score</span>",
     "O": "O<br><span class='hd'>Opportunity score (final)</span>",
     "p_zone": "p_zone<br><span class='hd'>Zone stability (500 runs)</span>",
     "p_gap": "p_gap<br><span class='hd'>Gap stability (200 bootstraps)</span>",
     "Grade": "Grade<br><span class='hd'>Evidence grade A/B/C</span>"}
UNIT_HEADERS = [H["Opp"], "Sub-category", "Zone", "Type<br><span class='hd'>New / Deepen</span>", "Staples aisle",
                "Competitors", H["BFS"], H["AAS"], H["CRS"], H["EASE"], H["O"], H["p_zone"], H["Grade"]]


def filtered_unit_table(A):
    """Sub-categories of the actionable zones; rows carry zone / theme so the page filter can show only the
    selection. Pre-sorted by the final opportunity score O, highest first."""
    h = UNIT_HEADERS
    num = {6, 7, 8, 9, 10, 11}
    th = "".join(f'<th class="{"num" if i in num else ""}">{x}</th>' for i, x in enumerate(h))
    rows = []
    for _, r in A.iterrows():
        cells = [e(r.get("opportunity_id", "")), e(r["display"]), chip(r["label"]), e(r["gap_type"].title()),
                 arrow(r["aisle"]), e(r["carriers"]), n0(r["BFS"]), n0(r["AAS"]), n0(r["CRS"]), n0(r["EASE"]),
                 f2(r["O"]), pct(r.get("p_zone")), e(r["evidence"])]
        rows.append(f'<tr data-zone="{zslug(r["label"])}" data-theme="{e(r["theme"])}">'
                    + "".join(f'<td class="{"num" if i in num else ""}">{c}</td>' for i, c in enumerate(cells)) + "</tr>")
    return (f'<div class="tbl-wrap"><table class="sortable" id="unitTbl"><thead><tr>{th}</tr></thead><tbody>'
            f'{"".join(rows)}</tbody></table></div><p class="muted small" id="unitEmpty" hidden>No sub-categories in '
            f'this selection.</p>')


def opp_card(r, U):
    units = U[U.opportunity_id == r["opportunity_id"]].sort_values("O", ascending=False)
    zc = LABEL_COLOR.get(r["label"], "#888")
    car = ", ".join(SHORT.get(c.strip(), c.strip()) for c in str(r["carriers"]).split(",") if c.strip())
    b2b = r["b2b_channels"] if isinstance(r["b2b_channels"], str) and r["b2b_channels"] else "none"
    stab = f"keeps its zone in {pct(r['p_zone'])} of 500 stress runs" + (
        f"; still a gap in {pct(r['p_gap'])} of 200 label bootstraps" if pd.notna(r.get("p_gap")) else "")
    rows = [[e(u["display"]), e(u["gap_type"].title()), e(u["carriers"]), n0(u["BFS"]), n0(u["AAS"]), n0(u["CRS"]),
             n0(u["EASE"]), f2(u["O"]), pct(u.get("p_zone")), pct(u.get("p_gap")) if pd.notna(u.get("p_gap")) else "–",
             e(u["evidence"])] for _, u in units.iterrows()]
    paths = "".join(f"<li>{arrow(p)}</li>" for p in str(r["example_paths"]).split(" | ")[:4])
    insights = []
    insights.append(f"Carried by {e(r['k_max'])} of 5 competitors ({e(car)}); B2B channels: {e(b2b)}.")
    insights.append(f"Closest workplace mission: <b>{e(r['mission'])}</b>.")
    if r["n_deepen"]:
        insights.append(f"{int(r['n_deepen'])} Staples aisle(s) where competitors are at least 2× deeper.")
    if isinstance(r.get("complexity"), str) and r["complexity"]:
        insights.append(f"Operational flags: {e(r['complexity'])}.")
    return f'''<section class="opp card" data-zone="{zslug(r['label'])}" data-theme="{e(r['theme'])}"
 data-q="{e((str(r['name']) + ' ' + str(r['units']) + ' ' + str(r['aisle'])).lower())}" style="border-left:4px solid {zc}">
<div class="node-head"><h3 style="margin:0">{e(r['opportunity_id'])} · {e(r['name'])}</h3>{chip(r['label'])}
<span class="chip">{e(r['theme'])}</span><span class="chip">grade {e(r['best_evidence'])}</span></div>
<dl class="facts"><dt>Staples aisle(s)</dt><dd>{'<br>'.join(arrow(a) for a in str(r['aisles']).split(' | '))}</dd>
<dt>Lead sub-category</dt><dd>{e(r['lead'])}</dd>
<dt>Action</dt><dd>{e(pc.ACTION.get(r['label'], ''))}</dd>
<dt>Key insights</dt><dd><ul class="ins">{''.join(f'<li>{x}</li>' for x in insights)}</ul></dd>
<dt>Scores</dt><dd class="scores">Brand fit {bar(r['BFS'], 'var(--good)')} Adjacency {bar(r['AAS'])}
 Cannibalisation {bar(r['CRS'], 'var(--bad)')} Ease {bar(r['EASE'], 'var(--comp)')}
 <span class="small ink2">· total opportunity {f2(r['O_sum'])}</span></dd>
<dt>Stability</dt><dd>{e(stab)}</dd>
<dt>Competitor shelves</dt><dd><ul class="ins small">{paths}</ul></dd></dl>
<details><summary>{len(units)} sub-categories in this opportunity</summary>
{table(["Sub-category", "Type", "Competitors", H["BFS"], H["AAS"], H["CRS"], H["EASE"], H["O"], H["p_zone"],
        H["p_gap"], H["Grade"]],
       rows, num={3, 4, 5, 6, 7, 8, 9})}</details></section>'''


# ---------------------------------------------------------------------------------------
EXTRA_CSS = """
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0 6px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.kpi .kv{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.kpi .kl{font-weight:600;font-size:12.5px}
.kpi .ks{font-size:11.5px;color:var(--muted)}
.opp{margin:12px 0}
.bar{display:inline-block;width:70px;height:7px;background:var(--surface-2);border-radius:4px;overflow:hidden;
  vertical-align:middle;margin:0 4px 0 2px}
.bar i{display:block;height:100%}
.bv{font-variant-numeric:tabular-nums;font-size:12px;margin-right:10px}
dd.scores{line-height:2}
code{font-size:12px;background:var(--surface-2);padding:0 4px;border-radius:4px}
nav.tabs{flex-wrap:wrap}
@media (max-width:620px){nav.tabs button{padding:8px 8px} h1{font-size:19px}}
main .wrap,header .wrap{overflow-wrap:break-word;min-width:0}
.controls select,.controls input{min-width:0;max-width:100%}
.fig.full{margin:10px 0}
details.sec > summary h2{display:inline;margin:0}
th .hd{font-weight:400;font-size:10.5px;color:var(--muted);white-space:normal;display:inline-block;max-width:120px;line-height:1.25}
details.sec{margin:26px 0 8px}
.fc-fork .fc-step{width:100%}
""" + "".join(f".z-{zslug(z)}{{background:{c}22;color:var(--ink);border:1px solid {c}88}}\n"
              for z, c in LABEL_COLOR.items())

JS = r"""
(function(){
  var tabs=document.querySelectorAll('nav.tabs button');
  function openTab(name){
    tabs.forEach(function(b){b.setAttribute('aria-selected', b.dataset.tab===name ? 'true':'false');});
    document.getElementById('tab-method').hidden = name!=='method';
    document.getElementById('tab-recs').hidden = name!=='recs';
    try{localStorage.setItem('clpoc-tab',name);}catch(e){}
  }
  tabs.forEach(function(b){b.addEventListener('click',function(){openTab(b.dataset.tab);});});
  var t=null; try{t=localStorage.getItem('clpoc-tab');}catch(e){}
  if(location.hash==='#recs'||location.hash==='#method') t=location.hash.slice(1);
  openTab(t==='recs' ? 'recs' : 'method');
  var z=document.getElementById('zSel'), th=document.getElementById('tSel');
  function filt(){
    var n=0, m=0, zv=z.value, tv=th.value;
    document.querySelectorAll('section.opp').forEach(function(s){
      var ok = s.dataset.zone===zv && (tv==='ALL' || s.dataset.theme===tv);
      s.hidden=!ok; if(ok) n++;
    });
    document.querySelectorAll('#unitTbl tbody tr').forEach(function(r){
      var ok = r.dataset.zone===zv && (tv==='ALL' || r.dataset.theme===tv);
      r.hidden=!ok; if(ok) m++;
    });
    document.getElementById('unitEmpty').hidden = m>0;
    document.getElementById('oppCount').textContent = n + ' opportunities · ' + m + ' sub-categories';
  }
  if(z){[z,th].forEach(function(x){x.addEventListener('change',filt);}); filt();}
  document.querySelectorAll('table.sortable th').forEach(function(h){
    h.addEventListener('click',function(){
      var table=h.closest('table'), idx=Array.prototype.indexOf.call(h.parentNode.children,h);
      var body=table.tBodies[0], rows=Array.prototype.slice.call(body.rows);
      var asc = h.dataset.dir!=='asc'; h.dataset.dir = asc ? 'asc':'desc';
      function val(r){var t=(r.cells[idx]||{}).textContent||''; var n=parseFloat(t.replace(/[$,%+ ]/g,'')); return isNaN(n)? t.toLowerCase(): n;}
      rows.sort(function(a,b){var x=val(a),y=val(b); if(x===y) return 0; return (x>y?1:-1)*(asc?1:-1);});
      rows.forEach(function(r){body.appendChild(r);});
    });
  });
})();
"""


def main():
    S, U, Opp, recon, V2 = load()
    css = open(os.path.join(pc.HERE, "report_style.css"), encoding="utf-8").read() + EXTRA_CSS
    title = "Staples: Category Expansion Recommendation Analysis (Marketplace, Category Level)"
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<style>{css}</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>{e(title)}</h1>
    <nav class="tabs" role="tablist">
      <button role="tab" data-tab="method" aria-selected="true">Approach &amp; Methodology</button>
      <button role="tab" data-tab="recs" aria-selected="false">Gaps &amp; Recommendations</button>
    </nav>
  </div>
</header>
<main><div class="wrap">
<section class="panel" id="tab-method">
{tab_method(S, U, Opp, recon, V2)}
</section>
<section class="panel" id="tab-recs" hidden>
{tab_recs(S, U, Opp, V2)}
</section>
<footer>Category-level PoC, report {e(REPORT_VERSION.upper())}. Generated by build_html.py from the pipeline outputs (summary_v3.json,
Category_Recommendations_v3.xlsx). Sources: public category trees of Staples, Office Depot, West Elm, Wayfair,
Amazon and Walmart, September 2026 snapshots.</footer>
</div></main>
<script>{JS}</script>
</body>
</html>"""
    os.makedirs(os.path.dirname(os.path.abspath(OUT_HTML)), exist_ok=True)
    with open(OUT_HTML, "w", encoding="utf-8") as fh:
        fh.write(page)
    pc.log(f"HTML written: {os.path.abspath(OUT_HTML)} ({os.path.getsize(OUT_HTML) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
