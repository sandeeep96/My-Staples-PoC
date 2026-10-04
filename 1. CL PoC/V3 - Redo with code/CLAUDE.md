# CLAUDE.md — Staples Category-Level PoC (V3 pipeline, versioned reports)

## What this is
A data science PoC for **Staples**, a prospective client of our analytics services company. The question is which categories Staples could expand into through its marketplace. They should be missing or thin on Staples.com, carried by competitors and marketplaces, within Staples' brand reach (workplace-first), easy to expand into, and safe for its 1P core. This is **category level only**. The product/archetype PoC (`../../2. AL PoC`) is separate. The sample HTML here comes from that project and is a *style* reference only.

- V2 critique and what was built: `plan.md`
- Method (source of truth for formulas, zones, docking, report structure): `Methodology.md`

## Layout
```
Excels/                       input navigation trees (read-only; Target file = not used)
Codes/code/                   pipeline (Python)
  poc_common.py               CONFIG, RETAILERS adapters, scope + whitelist, row reconciliation, coreness,
                              calibration/CV, missions, brand safety, complexity, BFS/EASE, zones, O, stress test
  method_v_vector.py          Method V: encoder bake-off + Qdrant + calibration          -> Outputs_v3/V
  method_g_graph.py           Method G: knowledge graph + flooding + PPR + calibration  -> Outputs_v3/G
  run_framework.py            combine V+G, units, brand fit, ease, docking, bootstrap, opportunities -> Outputs_v3/final
  framework_outputs.py        figures, Category_Recommendations_v3.xlsx, summary_v3.json, units_all.csv, opportunities.csv
  build_html.py               client report -> reports/Staples_Category_Recommendations_<version>.html
  report_style.css            report styling (from the product-level PoC page)
  gold_matches_v3.csv         labelled rows (calibration + verification loop)
  gold_relabel_kappa_v3.csv   blind second-pass labels (Cohen's kappa)
  od_unmapped_placement.csv   reviewed placement of Office Depot's breadcrumb-less pages
Codes/docs_build/             V2 JS builders for docx/pptx (not regenerated)
Outputs/                      V2 outputs: keep untouched (V2-vs-V3 comparison reads them)
Outputs_v3/                   V3 pipeline outputs
reports/                      client HTML reports, one file per version (v3, v4, ...) - never overwrite a shared one
```

## Run (Windows, Git Bash)
```bash
cd "Codes/code"
python method_v_vector.py && python method_g_graph.py && python run_framework.py && python build_html.py
# defaults: inputs ../../Excels, outputs ../../Outputs_v3 (override with POC_DATA_DIR / POC_OUT_DIR)
# Windows console: set PYTHONIOENCODING=utf-8 to avoid cp1252 print errors
```
- Methods V and G are independent: they can run in either order or in parallel. `run_framework.py` needs both.
- Report-only changes need only `python build_html.py`. Label or CONFIG changes need `run_framework.py` + `build_html.py`. Tree, encoder or matching changes need all four scripts.
- Runtime on CPU: V ~8 min, G ~1 min, framework ~5 min, report seconds. Runs are seeded (zones reproduce exactly).
- Python 3.14. sentence-transformers and torch (CPU) are installed, and HuggingFace is reachable, so `BAAI/bge-base-en-v1.5` works. qdrant-client is installed. spaCy and wordllama are not; the bake-off records them as unavailable.
- There is no `ANTHROPIC_API_KEY`. "LLM adjudication" in the verification loop means Claude reviews the rows in-session and appends them to `gold_matches_v3.csv` with `source=verification loop v3`, `labeller=Claude (review with team)`.

## Conventions
- Business assumptions live at the top of `poc_common.py`: `CONFIG`, `RETAILERS`, `CORE_*`, scope regexes, `UNIVERSE_WHITELIST`, `WORK_MISSIONS` / `RES_MISSIONS`, `BRAND_SAFETY`, `COMPLEXITY`. Do not hard-code thresholds elsewhere.
- Every number in the report must come from the files in `Outputs_v3/final/`. No hand-typed figures.
- Never silently drop Excel rows. Every drop needs a reason that shows up in `Row_Reconciliation`.
- Labelled rows override model output. Verification-loop rows are **excluded from calibration** (selection bias).
- Write all text outputs as UTF-8 (CSV as utf-8-sig).
- Keep the code style: `# %%` cell markers, plain-language docstrings, `log()` for progress, `pc.out_path()` for outputs.
- **Report versions:** every published change gets a new version. Bump `REPORT_VERSION` in `build_html.py` (or set env `POC_REPORT_VERSION`), and keep older files in `reports/`.
- **Report structure (current v4):**
  - **Approach & Methodology:** Methods V and G drawn in parallel; AAS × CRS framework charts; no V2-critique section.
  - **Gaps & Recommendations:** KPI tiles; decision picture (collapsible) = opportunities on AAS × CRS titled with zone counts and labelled by lead sub-category (top 5 per zone, 1P-CORE GAP unlabelled), then brand fit vs adjacency, then peer evidence (no "Figure N" prefixes); zone filter (4 options, default CURATE) + theme filter (default All) driving the sub-category table sorted by O, highest first, with full score names in the headings; opportunity deep dives, findability, pass and watch list collapsed.
  - Self-contained: figures embedded as base64, no external requests. Must work at 375 px width.
- Chart labels name the sub-category (e.g. "Workbenches"), not the L1 › L2 › L3 path.
- Client-facing wording is plain English. Explain AAS / CRS / BFS / EASE / PC / O the first time each appears.

## Decisions already made (do not re-ask)
- V3 = fix the code and re-run the pipeline (not critique-only).
- Brand reach = workplace-first: residential lifestyle is downgraded, brand-unsafe categories are excluded.
- Category opportunity = zone × Staples department (embedding clusters were rejected: they mixed look-alikes).
- Deliverables = versioned HTML report in `reports/` + `Category_Recommendations_v3.xlsx`. The docx and pptx stay as V2.
