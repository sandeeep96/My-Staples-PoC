# Staples Category-Level PoC — V3 review, fixes and client report

> Status: **done.** The plan was approved and implemented in October 2026. This file keeps the V2 critique and records what was actually built. Where the build differs from the original plan, the "As built" column says so. Formulas and zone rules: `Methodology.md`. How to run: `CLAUDE.md` / `Codes/code/README.md`.

## Context
Staples (prospective client) wants to know which categories it could expand into through its marketplace. The categories should be missing or thin on Staples.com, carried by the marketplaces it competes with, and within reach of the Staples brand. The V2 pipeline compares the Staples navigation tree with Office Depot, West Elm, Wayfair, Amazon and Walmart. It uses a vector engine (Method V) and a graph engine (Method G), which run independently and in parallel, then combines them and places categories in zones.

The V2 review covered the code, the 7 Excels (every sheet), the gold labels, the outputs, the docx/pptx and the sample HTML. The pipeline was well built, but it never tested the brief's key requirement, brand reach, and some Excel rows were lost without being reported. V2's top results showed the problem:
- CURATE led with Daybeds, Makeup Vanities, Beds & Bedding and Teen Tapestries.
- VERTICAL EXTENSION included "Adult Novelty" and Teen Dressers.
- 1P-CORE GAP included Wall Ovens and Patio Heater Parts.

**Decisions made with the user:**
- Fix the code and re-run it (not critique-only).
- Brand reach = **workplace-first**: residential lifestyle is downgraded, not banned; brand-unsafe categories are excluded.
- Deliverables = the **2-tab static HTML report** (versioned in `reports/`) plus `Category_Recommendations_v3.xlsx`. The docx and pptx stay as V2 artefacts.

---

## Part 1 — V2 critique and resolution

### A. Data usage (is every Excel row used properly?)
| # | Gap in V2 | As built in V3 |
|---|---|---|
| A1 | OD **"Unmapped Nodes"** sheet (80 pages, including the art & craft aisle) never loaded | Placed under OD aisles via a reviewed file, `od_unmapped_placement.csv`: bge-base proposed 3 aisles, then an analyst picked one or dropped the page as a duplicate, hub or deal page. One aisle was created: School Supplies › Art & Craft Supplies. |
| A2 | **Walmart L5 (2,485 rows) dropped**, though the docs said "folded" | Genuinely folded: counted in the L4 parent's breadth, with labels kept as aliases (shown in Node_Ensemble, not used for matching). Same rule for OD and West Elm. |
| A3 | 390 Wayfair secondary placements dropped; "Unique Categories" unused | Secondary placements become CROSS_LISTED edges in Method G (236 edges). Exact duplicate copies are reported as such. Unique Categories = reference-only. |
| A4 | B2B signals unused (Wayfair Professional scope, Walmart for Business) | Feed the B2B-channel term in brand fit and peer consensus. |
| A5 | Staples "In header nav?" column unused | +0.1 coreness for header-nav departments. |
| A6 | Grocery and toys excluded, though Staples sells breakroom food and classroom resources | Narrow whitelist: coffee, tea, snacks, beverages, candy; learning and STEM toys, kids' arts & crafts, puzzles. |
| A7 | No account of every row | `Row_Reconciliation`: 24 sheets, 47,586 rows, each used / dropped (reason) / reference / not used. No sheet has a mismatch. |
| A8 | Suspected encoding damage; `rows_in_file` null in summary.json | The encoding issue was a Windows console artefact, not a data problem. Raw row counts are now persisted. |

