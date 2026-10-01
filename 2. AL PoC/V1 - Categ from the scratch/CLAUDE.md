# CLAUDE.md: Staples Assortment (AL) PoC, V2 (Phase 2)

Guidance for Claude working in this folder. Read `methodology.md` before any analytical or code work. It is the source of truth for method decisions (body = current method; §13 and §14 = dated change logs with evidence). If this file and `methodology.md` disagree, `methodology.md` wins; flag the conflict.

## Project in one paragraph
LatentView PoC for **Staples Marketplace** (stakeholder: Pat, Head of Staples Marketplace; Q1 2027 planning). Owner: Sai. Team: Teja, Barath, Ayan. The question: within 12 granular Staples nodes (exact L3/L4 paths), which product archetypes and attribute variants (colour, material, style, size, use-context, "vibe") does the node's competitor (Amazon, Wayfair or Scheels) carry that Staples lacks, and which of them can Staples add through the marketplace **without cannibalizing its existing assortment**. The thesis is "White Chair" / core-adjacent: design-forward and lifestyle extensions of core items. **Constraint: external data only.** There is no internal Staples sales, margin or traffic data.

## Where things stand (2026-10-01)
- **Phase 2 is built and run** on the 12 focus nodes. Current report: `outputs/report/Staples_Assortment_Report_v12.html` (same results as v8, with Sai's Tab 1 and Tab 2 edits; v5–v11 are same-day builds; v1–v4 are Phase 1). Never delete or overwrite report versions.
- **Result:** 9 scored nodes, 3 Staples-only (Desk Organizers and Desk Pads: the Amazon file has no such pages; Water Bottles: Scheels/Amazon data pending). **75 recommended archetypes** (20 Strong, 26 Vector-led, 29 Gap-led), 4–10 per scored node. Quality gates: G7 PASS; G2 PARTIAL; G1, G5, G6, G8 FAIL (explained in methodology §13/§14); G3, G4 PENDING (human labels).
- **Open items:** Pat's calibration session (CRS bands, PPR thresholds, AAS thresholds, gate parameters); competitor data for the 3 pending nodes; human gold sets (G1/G3/G4); Claude extraction/adjudication backend (no `ANTHROPIC_API_KEY`); review of the drafted node vocabularies and page crosswalks (`reviewed_by: null` → shown as provisional).
- **Things a reader must know about v8:** Gap-led picks have no fit-with-Staples check (all 10 backpack picks are Gap-led: hiking, travel, sling packs); partitions are Vector-led only (Method 2 sees cheaper attribute twins, ACR 84–100%); planners have only 4 picks.

## Running the pipeline
```bash
cd "d:/Testing/My-Staples-PoC/2. AL PoC/V2 - Categ from the scratch"
PYTHONIOENCODING=utf-8 python -W ignore run_pipeline.py              # all stages S0-S9
PYTHONIOENCODING=utf-8 python -W ignore run_pipeline.py --from s5    # from Method 1 onward (re-uses earlier outputs)
PYTHONIOENCODING=utf-8 python -W ignore run_pipeline.py --from s3 --to s8
PYTHONIOENCODING=utf-8 python -W ignore run_pipeline.py --only s9    # rebuild the report only -> next v<N>
```
- **Run times (12-core CPU, warm embedding cache):** S0 ~40 s · S1 ~2 min · S2 ~1 min (≈45 min cold: the bge-base bake-off encodes ~27k cards; set `encoder.bakeoff: false` to skip) · S3 ~4 min · S4 ~2.5 min · S5 ~9 min · S6 ~2 min · S7 ~1 min · S8 ~1.5 min · S9 ~1 min. Long runs: launch in the background and wait for the log.
- **What to re-run after a change:** vocabularies / node configs → from `s3`; archetype settings → from `s4`; Method 1 thresholds → from `s5`; Method 2 / ACR → from `s6`; final gate (min/max per node) → from `s7`; report text/template only → `--only s9`. New or changed input files → from `s0`.
- **Before changing gates or thresholds**, simulate first if Sai asks for numbers: read the stage parquet in `data/interim/`, re-apply rules in a scratch script, report per-node counts, and only change code/config after approval (Sai's working style in this project).

## Folder map
| Path | What | Rules |
|---|---|---|
| `Documents/*.docx` | Objective & Goal (Pat's mandate), Initial-Exploration methodology (Track B/C), Examples | Read-only |
| `Excels/Staples product level dataset - 12 Choosen L3s - Final Samples.xlsx` | **Phase 2 Staples input**: 5,673 rows / 4,891 SKUs → 3,416 families in the 12 focus leaves (+ a Pivot sheet, ignored) | Read-only |
| `Excels/Amazon product level dataset - 6 Chosen L3s - Final Samples.xlsx` | 20,092 rows / 13,954 ASINs: planners, backpacks, lunch bags, coffee organizers only | Read-only |
| `Excels/Wayfair product level dataset - 5 Chosen L3s - Final Samples.xlsx` | 12,280 rows / 11,175 products: clocks, accent chairs, desks, room dividers/partitions, desk lamps | Read-only |
| `Excels/1. Staples_Navigation_Tree_repaired.xlsx` | Staples tree (1,877 nodes, L1–L4, no L5) | Read-only; used to decide crosswalk siblings |
| `Excels/3. Wayfair_Navigation_Tree_v3.xlsx` | Wayfair tree; no item counts | Read-only |
| `Excels/0. Staples product level dataset - Full Samples [DO NOT USE].xlsx` | Phase-1 Staples file | **Do not use** |
| `Excels/~$*.xlsx` | Excel lock files | Ignore |
| `methodology.md` | The method (v1.3, Phase 2) | Edit only when asked; record decisions in §14 |
| `run_pipeline.py`, `src/alpoc/` | S0 `s0_ingest` · S1 `s1_families` · S2 `s2_mapping` · S3 `s3_attributes` · S4 `s4_archetypes` · S5 `s5_vector` · S6 `s6_gaps` · S7 `s7_integrate` · S8 `s8_skus` · S9 `s9_report` (+ `figures.py`, `cards.py`, `vocab.py`, `common.py`, `embed.py`, `templates/report.html.j2`, `templates/card.html.j2`) | |
| `config/pipeline.yaml` | All thresholds and weights; **safety gates under `gates`** (common / method1 / method2 / final); report title and file stem | Change thresholds here, never in code |
| `config/retailers.yaml` | Retailer adapters (file, column map, page-path columns, vendor noise, URL template) | New competitor = new entry |
| `config/nodes.yaml` | The 12 focus nodes: rank, segment · play, competitors (Primary 1 first) | |
| `config/nodes/<node>.yaml` | Per-node vocabularies: Tier-2/Tier-3 attributes, spec keys/maps, numeric bands, size band, archetype facets by tier, naming labels, material tiers, DFI anchors | Drafts (`reviewed_by: null`) |
| `config/crosswalk/<retailer>.yaml` | Page-path **prefix** → Staples leaf, or `[]` (longest prefix wins) | Drafts |
| `config/schema_universal.yaml`, `config/house_brands.yaml` | Universal vocabularies; competitor house brands | |
| `data/interim/` | Stage parquet + `qa_*.json` (git-ignored). Key files: `families`, `mapping`, `nodes`, `attributes`, `family_table`, `archetypes`, `archetype_members`, `candidates` (Method 1 labels), `m2_labels`, `archetype_m1`, `archetype_m2`, `final_archetypes`, `sku_recs` | Regenerable |
| `data/cache/` | Embedding cache per encoder (git-ignored) | Keep: saves ~45 min |
| `outputs/report/`, `outputs/figures/<node>/`, `outputs/tables/` | Versioned HTML reports, PNGs, CSVs (incl. `new_node_backlog.csv`, `final_archetypes.csv`) | Never delete report versions |
| `../../1. CL PoC/V2 - with all 5 Competitors/...` | Earlier category-level PoC | Reuse patterns; do not modify |

## Phase 2 rules from Sai (2026-10-01)
- **12 focus nodes, Primary 1 competitor only** (`config/nodes.yaml`). A node without competitor data shows a Staples-only profile.
- **Use only the Phase-1 columns:** id, title, price, url, brand/vendor, selected_choice, description, category (+ its L1–L6 path to identify the page). **Never** ratings, review counts, rank, badges, bought_past_month, list_price, image_url or the Wayfair `specifications` column.
- **Archetypes = 4 to 6 attributes mixing Tier 1 / Tier 2 / Tier 3; never price band.** Price is analysed separately (price-band coverage, price ladder, PPG, PPR).
- **Report wording:** "node", never "shelf"; archetypes labelled "Archetype (Attributes Combination)" (each shown as name + its attribute combination); every metric as "ABBR (Full name)", e.g. "TG (Total Gap)"; Tab 2 = dropdown grouped by L1; order header → key insights (incl. price findings) → coverage 2×2 grid (price bands, DFI, JSD, value gaps) → attribute level gaps (detailed, tiered, collapsed) → final recommendations (Rank, Archetype, Tier, Final score, VOS, TG, families) → SKUs → sellers → excluded (collapsed) → Method 1 (collapsed) → Method 2 (collapsed); no provisional / tier-relaxed badges. Tab 1: focus nodes with competitor, flow chart S0–S8 (no report step), archetype tiers with examples, **safety gates before quality gates**, no person's name.
- **Gates:** quality gates (G1–G8) are a scorecard and never cut recommendations; the **safety gates** do: common (C1 node scope, C2 valid archetype) → Method 1 gate on its own labels → Method 2 gate on its own ACR → final gate (union, tiers, 3–10 per node). Methodology §7.

## Data quirks (verified; don't rediscover)
- **Staples `description` is a serialized Python dict** `{paragraph, bullets, specification:[{name,value,grpName,dscr}]}`; parse with `ast.literal_eval`. Spec keys differ per node (`Cover Material`, `Backpack Material`, `Clock Display`, `Desk Top Material`, …).
- All three retailers list **colour/size variants as separate ids** → count **families** (S1). Wayfair variants share title + vendor; competitor variants merge only if the description also starts the same.
- **Amazon:** `description` is a ~110-char subtitle (58% empty); `brand/vendor` 70% empty with noise ("Learn more", "A5") → title-prefix brands are accepted only if they are known brands; prices like "2 sizes" are not prices; sponsored redirect URLs → rebuilt as `/dp/<ASIN>`; titles carry mojibake (`Ã—`, fixed by ftfy).
- **Wayfair:** `description` may have a customer review after `" | "` with **name, city and date (PII)** → split on the first `" | "`, keep the left side, never output review text. `vendor` is mostly Wayfair house brands (Latitude Run, Ebern Designs…), with mojibake (`Â®`). Page names are facet labels ("Type: Folding") → identify pages by their L1–L6 path.
- **Competitor pages mix in other Staples categories** (wall calendars on planner pages, briefcases, standing desks, desk dividers, stanchions, can coolers) → the crosswalk sends those pages to `[]` (backlog) because Staples shelves them under a sibling leaf.
- **Text length differs a lot** (Amazon subtitle vs Staples bullets) → text-measured fields use Staples text cut to the competitor's median description length (text parity).
- Competitor data are **convenience samples**; Staples is close to a census. **Compare shares, never raw counts.** Nothing may be tuned to today's counts.
- Staples private label is small; "1P" means *items Staples sells* (any brand).

## Method guardrails (non-negotiable unless Sai changes them)
- **Read `methodology.md` §7 (safety gates), §6.3 (archetypes) and §14 (Phase 2 decisions with evidence) before changing S2–S8.**
0. **Scope-agnostic.** Never hard-code categories, attribute lists, vocabularies, facets, DFI anchors or house-brand lists in code. They live in config (per node / per retailer), drafted then reviewed, flagged *provisional* until reviewed. New nodes or competitors must run with no code change.
1. Unit of analysis = **product family**. Node = the exact Staples leaf (no pseudo-L5 split in Phase 2).
2. **Product-level mapping**: page-path crosswalk + k-NN scope check over all Staples nodes + NONE threshold (Youden's J floored at 95% in-scope recall); LLM adjudication planned. Never map by page name alone.
3. **Same instrument on both sides** for any attribute that feeds a gap metric, with **text parity**. Staples specs are ground truth only for validating the text extractor (G2); fields < 85% accurate stay out of gaps and archetype attributes.
4. Embed a **canonical, source-neutral product card** (extracted fields only; same template on both sides; no price), never raw descriptions.
5. **CRS is price-agnostic and aesthetic-agnostic.** Price goes through PPR only; aesthetics through AD/ΔDFI only.
6. Gaps are **share-based** (Jeffreys-smoothed log share ratio + credibility), defined even when Staples = 0.
7. Method 1 product labels come from the **exhaustive ordered tree** (methodology §6.6): EXCLUDE, OFF-BRAND, UNDERCUT, TRADE-UP, STYLE-EXTENSION, SUBSTITUTE, LEAN-APPROVE, REVIEW, CURATE, EDGE. Method 2 labels: ATTR-UNDERCUT, ATTR-SUBSTITUTE, ATTR-TRADE-UP, ATTR-STYLE-EXT, NO-TWIN.
8. **No raw cosine values in any deliverable.** Thresholds come from calibration (Staples-vs-Staples weak supervision, then Pat). Re-fit when the encoder changes.
9. **Two method scores stay separate, each with its own safety gate**: Method 1 → **VOS** gated on its own labels; Method 2 → **TG** gated on its own **ACR** (Attribute Cannibalisation Risk). Never blend them into one formula and never gate one method with the other's metric. Final gate = union of the two lists; tier Strong (both) / Vector-led (M1) / Gap-led (M2) / Conditional (fill); 3–10 per node; ordered by the fused rank. PPR is never inside a score. Weights always ship with a Dirichlet sensitivity analysis.
10. Every recommended SKU shows the **nearest Staples product side by side** with CRS/PPR/AD, and only products safe under the recommending method(s) are shown.
11. Never claim demand. The data measures assortment supply.
12. Competitor house brands ≠ recruitable sellers. Flag `brand_on_staples` (existing supplier = quick win) and `house_brand`.

## Environment
- Windows 11. Shells: PowerShell (primary) and Git Bash. Use forward slashes in Bash and quote paths: the folders contain spaces and dots. Long multi-line Python edits: write a script to the scratchpad and run it (very long inline heredocs sometimes fail to parse in this shell).
- Python 3.14, **pandas 3.0** (default string dtype: `astype(str)` keeps NaN as missing, so use `fillna('')` before joining strings), scikit-learn 1.9, openpyxl, `anthropic` SDK 0.109, torch (CPU), sentence-transformers, umap-learn, matplotlib, jinja2, ftfy, pyarrow. **Not installed:** `python-docx` (read .docx by unzipping `word/document.xml`), qdrant-client. Ask before installing more.
- Set `PYTHONIOENCODING=utf-8` when printing unicode (cp1252 console otherwise crashes).
- HuggingFace is reachable; encoders: bge-small (chosen by the bake-off) and bge-base. No GPU (12 CPU cores).

## LLM usage (when an API key exists)
- Bulk extraction: `claude-haiku-4-5-20251001` via the Batch API with JSON-schema/tool-use output and prompt caching for the frozen schema.
- Schema induction, adjudication, DFI rubric and archetype naming: `claude-sonnet-5`. Reserve `claude-opus-5-5` for hard adjudication or review only.
- Cache every raw LLM response to disk (keyed by prompt version + product id). Version the prompts.
- **Ask Sai before any bulk run** (more than about 500 items or roughly $20+). Pilot on one node first.

## Working conventions
- Each stage writes an intermediate table and must be re-runnable on its own. Thresholds and weights live in `config/pipeline.yaml`, never in code.
- Report a failed quality gate plainly rather than working around it.
- **Deliverables: Python code, PNG figures, and ONE self-contained static HTML report.** No Excel or deck unless Sai asks. The report is a single file (no CDN, fonts or server; PNGs as base64; inline vanilla JS; Jinja2 template; under 25 MB). Tab 1 = Approach & Methodology (the focus-node table names each node's Primary 1 competitor; Sai, 2026-10-01). Tab 2 = Gaps & Recommendations (dropdown of all focus nodes). No person's name (e.g. Pat) in the report. Each S9 run writes `Staples_Assortment_Report_v<N>.html` (next N). Title and file stem: `config/pipeline.yaml` → `report`.
- Merchant-readable language; charts in the CL PoC V2 figure style.
- After a method change, update `methodology.md` (body + §14 log) and this file's "Where things stand".
- Git: commit only when Sai asks. Never commit the large Excels or any file containing review text or PII.

## History
- 2026-09-27: data audited; methodology v1 → v1.2.
- 2026-09-28: Phase 1 built and run (Chairs & Seating + Desks vs Wayfair, 23 nodes incl. pseudo-L5); reports v1–v4.
- 2026-10-01: Phase 2 (12 focus nodes; S0–S9; page-path crosswalk + scope check; 4–6-attribute archetypes; price view; text parity); then two-method safety gates (methodology §7, §14.6); report v8.
