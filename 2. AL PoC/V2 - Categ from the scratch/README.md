# Staples Assortment Gap PoC (AL PoC, V2 · Phase 2)

For 12 granular Staples nodes (exact L3/L4 paths, `config/nodes.yaml`), this pipeline finds the product archetypes and
attribute variants the node's Primary 1 competitor (Amazon for 7 nodes, Wayfair for 5) carries that Staples lacks, and
checks whether Staples could add them through its marketplace without cannibalising its own assortment. The method is
in [methodology.md](methodology.md); Phase-2 changes, with evidence, are in §14.

**Current report:** `outputs/report/Staples_Assortment_Report_v38.html` (2026-10-07). All 12 nodes are scored, giving
74 recommended archetypes (22 Strong, 23 Vector-led, 28 Gap-led, 1 Conditional) after picks one attribute apart
were merged. Details: methodology §14.10–§14.12. Deck: `outputs/ppt/Staples_Assortment_PoC_Deck_V10.pptx`.

## Run

```bash
pip install pandas numpy scipy scikit-learn openpyxl pyarrow pyyaml ftfy jinja2 matplotlib umap-learn
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers

python run_pipeline.py              # everything (first run downloads the encoders and embeds every card)
python run_pipeline.py --from s4    # re-run from archetypes onward (~65 min on a 12-core CPU)
python run_pipeline.py --only s9    # rebuild the report only (~1 min)
```

Embeddings are cached in `data/cache/`, so re-runs only encode new text. A run that includes S4–S7 repeats them once
for nodes that end with fewer than 3 gate-passing recommendations, using a smaller support bar (small-node pass).

## Outputs

| Path | What |
|---|---|
| `outputs/report/Staples_Assortment_Report_v<N>.html` | The shareable report: one static file that works offline. Every S9 run writes the next version; earlier versions are kept. Tabs: Executive Summary (static overview) → Node Analysis (node dropdown, all 12 nodes) → Methodology |
| `outputs/figures/<node>/*.png` | Every chart in the report |
| `outputs/tables/*.csv` | Final archetypes, candidates, attribute gaps, price bands, SKU recommendations, vendors, backlog, audit samples |
| `data/interim/` | Stage outputs (parquet) and QA files (`qa_*.json`) |

## Pipeline

| Stage | Module | Output |
|---|---|---|
| S0 Ingest & clean | `s0_ingest.py` | `sku_<retailer>.parquet` (agreed columns only, plus Wayfair specifications; review text/PII stripped) |
| S1 Families & nodes | `s1_families.py` | `families.parquet` (one grouping rule for every retailer; node = Staples leaf) |
| S2 Mapping | `s2_mapping.py` | `mapping.parquet`, `nodes.parquet` (page-path crosswalk + k-NN scope check), encoder bake-off |
| S3 Attributes | `s3_attributes.py` | `attributes.parquet` (full text on both sides, 3 tiers), validation against Staples specs |
| S4 Archetypes | `s4_archetypes.py` | `archetypes.parquet`, `archetype_members.parquet`: up to 3 attribute sets per node, 4–6 attributes each, preferring attributes where the retailers differ, incl. gap attributes; no price band |
| S5 Method 1 (VOS) | `s5_vector.py` | `candidates.parquet` (product labels), `archetype_m1.parquet` (Method 1 gate + list) |
| S6 Method 2 (TG) | `s6_gaps.py` | `archetype_m2.parquet` (ACR, Method 2 gate + list), `m2_labels.parquet`, `attr_gaps.parquet`, `price_bands.parquet` |
| S7 Final gate | `s7_integrate.py` | `final_archetypes.parquet` (union of method lists, tiers, ≤ 4 per attribute set, no near-duplicate picks, 3–10 per node, sensitivity) |
| S8 SKUs & sellers | `s8_skus.py` | `sku_recs.parquet` (up to 3 example products per pick: title-checked, shown once per node, off-target titles excluded via `exemplar_exclude` in the node config), `style_extensions.parquet`, `vendor_view.parquet` |
| S9 Report | `s9_report.py`, `figures.py`, `templates/` | HTML, PNG, CSV |

## Adding data

- **New data for an existing node or competitor:** update the file name in `config/retailers.yaml` if it changed,
  map any new page paths in `config/crosswalk/<retailer>.yaml` (quote leaf names that contain commas), and re-run from S0.
- **A new competitor:** add an adapter to `config/retailers.yaml` (file + column map) and a crosswalk file, then list
  the competitor for its nodes in `config/nodes.yaml`.
- **A new node:** add a Staples leaf to the Staples file, a line in `config/nodes.yaml`, and `config/nodes/<node>.yaml`
  (Tier-2/Tier-3 vocabularies, archetype facets by tier, naming labels, DFI anchors). Without it the node runs on
  universal attributes, flagged provisional.
- **All thresholds and weights** live in `config/pipeline.yaml`: archetype settings (gap facets, attribute sets,
  small-node pass) under `archetypes`, safety gates (common, Method 1, Method 2, final) under `gates`, report title under `report`.

## Current limitations

- No Anthropic API key, so extraction uses the local `rules` backend (vocabularies plus embedding zero-shot) and close
  mapping calls are flagged, not adjudicated.
- Human gold sets (mapping, Tier-3 tags and DFI, audits) and the stakeholder calibration session (CRS bands, PPR and
  AAS thresholds, gate parameters) are pending.
- Node vocabularies and page crosswalks are drafts (`reviewed_by: null`) and shown as provisional.
- Amazon's text is short (title + ~110-character subtitle), so its "not stated" shares run higher than Staples' or Wayfair's.
