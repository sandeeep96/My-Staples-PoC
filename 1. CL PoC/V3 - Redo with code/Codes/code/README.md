# Staples Marketplace PoC – Category-Level Recommendations (v3, six retailers)

This pipeline compares the Staples.com navigation tree with those of Office Depot, West Elm, Wayfair, Amazon and Walmart. It recommends which categories Staples could open to marketplace sellers, applying a workplace-first brand-fit test, a brand-safety screen and an ease score. Each category lands in one of seven zones: CURATE, VERTICAL EXTENSION, REVIEW, 1P-CORE GAP, OFF-BRAND, VERIFY and EXCLUDED. The project root has the full method (`../../Methodology.md`), the V2 critique with what was built (`../../plan.md`) and the versioned client reports (`../../reports/`).

## Files

| File | What it does |
|---|---|
| `poc_common.py` | Shared library: `CONFIG`, retailer adapters, scope, row reconciliation, L5 fold, coreness, calibration and CV, buyer missions, brand safety, complexity, BFS / EASE, zone rule, opportunity, stress test, gold bootstrap |
| `method_v_vector.py` | **Method V**: encoder bake-off (bge-base, bge-small, spaCy, WordLlama, TF-IDF), nested-CV top-1, path embeddings, Qdrant vector DB, retrieve-then-rerank, per-competitor calibration |
| `method_g_graph.py` | **Method G**: six-retailer knowledge graph (Staples and Wayfair cross-listings), similarity flooding, Personalised PageRank, Neo4j / GraphML export |
| `run_framework.py` | Ensemble, ENTER / DEEPEN units, channel-split peers, brand fit, ease, zones, mission-aware docking, gold bootstrap, category opportunities (zone × Staples department) |
| `framework_outputs.py` | Figures, `Category_Recommendations_v3.xlsx`, `summary_v3.json`, `units_all.csv`, `opportunities.csv` |
| `build_html.py` | The client deliverable: `../../reports/Staples_Category_Recommendations_<version>.html` (bump `REPORT_VERSION` per published change), two tabs, self-contained |
| `report_style.css` | Page styling, taken from the product-level PoC page |
| `gold_matches_v3.csv` | 917 labelled rows: 695 for calibration, 219 V2 verification checks and 3 V3 verification checks |
| `gold_relabel_kappa_v3.csv` | Blind second-pass labels on 60 rows (Cohen's κ) |
| `od_unmapped_placement.csv` | Reviewed placement of Office Depot's 80 breadcrumb-less pages |
| `label_sample.py` | Draws the 120-row labelling sample for a new competitor |

## Run

```bash
pip install pandas numpy scipy scikit-learn openpyxl matplotlib networkx qdrant-client adjustText sentence-transformers
python method_v_vector.py      # ~8 min on CPU (bge-base bake-off + Qdrant load)
python method_g_graph.py       # ~1 min
python run_framework.py        # ~5 min (mission scoring, stress test, bootstrap)
python build_html.py           # seconds
```

Methods V and G are independent (either order, or in parallel); `run_framework.py` needs both. For a report-only change run just `build_html.py`; after label or CONFIG changes run `run_framework.py` then `build_html.py`.

Inputs are read from `../../Excels` and outputs go to `../../Outputs_v3`. Override them with `POC_DATA_DIR` / `POC_OUT_DIR`. The V2 outputs in `../../Outputs` are read only for the V2-vs-V3 comparison.

## Encoders

`CONFIG["encoder"] = "auto"` runs a bake-off and keeps whichever encoder that loads has the best top-1 shelf accuracy on the labelled rows. Thresholds re-calibrate automatically. In this run, bge-base won; spaCy and WordLlama were not installed. Brand-fit mission scoring always uses bge-base when it is available.

## Adding a competitor

1. Add an adapter to `RETAILERS` in `poc_common.py`: file pattern, level columns, count column and `count_mode`, role, B2B rule, row filter and its description, scope rules, and reference sheets.
2. Run `method_v_vector.py`. The new competitor starts on pooled calibration, flagged as provisional.
3. Run `python label_sample.py <Name>`, label the 120 rows, append them to `gold_matches_v3.csv`, then re-run all scripts.