### B. Methodology
| # | Gap in V2 | As built in V3 |
|---|---|---|
| B1 | **Brand reach never modelled.** AAS rewarded residential décor because Staples' own tree is noisy; no brand-safety screen | **BFS** = 0.6 × mission score (zero-shot bge-base: 12 workplace vs 5 residential/leisure missions) + 0.4 × share of the 3 B2B channels. BFS < 35 → OFF-BRAND; residential units drop one zone; a safety-term hit in the name or path → EXCLUDED. |
| B2 | All competitors weighted equally in peer consensus | PC_b2b (OD, Wayfair Professional, Walmart for Business) and PC_mkt (Amazon, Walmart); lifestyle retailers count half in the overall PC. |
| B3 | No ease-of-launch measure | EASE = 50 + 50 × PC_mkt − 25 per complexity flag (bulky freight, install required, regulated, perishable); DEEPEN +15. |
| B4 | Weak matching outside OD; 55% of flagged gaps were false; spaCy encoder | Bake-off with bge-base, bge-small and TF-IDF (spaCy and WordLlama not installed). **bge-base won** (pooled top-1 67%). Finding: with bge, vector-only matching beats the 0.65/0.35 hybrid rerank, so re-tune it on fresh labels. |
| B5 | Accuracy tuned and reported on the same labels | 5-fold CV: top-1 with the encoder choice nested in CV, plus held-out threshold accuracy. |
| B6 | 559 units mixing L1–L3, many tiny | **Changed from plan:** embedding clusters (~25–40) mixed look-alikes (Workbenches with Weight Benches), so opportunities are **zone × Staples department** instead: 43 opportunities. Single-competitor units go to a watch list. |
| B7 | Docking errors (Gazebo Canopies → Gift Shop) | Dock = argmax over allowed Staples L2 aisles of (mission similarity + 0.03 × graph/vector votes). Gift Shop, Expanded Assortment and top-level Decor are never docks; hub shelves with more than 15 parents never vote. DEEPEN units in an excluded aisle are re-docked. |
| B8 | CRS borrowed risk from mismatched shelves | CRS halved when the driver shelf is not about the same thing (similarity < 0.60). The stress test scales CRS ±20%. `crs_driver` is in the workbook. |
| B9 | Stress test covered weights only | 500-run stress test → `p_zone`; 200 gold-label bootstraps re-fit τ and re-test every gap → `p_gap`. |
| B10 | Single-pass labels, no agreement check | Blind second pass on 60 rows: 87% agreement, κ = 0.65. The original labels are slightly lenient (they accept parent or neighbouring shelves). |
| B11 | No demand signal | Proxies only (marketplace breadth, Walmart counts), labelled as proxies; the `external_signals.csv` hook is documented. |

### C. Code hygiene (done)
- The L5 docstring now matches the code; the duplicate `theme` computation is gone.
- Default paths point at the V3 layout (`Excels/`, `Outputs_v3/`).
- qdrant-client is installed (the Qdrant backend is used); the gold file has no duplicate keys.
- The verification loop got a round 4: only 3 unchecked member shelves remained, and all were confirmed gaps.

---

## Part 2 — What was built

| File | Role |
|---|---|
| `Codes/code/poc_common.py` | Loaders (A1–A7), missions, safety, complexity, BFS / EASE, zone rule, opportunity score, stress test, bootstrap, CV helpers |
| `Codes/code/method_v_vector.py` | Encoder bake-off, nested-CV top-1, Qdrant, calibration |
| `Codes/code/method_g_graph.py` | Graph with Staples and Wayfair cross-listings, threshold CV |
| `Codes/code/run_framework.py` | Ensemble, units, channel-split peers, brand fit, ease, docking, bootstrap, opportunities |
| `Codes/code/framework_outputs.py` | `Category_Recommendations_v3.xlsx` (new sheets: Opportunities, Brand_Fit, Row_Reconciliation, CV_Metrics, V2_vs_V3), `summary_v3.json`, figures |
| `Codes/code/build_html.py` | Client report → `reports/Staples_Category_Recommendations_<version>.html` |
| `Codes/code/gold_matches_v3.csv`, `gold_relabel_kappa_v3.csv`, `od_unmapped_placement.csv` | Labels, κ second pass, OD placement decisions |

### Client report (current: `reports/…_v4.html`; v3 kept for reference)
- **Tab 1, Approach & Methodology:**
  - The question and the brand-reach definition.
  - The six trees with the row reconciliation.
  - The flow, with Methods V and G **in parallel**, then a single combine step.
  - The scores and the zone rule.
  - Framework charts: the AAS × CRS zone map, all units on it, and the brand gate.
  - Matching quality (in-sample vs CV, κ), stability, and caveats.
  - The V2-critique section was removed at the user's request.
- **Tab 2, Gaps & Recommendations:**
  - KPI tiles.
  - **Decision picture**, collapsible:
    - Opportunities on AAS × CRS, titled with the zone counts, labelled by lead sub-category (top 5 per zone, 1P-CORE GAP unlabelled).
    - Brand fit vs adjacency.
    - Peer evidence.
  - **Category opportunities**:
    - Zone filter (4 options, default CURATE) and theme filter (default All).
    - The sub-category table for the selection, sorted by the final score O, highest first, with full score names in the headings.
    - Opportunity deep dives, collapsed.
  - Findability (VERIFY), Pass (off-brand / excluded) and Watch list, all collapsed.
- Each published change gets a new version: bump `REPORT_VERSION` in `build_html.py`. Never overwrite an old report.

## Verification (all passed)
- End-to-end run with no errors: `method_v_vector.py` → `method_g_graph.py` → `run_framework.py` → `build_html.py`.
- Row reconciliation adds up for every sheet (0 mismatches).
- No safety term in a recommended zone. Adult Novelty, Makeup Vanities, Daybeds, Teen Dressers and Home Brewing are not recommended. No dock lands in Gift Shop, Expanded Assortment or Decor.
- Re-runs are reproducible: zones identical, O to within 3e-5.
- The report was checked in headless Edge: both tabs, filters and sorting work, and there is no horizontal overflow at 375 px.
