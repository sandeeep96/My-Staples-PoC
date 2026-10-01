# Staples Assortment Gap PoC (AL PoC, V2 · Phase 2)

For 12 granular Staples nodes (exact L3/L4 paths, `config/nodes.yaml`), this pipeline finds the product archetypes and
attribute variants the node's Primary 1 competitor (Amazon, Wayfair or Scheels) carries that Staples lacks, and checks
whether Staples could add them through its marketplace without cannibalising its own assortment. The method is in
[methodology.md](methodology.md); Phase-2 changes are in §14.

## Run

```bash
pip install pandas numpy scipy scikit-learn openpyxl pyarrow pyyaml ftfy jinja2 matplotlib umap-learn
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers

python run_pipeline.py              # everything (first run downloads the encoders and embeds every card)
python run_pipeline.py --from s4    # re-run from archetypes onward
python run_pipeline.py --only s9    # rebuild the report only
```

Embeddings are cached in `data/cache/`, so re-runs only encode new text.

## Outputs

| Path | What |
|---|---|
| `outputs/report/Staples_Assortment_Report_v<N>.html` | The shareable report: one static file that works offline. Every S9 run writes the next version. Tab 1 = Approach & Methodology; Tab 2 = Gaps & Recommendations (node dropdown, all 12 nodes) |
| `outputs/figures/<node>/*.png` | Every chart in the report |
| `outputs/tables/*.csv` | Final archetypes, candidates, attribute gaps, price bands, SKU recommendations, vendors, backlog, audit samples |
| `data/interim/` | Stage outputs (parquet) and QA files (`qa_*.json`) |

## Pipeline

| Stage | Module | Output |
|---|---|---|
| S0 Ingest & clean | `s0_ingest.py` | `sku_<retailer>.parquet` (Phase-1 columns only; reviews/PII stripped) |
| S1 Families & nodes | `s1_families.py` | `families.parquet` (one grouping rule for every retailer; node = Staples leaf) |
| S2 Mapping | `s2_mapping.py` | `mapping.parquet`, `nodes.parquet`, encoder bake-off |
| S3 Attributes | `s3_attributes.py` | `attributes.parquet`, validation vs Staples specs |
| S4 Archetypes | `s4_archetypes.py` | `archetypes.parquet` (4–6 attributes, no price band) |
| S5 Method 1 (VOS) | `s5_vector.py` | `candidates.parquet` (labels), `archetype_m1.parquet` (Method 1 gate + list) |
| S6 Method 2 (TG) | `s6_gaps.py` | `archetype_m2.parquet` (ACR, Method 2 gate + list), `m2_labels.parquet`, `attr_gaps.parquet`, `price_bands.parquet` |
| S7 Final gate | `s7_integrate.py` | `final_archetypes.parquet` (union of method lists, tiers, 3–10 per node, sensitivity) |
| S8 SKUs & sellers | `s8_skus.py` | `sku_recs.parquet`, `style_extensions.parquet`, `vendor_view.parquet` |
| S9 Report | `s9_report.py`, `figures.py`, `templates/` | HTML, PNG, CSV |

## Adding data

- **Competitor data for a pending node** (e.g. Scheels or Amazon water bottles, Amazon desk organizers/pads): add the
  retailer to `config/retailers.yaml` (file + column map) if new, map its page paths in `config/crosswalk/<retailer>.yaml`,
  and re-run. The node's vocabulary already exists in `config/nodes/`.
- **A new node:** add a Staples leaf to the Staples file, a line in `config/nodes.yaml`, and `config/nodes/<node>.yaml`
  (Tier-2/Tier-3 vocabularies, archetype facets by tier, DFI anchors). Without it the node runs on universal attributes,
  flagged provisional.
- **All thresholds and weights** live in `config/pipeline.yaml`; the safety gates (common, Method 1, Method 2, final) under `gates`.

## Current limitations

- No Anthropic API key, so extraction uses the local `rules` backend (vocabularies plus embedding zero-shot) and close
  mapping calls are flagged, not adjudicated.
- Human gold sets (mapping, Tier-3 tags and DFI, audits) and Pat's calibration session are pending.
