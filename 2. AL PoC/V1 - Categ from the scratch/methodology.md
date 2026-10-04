# Staples Assortment PoC: Node-Level Assortment Gap and Recommendation Methodology

**Status:** v1.3 (Phase 2) · 2026-10-01 · Owner: Sai (LatentView). The body describes the pipeline **as built and run in Phase 2**: 12 focus nodes, stages S0–S9, archetypes of 4–6 attributes, a separate price view, and **two-method safety gates** (common gates → one gate per method → final gate). History: v1.1 (2026-09-27) Sai's §11 answers and data-driven scope; v1.2 separate VOS/TG scores and the code + PNG + static-HTML output; v1.3 Phase 2. §13 (Phase 1 build) and §14 (Phase 2) are the dated change logs with the evidence behind each decision; where an older paragraph and §14 disagree, §14 wins.
**Supersedes:** Track B/C in `Documents/Staples PoC - Approach & Methodolgy -Initial Exploration.docx`, and the 6-step method shared in chat.
**Scope of this document:** the method and the reasoning behind every rule. Thresholds live in `config/pipeline.yaml`; the latest run's numbers are in §14.6 and the HTML report.

---

## 0. Summary

**Question:** Within a granular Staples navigation node (for example *Accent & Waiting Room Chairs* or *Office Desks → L-Shaped*), which product archetypes and attribute variants (colour, material, style, price tier, size, use-context) does a competitor carry that Staples does not? Which of those can Staples add through its marketplace without cannibalizing what it already sells?

**Answer shape:** for each analysis node we produce:
1. a gap profile at attribute level (which attribute values are under-represented),
2. a ranked list of archetypes with a decision label (CURATE, TRADE-UP, STYLE-EXTENSION, and so on),
3. 3–5 exemplar competitor SKUs per shortlisted archetype, shown next to the nearest Staples SKU, with brand and seller notes.

**What changed from the earlier versions.** Each change is traced to evidence in §2 and §3.

| # | Change | Why |
|---|---|---|
| 1 | Map at **product level**, not category-name level | Wayfair "categories" include room and shop-by-space pages (*Meeting Space Seating*, *Hospitality Seating*). 156 products sit on more than one page. The name VLOOKUP failed, and path-embedding mapping in CL PoC V2 reached only 43–55% top-1 for Wayfair |
| 2 | The unit of analysis is the **product family**, not the SKU row | Staples lists each colour as a separate SKU: 4,725 SKUs collapse to about 2,860 families, and 58% of SKUs sit in multi-colour families. Wayfair lists one family with a selected option. Raw counts would inflate Staples' depth |
| 3 | **Share-based gaps** replace count-based Depth Gap | Staples data is close to a census (85–100% of site counts per leaf). Wayfair data is a sample of unknown design with no site totals. `log1p(comp) − log1p(staples)` compares a sample with a census. Shares compare like with like and stay defined when Staples has 0 |
| 4 | Every metric's inputs are **measured the same way on both sides** | Staples descriptions contain a structured spec dict (colour 97%, material 94%, dimensions 91%). Wayfair has free text only. Extracting Staples from specs and Wayfair with an LLM would build measurement bias into every gap. See §6.2 |
| 5 | Embed a **canonical product card**, not raw descriptions | Staples raw text averages 3.8k characters of serialized spec dict. Wayfair averages 0.7k characters of prose plus an appended customer review. Raw embeddings would separate products by source rather than by product |
| 6 | CRS is **price-agnostic**. PPR carries price | In the doc, TRADE-UP needs CRS > 60 and PPR ≥ 1.5. PPR ≥ 1.5 forces the price-proximity term `po` to 0, which removes 25 of CRS's 100 points, so TRADE-UP was nearly unreachable |
| 7 | **Exhaustive decision tree** in place of a threshold grid | The doc's label grid leaves some AAS × CRS regions undefined (for example AAS 40–60 with CRS 40–60) |
| 8 | New **STYLE-EXTENSION** label | This is the user's "flavours" ask: functionally the same as a Staples product but in a colour, material or style Staples lacks. Under the old rules these fell into SUBSTITUTE and were rejected |
| 9 | Components without data are **dropped or replaced** | Nothing in the data supports the Personalised-PageRank complement graph, the "also-viewed" `sub` term, image-based SigLIP DFI, or review-count demand. §6 gives a replacement for each and §11 lists the data requests |
| 10 | Brand fragmentation becomes **recruitability** | Wayfair's `vendor` is mostly Wayfair house brands (Latitude Run, Ebern Designs, Inbox Zero, George Oliver: the top 15 by volume are all house labels). HHI on those measures Wayfair's labelling, not the seller market |
| 11 | Method 1 and Method 2 each keep a **final score (VOS, TG)** and **their own safety gate** (each with its own cannibalisation check), then a final gate takes the union of their lists (Phase 2, §7) | Separate scores keep each method readable and make agreement visible. The shared gate stops a large attribute gap that is really a substitute from being recommended. The fused rank gives the final list (§7) |
| 12 | Thresholds are **anchored by calibration**, not by percentile alone | Pure percentile thresholds put a fixed fraction of candidates into each label whatever the reality. Before Pat's session, Staples-vs-Staples pairs give a weakly supervised anchor (§6.6) |

---

## 1. Objective, mandate and scope

### 1.1 Business mandate (from *Objective & Goal.docx*)
- Stakeholder: Pat, Head of Staples Marketplace. Target: Q1 2027 planning.
- **Core-adjacent ("White Chair") logic:** design and lifestyle extensions of core items Staples lacks, for example aesthetic-first office seating that competes with Wayfair without diluting core B2B.
- **1P protection:** do not cannibalize Staples' existing assortment.
- **Constraint:** external market data only (competitor and Staples.com crawls). No internal Staples data (sales, margin, traffic).
- **Levers:** quick wins, basket attach (1–2 marketplace items per checkout), a predictable 6–18 month commission roadmap.

### 1.2 Analytical objective
For every in-scope analysis node *n*:
- **Where are the gaps?** Which attribute values and archetypes are over-represented at the competitor relative to Staples (Method 2, plus Method 1's vector opportunity)?
- **Are they safe and on-brand?** Would each candidate substitute a Staples item (CRS), does it fit Staples' customer (AAS), and is it priced to trade up or to undercut (PPR)? (Method 1)
- **What should be added?** Name the archetypes and exemplar SKUs, with brand and seller notes and a confidence level.

### 1.3 Scope: decided by the data, not written into the method
The current samples are a starting point. They will be enriched with more categories, or with completely different ones, and more competitors may follow. **Nothing in the method or code may be hard-wired to chairs, seating or desks.** Scope is worked out on every run:

- **In-scope analysis nodes:** every Staples analysis node that meets the minimum size on *both* sides after mapping (§5.3). With today's data that is Furniture → Chairs & Seating and Desks, because that is where the Wayfair sample overlaps. Tomorrow it could be Labels or Lighting, with no code change.
- **Staples-only nodes** (Staples data but no competitor data, for example Labels and Shipping today) are listed in a coverage report with their family counts and not scored.
- **Unmapped competitor products** go to a **new-node backlog** (today: bean bags, theatre seating, patio dining, door mats, restaurant sets and similar). They are not scored here. That is a category-level (CL PoC) question, not an assortment question.
- **Competitors** are added through a retailer adapter (a column mapping plus page-to-tree metadata). Wayfair, consumer and Professional pages together, is the only one today.

§1.4 lists what is generated per node and what stays fixed.

**Phase 2 scope (2026-10-01):** 12 focus nodes chosen by Sai (exact Staples L3/L4 paths, `config/nodes.yaml`), each compared with its **Primary 1** competitor (Amazon or Wayfair; Water Bottles moved from Scheels to Amazon on 2026-10-03). Nodes whose competitor has no data run as Staples-only profiles (none since 2026-10-03). The method itself stays scope-agnostic: any Staples leaf in the data becomes a node.

**First vertical slice (Phase 1):** a run-time choice, not a code path. With today's data it is *Chairs & Seating → Accent & Waiting Room Chairs* (the White Chair thesis node: 199 Staples SKUs against Wayfair *Accent Chairs*, *Custom Accent Chairs*, *Waiting Room & Reception Chairs* and *Reception Seating*), with *Office Chairs* as the contrast node. Then all other in-scope nodes.

### 1.4 Scope-agnostic design: what is generated per node vs fixed
Anything category-specific is **generated from the data** (usually an LLM draft from a sample, then a quick human review) and stored as a versioned config file per node or per L2. The code only reads those files. Examples in this document (chair types, desk shapes, boucle) are illustrations, not rules.

| Component | Generic (same everywhere) | Generated per node / retailer from data (config) |
|---|---|---|
| Ingest (S0) | Retailer adapter: column map, price parser, PII stripping | New retailer = new entry in `retailers.yaml` |
| Families & nodes (S1) | One grouping rule for all retailers (brand + name stem, colour segments removed); node = Staples leaf | Focus list and competitor order (`nodes.yaml`) |
| Mapping (S2) | Page prior + product-level k-NN scope check + NONE threshold (+ planned LLM adjudication) | Page-path prefix → Staples leaf crosswalk per retailer (`crosswalk/<retailer>.yaml`) |
| Schema & extraction (S3) | Tier 1 and Tier 3 definitions; matchers; full text on both sides; validation against Staples specs | Per node (`nodes/<node>.yaml`): Tier-2 and Tier-3 vocabularies, spec keys and maps, numeric bands, vocabulary overrides |
| DFI | Anchor contrast on the neutral card, pooled percentile | Design / utility anchors per node |
| Archetypes (S4) | 4–6-attribute search with tier mix, refinement, long tail, HDBSCAN cross-check | Facet candidates by tier, naming order and labels per node |
| Scores & gates (S5–S7) | All formulas, decision tree, ACR, safety gates, weights | Thresholds (calibrated per L2), gate parameters (`pipeline.yaml` → `gates`), material tiers per node |
| SKUs & sellers (S8) | Exemplar scoring, `brand_on_staples` logic | Competitor house-brand list, per retailer |

Every generated artefact carries a `generated_by` (model and prompt version) and `reviewed_by` field. Categories with no review yet run with a **provisional** flag shown in all outputs.

---

## 2. Data audit (what is actually in the files)

Profiled on 2026-09-27. These findings drive most of the design choices.

### 2.1 Staples (Phase 1 file): `Staples product level dataset latest - Samples.xlsx`
- 31,979 rows, 26,861 unique `product_id`. 4,781 are exact duplicate rows and 141 products sit in more than one leaf.
- Columns: `L1–L4`, `Final level Category`, `product_id`, `product_name`, `price`, `product_link`, `model_number`, `reviews`, `description`.
- Chairs & Seating plus Desks: **4,725 unique SKUs → about 2,860 name-stem families**. Colour variants are separate SKUs (for example *Arozzi Arena Gaming Desk* has 10 colour SKUs).
- **Coverage against site counts** (navigation tree `Count`): Office Chairs 982/1,008, Accent 199/229, Counter Stools 602/617, Office Desks 1,266/1,501, Sit & Stand 396/576. Treat as a near-census. The thin leaves (Big & Tall 39/79, Hutches 40/77) need a re-crawl or a caveat.
- **`description` is a serialized Python dict** `{paragraph, bullets, specification[{name, value, grpName, dscr}]}`. It parses 100% with `ast.literal_eval`. Spec coverage in Chairs and Desks: True Color 97%, Furnishing Material 94%, W/D/H 91%, Assembly 87%, Warranty 78%, Weight 70%, Series/Collection 63%, Base Material 54%, Arm Type 52%, **Furnishing Style 47%**, Chair Type ~20%, Desk Shape 34%.
- `reviews` looks like `"4.57 stars ( reviews)"`: rating is present for 61% of rows and **the review count is always empty**.
- `price` is a `"$xx.xx"` string with 152 nulls. Chairs and Desks median is $355.
- Brands: Flash Furniture (1,214), Boss, Bush, Offices To Go, HON and others. **Staples private label is about 1.4%**, so "1P" here means *items Staples sells*, not *Staples-brand items*.
- The navigation tree has no L5 (L5 is empty for all 1,877 rows). The deepest level is L4.

### 2.2 Wayfair (Phase 1 file): `Wayfair product level dataset latest - Samples.xlsx`
- 12,255 rows, 11,468 unique `product_id`. 787 are duplicate rows and 156 products appear on more than one listing page.
- Columns: `category` (the listing page, with "&" mangled to 3 spaces), `product_id`, `product_name`, `price`, `url` (60% carry a `piid` variant id), `vendor`, `selected_choice` (the displayed variant: colour or material, 57% filled), `description`.
- **No structured specs, rating, review count, image URL or option list.**
- `description`: median 595 characters. **41% have one customer review appended after `" | "`**, including reviewer name, city and date. That is PII: strip it and never show it.
- `vendor`: 612 values, mostly **Wayfair house brands**, with mojibake (`Latitude RunÂ®`).
- `price`: `$` string. 12 rows are `"per item"` (pack pricing). Median $230.
- Listing pages come from three Wayfair trees (Consumer, Professional B2B, Professional Shop-by-Space). The Wayfair navigation file has **no item counts**, so Wayfair site totals are unknown.
- Pages with no Staples counterpart: Outdoor Door Mats (962), Bean Bag Chairs (864), Patio Dining Chairs (814), Restaurant Table & Chair Sets (697), Theater Seating (198), Chiavari (19), Office Cubicles (48).
- Quality: some descriptions do not match their title (an armchair described as "this office chair is ergonomic…"), and some products are on the wrong page (an armchair listed under *Office Chairs*).

### 2.3 Other inputs
- `1. Staples_Navigation_Tree_repaired.xlsx`: 1,877 nodes, a canonical path per node, a Cross-Listings sheet, and per-leaf counts.
- `3. Wayfair_Navigation_Tree_v3.xlsx`: 2,231 rows across Consumer, Pro and Shop-by-Space trees, plus a Unique Categories sheet (1,308).
- `Vlookup - Manual Trail … [Failed - DO NOT USE].xlsx`: name-based page-to-leaf mapping. 25 of 32 pages got no match. It is kept only as evidence for change #1.
- The CL PoC V2 code (`1. CL PoC/V2 …/code/`) has reusable parts: the encoder bake-off harness, local Qdrant, the calibration utilities and the figure style.

### 2.4 What the data cannot support yet (and the fallback used)
| Needed for | Missing | Fallback in this method | Data request (§11) |
|---|---|---|---|
| Demand weighting | Review counts on both sides, rank position | Supply-side proxy (Wayfair family depth) with a caveat. The D term is off by default | Wayfair review count and rating; listing rank position |
| Image-based DFI | Image URLs | Text-based DFI from an LLM rubric plus text anchors | Primary image URL on both sides, then an image DFI |
| Wayfair colour breadth | Option lists (only `selected_choice`) | Colours from title, choice and description as a lower bound | Crawl the option list per family |
| Contextual adjacency (PPR graph) | Also-viewed and complement widgets | A_ctx from extracted use-context overlap | Optional: "customers also viewed" crawl |
| Absolute depth | Wayfair site totals and sampling design (the sample is a convenience set of successful scrapes) | Share-based metrics with credibility only | None for now (answered in §11) |

---

### 2.5 Phase 2 inputs (profiled 2026-10-01)
| File | Rows / unique products | What matters |
|---|---|---|
| `Staples product level dataset - 12 Choosen L3s - Final Samples.xlsx` | 5,673 / 4,891 SKUs → 3,416 families | The 12 focus leaves (L4 empty); same serialized description dict as Phase 1; spec keys differ by node (e.g. `Cover Material`, `Backpack Material`, `Clock Display`) |
| `Amazon product level dataset - 7 Chosen L3s - Final Samples.xlsx` | 34,265 rows / 14,591 ASINs → 14,070 families (the same ASIN repeats across many rows; S0 keeps one row per id) | Planners, backpacks, lunch bags, coffee organizers and, since 2026-10-03, **water bottles** (Sports Water Bottles, Thermoses, Flasks), **desk organizers** (Pencil Holders, Paper Clip Holders, Desktop & Off-Surface Shelves; Keyboard Drawers and Copyholders go to the backlog) and **desk pads** (Desk Pads & Blotters). Replaces the 6-L3 file. `description` is a ~110-character subtitle (58% empty); `brand/vendor` 70% empty with noise ("Learn more", size codes); prices like "2 sizes"; sponsored redirect URLs; colour variants as separate ASINs |
| `Wayfair product level dataset - 5 Chosen L3s - Final Samples.xlsx` | 12,280 / 11,175 products → 10,841 families | Clocks, accent chairs, desks, room dividers / office partitions, desk lamps. Same description + review (PII) format as Phase 1; colour/size variants are separate ids with the same title + vendor; page names are facet labels ("Type: Folding"), so a page is identified by its L1–L6 path |

**Columns used (Sai):** the Phase-1 columns (id, title, price, url, brand/vendor, selected choice, description, listing page and its path) plus, since 2026-10-03, the Wayfair `specifications` column ("Name: value | …", 30% filled, no review text). Ratings, review counts, ranks, badges, list prices and images are never read.

## 3. Critique of the proposed methodologies

### 3.1 Chat version (steps 1–7)
| Step | Assessment | Enhancement |
|---|---|---|
| 1 Nav and SKU gathering | Done, but the Wayfair sampling design is undocumented and there are no demand signals | Record the sampling method and site totals. Add review count, rating, option list and image URL (§11) |
| 2 Map competitor navigation to Staples L1–L5 | Mapping nav to nav is the wrong grain. Wayfair pages are rooms and uses, many-to-many, and they mis-shelve products. There is no Staples L5 | Map **each Wayfair product family** to a Staples **analysis node**. Create pseudo-L5 nodes from Staples' own type facets (§5) |
| 3 Finalise attribute list | The right idea, but a flat list mixes universal, functional and lifestyle attributes, and it lacks controlled vocabularies | A 3-tier schema with closed vocabularies, seeded from Staples' own spec keys and frozen after induction (§6.1) |
| 4 Extract from descriptions | Extraction differs by source: Staples has specs, Wayfair has text | Same instrument for every attribute that feeds a gap. Staples specs become **free ground truth** for scoring the LLM extractor (§6.2) |
| 5.1 Archetype = combination of all attributes | With about 15 attributes the cross-product is millions of cells and almost all are empty, which makes the result generic, as you noted | A **facet grid of 3–5 high-information facets per node**. The remaining attributes describe the archetype rather than define it. Validate with HDBSCAN (§6.3) |
| 5.1 Embed archetypes | Embedding a synthetic archetype string collapses to generic text | Embed **SKUs as canonical cards**. The archetype vector is the centroid of its members (§6.4) |
| 5.1 "Vector opportunity score" | Not defined | **VOS** = Method 1's final score, combining vector whitespace (VW, a balanced k-NN two-sample density test), AAS, AD and a CRS penalty (§6.5.6) |
| 5.1 AAS / CRS / PPR | Sound skeleton. Carries the doc's issues (next table) | Fixed in §6.5 |
| 5.2 DG, CR | Count-based, and both break under sample-vs-census comparison and at Staples = 0 (CR is undefined, DG is dominated by sample size) | Smoothed **log share ratio** with a Bayesian credible filter (§6.7.1) |
| 5.2 PPG (Wasserstein) | Unsigned, so it cannot distinguish "Staples lacks premium" from "Staples lacks value" | Keep the magnitude, add a sign, add a price-band coverage gap. Direction goes to PPR (§6.7.2) |
| 5.2 CG (colour gap) | Only light and neutral share, so it misses other colours | Generalise to an **Attribute Distribution Gap** for every categorical attribute (JSD plus signed value gaps). Colour is one instance of it (§6.7.3) |
| 5.2 DFG | Depends on image DFI, and there are no images | Text DFI now, image DFI once URLs are crawled (§6.2.4) |
| 5.2 Brand fragmentation | Measures Wayfair's labelling | Reframed as recruitability at the SKU stage (§8.3) |
| 5.2 TG weights 0.35/0.25/0.20/0.20 | Arbitrary, and `pct()` has no stated population | Percentile within an L2 peer group across archetypes. Dirichlet weight-sensitivity with a rank-stability report (§6.7.5) |
| 6 Insights | Good | A per-node view in the HTML report, and a method-agreement tier on every recommendation (§7, §9) |
| 7 Recs and vendors | Good | Exemplars chosen by centroid proximity plus low SKU-CRS plus diversity (MMR), each shown with its nearest Staples SKU (§8) |

### 3.2 Document version (Track B/C)
**Keep:** facet-grid archetypes validated by clustering; nameability test; LLM two-pass extraction with confidence and evidence span; schema freeze; dedup; the core AAS/CRS/PPR idea (mean-pooling for adjacency, max-pooling for cannibalization); UNDERCUT hard reject; VERTICAL EXTENSION hold; Pat calibration session; "no raw cosine in deliverables"; re-fit on encoder change.

**Fix:**
1. **TRADE-UP unreachable.** The `po` term inside CRS cancels PPR ≥ 1.5, so CRS is now price-agnostic.
2. **Label grid not exhaustive.** Replaced with an ordered decision tree (§6.6).
3. **A_ctx (PageRank on complement graph) and `sub` (also-viewed).** No data for either. Dropped, and weights renormalised. A_ctx is replaced by use-context overlap.
4. **SigLIP DFI.** No images. Text DFI for now (§6.2.4).
5. **Stratified facet-enumeration sampling.** It had not been done: the sample is 32 listing pages. Share metrics remove the need for inclusion-probability reweighting. If rank position is available, rank-weighting is optional.
6. **Revenue-at-risk and net contribution (5.5).** They need 1P margin and demand, which we do not have. Moved to an optional scenario appendix, not part of the score.
7. **Percentile-only thresholds.** Anchored by calibration pairs (§6.6).
8. **Dedup via manufacturer.** Manufacturer is unobservable behind Wayfair house brands. Dedup uses a card-embedding, dimension and price fingerprint instead (§4.3).
9. **Retailer set of 5 with a style reference corpus.** Descoped to Wayfair for now. The adapter pattern keeps the pipeline open to more competitors.

---

## 4. Pipeline overview

```
 S0  Ingest & clean ─► S1  Families & nodes ─► S2  Competitor mapping          [C1 node scope]
                                                          │
 S3  Attributes (3 tiers, per-node vocabularies, full text, validation G2)
                                                          │
 S4  Archetypes (4–6 attributes mixing the tiers; no price band)                  [C2 valid archetype]
        ┌─────────────────────────────────┴─────────────────────────────────┐
 S5  METHOD 1 · vector view                               S6  METHOD 2 · attribute view
     VW · AAS · CRS · AD · PPR → product labels                LSR · PPG · CG · MSG · DFG → TG
     score: VOS                                                ACR: attribute twins + price
     [Method 1 gate] → Method 1 list (top n by VOS)            [Method 2 gate] → Method 2 list (top n by TG)
        └─────────────────────────────────┬─────────────────────────────────┘
 S7  [Final gate] union of the two lists → tier (Strong / Vector-led / Gap-led / Conditional) → 3–10 per node
                                          │
 S8  SKU picks (safe under the recommending method) · nearest Staples product · brands and sellers
                                          │
 S9  Report: one static HTML file, PNG figures, CSV tables
```

Every stage writes a versioned intermediate table, so each can be re-run and inspected on its own (`run_pipeline.py --from / --to / --only`).

**Two kinds of gate.** *Safety gates* (§7: C1, C2, Method 1, Method 2, final) decide what is recommended. *Quality gates* (§10: G1–G8) are a scorecard on how trustworthy each step is; they are reported in the report and never remove a recommendation.

## 5. Stages S0–S2: data preparation, nodes and mapping

**What these stages are for.** They produce no recommendations. They make the Staples-vs-competitor comparison fair: every later stage compares "share of X at the competitor" with "share of X at Staples" *within the same node*.

| Stage | Question it settles | What goes wrong without it |
|---|---|---|
| S1 Families | *What is one product?* | Staples, Amazon and Wayfair all list colour/size variants as separate ids; raw counts would inflate whichever retailer splits most |
| S1 Nodes | *Which node are we comparing on?* | Phase 2 compares exact Staples L3/L4 leaves (Sai's focus list) |
| S2 Mapping | *Which node does each competitor product belong on?* | Competitor pages mix in products of other Staples categories (wall calendars on a planner page, standing desks on a desk page) |

Side outputs: colourway counts per family (STYLE-EXTENSION), identical products already carried (prevents false whitespace), and the backlog of competitor products with no focus node.

### 5.1 S0 Ingest and clean
- One adapter per retailer (`config/retailers.yaml`): column map, page-path columns, vendor noise rules, URL template.
- Prices must carry a `$` amount ("2 sizes" is not a price); `per item` is flagged as pack pricing.
- Staples `description` dict → `paragraph`, `bullets`, `specs`. Ratings are not parsed or used.
- Competitor `description`: Wayfair is split at the first `" | "` and the right side (review text with name, city, date: PII) is **dropped**; Amazon's subtitle has no review.
- Mojibake fixed (`ftfy`); Wayfair page names: triple space → " & ". A competitor page is identified by its full L1–L6 path. Amazon links are rebuilt as `/dp/<ASIN>`; vendor noise ("Learn more", size codes) is blanked.

### 5.2 S1 Family grouping and dedup
- **One rule for every retailer:** same brand + same name stem (title without the trailing model code and without short segments that only name a colour). Staples families are also kept within one leaf.
- **Competitor variants** additionally need the same description start (first 80 characters): house-brand titles are generic ("Metal Desk Lamp").
- **Brand:** the vendor when present; otherwise a title prefix, accepted only if it is a known brand (a Staples brand or a vendor the retailer shows elsewhere). Single colour, material or generic words are never brands.
- `brand_on_staples` = the competitor brand also sells on Staples (quick-win supplier).
- **Cross-retailer identical products** are flagged in S5 (title-card cosine ≥ 0.95 and price within ±15%) and labelled EXCLUDE.
- **Counting unit** for every share: the family. Colourway breadth is a separate attribute (§6.7.4).

### 5.3 Analysis nodes
- **Node = the exact Staples leaf** (Phase 2 focus list). The Phase-1 pseudo-L5 split (large leaves split by Staples' type facet) is dropped: the focus list already names the granular node.
- Status: **scored** (≥ 30 families on each side), **thin** (descriptive only) or **Staples-only** (no competitor data yet: a Staples profile is shown).
- The node's competitor is the first competitor in `config/nodes.yaml` with mapped products on it; a leaf not in the list uses the competitor that maps the most products to it.

### 5.4 S2 Competitor mapping (competitor family → node | NONE) — gate C1
1. **Page prior.** `config/crosswalk/<retailer>.yaml` maps page-path **prefixes** to a Staples focus leaf, or to `[]` when Staples shelves those products under a different (sibling) leaf or not at all; the longest matching prefix wins. Pages matching no prefix get automatic candidates (flagged provisional).
2. **Product-level scope check.** A similarity-weighted k-NN (k = 15) over **all** Staples families (every node) predicts each product's node from its mapping card (title + first 40 description words).
3. **Mapped** only if the predicted node is the page's node AND the product's affinity to that node (mean of its 5 closest Staples families) ≥ τ. τ = Youden's J between known in-scope products (single-candidate pages, predicted correctly) and known out-of-scope products (`[]` pages), **floored to keep ≥ 95% of the in-scope products**: whole out-of-scope pages are already removed by the crosswalk, so the product check only has to catch mis-shelved items.
4. Status: `mapped`, `none_page`, `none_misshelved`, `none_far`; NONE products go to `new_node_backlog.csv`. Products mapped to a node whose chosen competitor is another retailer are kept out.
5. **Encoder bake-off** (bge-small vs bge-base) on Staples leave-one-out node accuracy + NONE balanced accuracy; the winner is used everywhere. LLM adjudication of close calls (top vote < 60%) is planned (needs an API key); they are flagged instead.

## 6. Stages S3–S6: attributes, archetypes and the two methods

### 6.1 S3 Attribute schema (3 tiers, closed vocabularies)
Seed the schema from **Staples' own spec keys**. The result stays in the Staples merchandising team's vocabulary, and attributes Staples does not track (such as style on 53% of SKUs) become insights in their own right. Extend it with lifestyle attributes. Run schema induction on about 300 Wayfair families per L2 (Sonnet 5 proposes values with frequencies), then review by hand and **freeze**. Every field allows `unknown`. Nothing is imputed.

**Tier 1: universal (all nodes)**
| Attribute | Type / vocabulary |
|---|---|
| price | float (unit price) → node-specific price band (pooled quantiles rounded to merchant breakpoints) |
| brand_display | string (Wayfair house-brand flag) |
| colour_raw → colour_family | about 14 families (black, white, grey, beige/cream, brown/wood-tone, navy, blue, green, red/pink, yellow/orange, purple, metallic, multi/pattern, clear) |
| colour_tone | light-neutral / dark-neutral / warm-neutral / bold-saturated / pattern |
| material_primary, material_class | node vocabulary (for example mesh, bonded leather, faux leather, genuine leather, fabric, velvet, boucle, linen, vinyl, molded plastic, solid wood, engineered wood, metal, rattan/wicker, glass) |
| finish / frame_material / base_material | controlled vocabulary |
| style_family | modern, contemporary, mid-century, industrial, traditional, farmhouse/rustic, glam, scandinavian, minimalist, transitional, boho/coastal, gaming, utilitarian/corporate |
| dims W/D/H (in), weight (lb), weight_capacity (lb) | float, then size_class (compact / standard / oversize) |
| assembly, warranty_years, pack_qty, commercial_grade | enum / float / int / bool |
| certifications | BIFMA, GREENGUARD, FSC, and similar (multi-label) |

**Tier 2: node-specific functional attributes (these define substitution)**
Generated per L2 (§1.4). The two lists below are what we expect induction to produce for today's data. They are illustrations, not hard-coded fields.
- *Chairs:* form_factor/chair_type, mechanism (fixed / tilt / synchro / multi), arm_type, base_type (casters / legs / sled / pedestal / 4-star), swivel, height_adjustable, back_height, lumbar, headrest, recline, stackable, folding, seat_material, upholstery_texture.
- *Desks:* desk_type, shape (rectangular / L / U / corner / bow), sit_stand (none / manual / electric), top_material, width_band, drawers, storage, keyboard_tray, cable_mgmt, frame_material.

**Tier 3: experiential and lifestyle attributes (LLM-inferred, the "vibe")**
| Attribute | Type |
|---|---|
| aesthetic_tags | multi-label from a closed list of about 25 (sculptural, cozy, organic/curved, tufted, channel-tufted, minimal, statement, retro, luxe, natural/warm, playful, …) |
| design_forward_index (DFI) | 1–5 rubric, then scaled to 0–1 (§6.2.4) |
| use_context | home office, corporate office, reception/lobby, breakroom/café, conference, education, healthcare, hospitality, gaming, kids/teen, outdoor (multi-label) |
| end_user_segment | big & tall, bariatric, petite, kids, teens, gamers, students, remote workers, facilities buyers |
| key_benefits | ergonomic, space-saving, easy-clean/antimicrobial, sustainable, customisable, portable, … |
| positioning | value / mid / premium (from language, not price) |

Tier 1 and Tier 2 feed archetypes and substitution. Tier 3 feeds the lifestyle gap and naming.

**As built (Phase 2).** Each node has a config (`config/nodes/<node>.yaml`, provisional until `reviewed_by` is filled) with: vocabulary overrides (e.g. backpack or planner materials), Tier-2 functional attributes (with Staples spec keys and maps where they exist; `spec_role: indicator` when Staples' spec vocabulary differs from product copy, so the attribute is read by text on both sides), Tier-3 node attributes (design theme, pattern, audience…, with a default such as "plain" when nothing is mentioned), numeric fields and bands (laptop fit, capacity, pod capacity, diameter, panels), the node's size band, archetype facet candidates **by tier**, naming labels, material tiers (TRADE-UP) and DFI anchors. Universal Tier-3 adds a single-valued **vibe** = the first aesthetic tag in priority order, else "plain". Yes/no features are "mentioned in the text" measures on both sides ("no" is shown as "not stated").

### 6.2 S3 Extraction, normalisation and QA

#### 6.2.1 Sources and precedence
- **Staples:** deterministic mapping of spec keys to the schema through a synonym table (`True Color`/`Furnishing Color`/`Color Family` → colour, and so on). The LLM fills only the remaining gaps and Tier 3.
- **Wayfair:** the LLM reads the title, `selected_choice` and the cleaned description. Precedence when sources conflict: **title > selected_choice > description**, and the conflict is logged. This handles the mismatched descriptions seen in the audit.

#### 6.2.2 The same instrument on both sides (critical)
- Tier 3 (style, aesthetic, DFI, use-context) and `style_family` are extracted **by the same LLM prompt from the same kind of input (title plus a text summary) on both sides**, even when Staples has a spec value. A Staples "Furnishing Style: Contemporary" and an LLM's "mid-century" come from different instruments, and the gap would reflect that difference rather than the assortment.
- For Tier 1 and Tier 2 physical facts (dimensions, material, colour, arm type), Staples specs are the truth and competitor values come from text. We validate that the two agree (next step).
- **Full text (Sai, 2026-10-03; replaced text parity).** Every attribute is read from all available text, uncut: Staples = title + paragraph + bullets + specification values; Amazon = title + description; Wayfair = product name + selected choice + description (review part dropped) + `specifications`. Specifications add their **value** only (spec names carry category words such as "Accent & Waiting Room Chair Type"); the name is added only for an affirmative value ("Water Resistant: Yes" → "Water Resistant"); negative values ("No", "Non Gaming", "Non-Antimicrobial", "Not Included") are left out. G2 validation reads Staples title + paragraph + bullets (full, no specs), so it is not circular. **Caveat:** Amazon has the least text (title + a ~110-character subtitle), so its "not stated" share is higher than Staples' or Wayfair's for any feature; tag gaps where Staples looks deeper are partly this effect.

#### 6.2.3 Extractor validation: Staples specs as free ground truth
- Hide the specs and run the Wayfair-style text-only extractor on 300 Staples families, stratified by node.
- Score per-field accuracy against the specs (exact match for enums, ±5% for numbers).
- **Rule:** a field below 85% accuracy is fixed through the prompt or vocabulary, or else excluded from gap metrics and reported descriptively only.
- Tier 3 has no spec truth. Two people label 100 Wayfair and 50 Staples families on 6 key fields. Targets: Cohen's κ ≥ 0.6 between raters and LLM agreement ≥ 0.8 of the human agreement.

#### 6.2.4 Design-Forward Index (DFI)
- **Now (text):** Sonnet 5 applies a 1–5 rubric with anchored examples:
  - 1 = corporate or utilitarian (black mesh task chair)
  - 3 = transitional or home-office friendly
  - 5 = residential designer or sculptural statement piece

  The input is the title, the description summary and the Tier 3 tags. The output is a score and a rationale. We also compute an embedding contrast, `cos(card, A_design) − cos(card, A_utility)` with prompt anchors, as a cross-check (Spearman ≥ 0.6 expected).
- **Later (image):** once image URLs are crawled, add a SigLIP-2 contrastive score as the doc proposed. DFI becomes the mean of the text and image scores after z-normalisation. Validate against 200 human-rated items (κ ≥ 0.65).

#### 6.2.5 Normalisation
- Colour goes to a family and tone (dictionary plus LLM fallback).
- Materials go to a class. Units are converted to inches and pounds.
- Price bands are computed per node on pooled prices.
- All values carry `value, confidence, evidence_span, source(spec|llm)`. Fields with confidence below 0.7 go to a review queue, and only the 6–8 fields that feed archetypes are reviewed.

#### 6.2.6 Operational notes
- About 2.9k Staples and about 8k in-scope Wayfair families × about 1.5k tokens is roughly 15–20M input tokens. Use the Batch API, prompt caching for the schema, and Haiku 4.5 for bulk.
- Prefer JSON-schema-enforced (tool-use) output.
- Cache raw LLM responses to disk so that re-runs cost nothing.

### 6.3 S4 Archetype construction: 4–6 attributes, three tiers, no price — gate C2
1. **Candidates.** The node's facet list per tier (Tier 1 material / colour tone / colour family / size; Tier 2 node functional attributes and bands; Tier 3 style / vibe / node theme) plus up to 4 **gap facets** (Sai, 2026-10-03): values of the multi-label tags (key benefits → Tier 2; use context, end-user segment, aesthetic tags → Tier 3) where the competitor credibly carries more (Pr ≥ 0.9, held by ≥ 10% of its families), the strongest by share difference, each turned into a yes / not-stated facet (e.g. "Water-resistant: yes"); an aesthetic-tag gap facet never appears with vibe. Facets are dropped if they failed validation (G2), are unknown for > 45% of either retailer (40% before 2026-10-03), or have one value covering > 85% of families. Values held by < 5% of the node's families are grouped as "other".
2. **Core of 4.** The 4-facet combination with ≥ 1 facet from each tier that puts the largest *balanced* share of both retailers' families into supported cells; score = balanced coverage + 0.25 × mean normalised entropy + 1.0 × mean JSD between the Staples and competitor value mixes (Sai, 2026-10-03: prefer attributes on which the two assortments differ, so archetypes line up with the attribute gaps the report shows). Colour tone and colour family never appear together, and the node's product-type attribute is required when usable. A cell is supported with ≥ 10 pooled families and either ≥ max(5, 0.5% of the competitor's families) competitor families or ≥ max(8, 4% of Staples' families) Staples families. A tier with no usable facet is relaxed (shown in the report); if fewer than 4 facets pass every check, the best near-misses are admitted and flagged.
3. **Refinement to 5 and 6.** The next facet splits a cell only if ≥ 2 children are supported and the rest of the cell is supported (kept as "<facet>: other") or empty; refinement stops before a node exceeds 40 archetypes. There is no back-off below 4 attributes: families in no supported cell form the node's **long tail** (reported, never recommended). **Small-node pass:** a node that ends S7 with fewer than 3 recommendations that passed a method gate is re-run once through S4–S7 with a pooled bar of 5 families instead of 10 (`archetypes.small_node`; list in `data/interim/relaxed_nodes.json`; the node header says so).
4. **Price band is not an attribute.** Price is read in PPG (inside TG), PPR (Method 1 labels) and the node's price view (§6.7.2).
5. **Naming.** A short merchant name from the node's `name_order` plus the full attribute combo; every output shows **Archetype (Attributes combo)**.
6. **Gate C2 (valid archetype).** An archetype can be recommended only if it has ≥ 4 attributes, no "other (mixed)" value and ≥ 5 competitor families.
7. **Cross-check.** UMAP (10 dims) + HDBSCAN on the source-neutral card; ARI / AMI vs the archetypes and 20-bootstrap stability (G6).

**Note on "all attributes combined":** the full attribute vector still enters through the embedding in Method 1 and the per-attribute distribution gaps in Method 2; the archetype attributes only decide how archetypes are named and counted.

### 6.4 Embedding space (shared by S2, S4 and Method 1)
- **Canonical card** (identical template on both sides; no price; no raw spec dump):
  `"{node} | {form_factor} | {title_clean} | colour: {colour_family}/{colour_tone} | material: {material_class} | style: {style_family} | features: {key T2 values} | vibe: {aesthetic_tags} | use: {use_context} | {≤60-word LLM summary}"`
- **Views:**
  - (i) a text embedding of the card;
  - (ii) an attribute vector (one-hot Tier 1 and Tier 2 categoricals plus robust-scaled dimensions);
  - (iii) later, an image embedding.

  Fused = `[α·t, β·a]`, L2-normalised. α and β are tuned on the mapping gold set.
- **Encoder:** pluggable, with a bake-off harness reused from CL PoC V2. Candidates are `bge-large-en-v1.5`, `gte-large`, `e5-large-v2` and an API embedding model. The selection metric is mapping top-1 plus duplicate-pair recall. All thresholds are re-fitted when the encoder changes.
- **Source-mixing diagnostic:** on the known cross-retailer identical pairs (S1), the partner must be in the top-3 neighbours at least 80% of the time. If it is not, the card still carries source style and needs fixing.
- **Vector store:** local Qdrant (reused from CL PoC), with one collection per retailer and node/attribute payload filters. At about 11k vectors this is a convenience, not a requirement; numpy or FAISS would be equivalent.

### 6.5 S5 METHOD 1: Vector space (VW, AAS, CRS, AD, PPR → VOS)
All components are computed per Wayfair family *c* in analysis node *n*, then aggregated to archetypes. They combine into Method 1's final score, **VOS** (§6.5.6).

#### 6.5.1 Vector Whitespace (VW): how empty Staples' region is
- Pool the Staples and Wayfair families of node *n*. Give Staples points a weight `w_S = N_W / N_S`, so that when the two distributions are identical the expected Staples share of any neighbourhood is 0.5.
- For each Wayfair family *c*, the local Staples coverage is `LSC(c) = Σ_{j∈kNN(c)} w_j·1[j∈S] / Σ_{j∈kNN(c)} w_j`, with k = 15 (sensitivity at 10 and 25).
- Whitespace: `ws(c) = clip(1 − 2·LSC(c), 0, 1)`. A value of 1 means no Staples item is nearby. A value of 0 means Staples is at least as dense as Wayfair here.
- **Archetype level:** `VW(a) = mean_{c∈a} ws(c)`, reported with a bootstrap CI. It is a classifier two-sample test in disguise, so it is interpretable and independent of the attribute grid.

#### 6.5.2 Adjacency Affinity Score (AAS): does it belong on Staples?
Within an existing node, adjacency is partly given. AAS now measures **fit with Staples' customer and catalog**:
- `A_sem(c)` = mean cosine of the top-50 Staples families across the **whole L2** (for example all of Chairs & Seating). Mean-pooling asks whether the candidate sits in Staples' region.
- `A_ctx(c)` = weighted Jaccard between c's `use_context ∪ end_user_segment` and the node's Staples tag distribution. A kids' nursery rocker scores low in *Accent & Waiting Room*, and a reception lounge chair scores high.
- `AAS = 100 × (0.6·pct_L2(A_sem) + 0.4·A_ctx)`.
- Dropped: the PageRank complement term (no co-view data) and the separate JTBD term (folded into A_ctx).
- **As built:** A_sem uses the *functional* card; the Staples reference distribution excludes Staples families with an **identical** functional card (colour twins and repeated profiles would set the bar at "an exact copy"); A_ctx is measured against the use contexts Staples serves **across all its nodes in the data** (fit with Staples' customer is store-wide). Thresholds T_A_low / T_A_high = 10th / 35th percentile of Staples' own AAS per L2.

#### 6.5.3 Cannibalization Risk Score (CRS): would it take a Staples sale? (price-agnostic)
- `S_max(c)` = mean cosine to the **top-3** Staples families **in the same analysis node**, on a *functional* embedding view (a card built from Tier 2 plus form_factor, with no colour, style or aesthetic tags). Max-pooling asks whether one specific Staples product is replaced.
- `FI(c)` = functional identity: the share of node-specific Tier 2 core attributes that equal those of the nearest Staples family (continuous 0–1, not the doc's binary `ff`).
- `CRS = 100 × (0.6·cal(S_max) + 0.4·FI)`, where `cal()` maps cosine to a probability of substitution via the calibration of §6.6, not a raw percentile.
- **Excluded by design:** price (carried by PPR) and aesthetics (carried by AD below). This is what makes STYLE-EXTENSION and TRADE-UP reachable.

#### 6.5.4 Aesthetic Delta (AD): is it visibly different?
- `AD(c) = 1 − cos_aesthetic(c, nearest Staples family)`, on an aesthetic view (colour family, tone, material_class, style_family, aesthetic tags, DFI).
- Report also `ΔDFI = DFI(c) − DFI(nearest Staples)`.

#### 6.5.5 Price Position Ratio (PPR): which direction is the price?
- `PPR(c) = price(c) / median price(top-3 Staples neighbours on the functional view)`.
- Initial bands, fitted per L2 in calibration: **≥ 1.5 trade-up · 0.85–1.5 parity · < 0.85 undercut**.
- PPR is **not** part of any score. It is a direction, not a magnitude, and it acts only through the decision labels (§6.6).

#### 6.5.6 Vector Opportunity Score (VOS): Method 1's final score
One number per archetype that summarises the vector method: *is there empty space here, does it fit Staples, is it visibly different, and is it safe?*
```
VOS(a) = 100 × [ 0.45·pct(VW(a)) + 0.30·AAS(a)/100 + 0.25·pct(AD(a)) ] × (1 − CRS(a)/100)^γ
```
- VW is the opportunity signal, AAS the brand fit and AD the visible difference (median over members). CRS dampens the result multiplicatively: open space that substitutes a Staples item is not an opportunity. γ = 1 by default, with sensitivity at 0.5 and 2.
- `pct()` = percentile rank across archetypes in the same L2 peer group, the same population TG uses, so the two scores are on comparable 0–100 scales.
- Weights ship with the same Dirichlet sensitivity as TG (§6.7.6).

### 6.6 Decision tree (exhaustive, ordered; applied per candidate family)
```
0. mapped to NONE / thin node                       → BACKLOG (not scored)
0b. flagged ALREADY_CARRIED (identical product)      → EXCLUDE
1. AAS < T_A_low                                      → OFF-BRAND            (reject)
2. CRS ≥ T_C_high  (functionally substitutes a Staples item)
     2a. PPR < 0.85                                   → UNDERCUT             (hard reject)
     2b. PPR ≥ 1.5 and (ΔDFI ≥ δ_D or material upgrade) → TRADE-UP          (approve, margin note)
     2c. AD ≥ T_AD (new colour/material/style)         → STYLE-EXTENSION     (approve; the "flavours" case)
     2d. otherwise                                     → SUBSTITUTE          (reject)
3. T_C_low ≤ CRS < T_C_high
     3a. AD ≥ T_AD AND AAS ≥ T_A_high                  → LEAN-APPROVE         (counts as safe; flagged for Pat)
     3b. otherwise                                      → REVIEW               (Pat calibration queue; undecided)
4. CRS < T_C_low
     4a. AAS ≥ T_A_high                               → CURATE               (approve; true whitespace)
     4b. T_A_low ≤ AAS < T_A_high                      → EDGE / VERTICAL EXT. (hold for phase 2)
```
Each branch is exclusive and every case gets exactly one label. The "(DATA ERROR)" case (low AAS with high CRS) is caught by rule 1 first. It is still counted as a diagnostic, and a count above 2% triggers a review of the mapping and embeddings.

**Threshold setting (two steps):**
1. **Weak supervision (before Pat).** Build positive and negative pairs from Staples alone:
   - *positives* = different colourways of the same Staples family, and near-identical cross-brand listings (manual 50);
   - *negatives* = Staples families from different analysis nodes, and same-node families with different form_factor.

   Fit a logistic `cal(S_max)`. Set the first cut of `T_C_high` and `T_C_low` at P(substitute) = 0.7 and 0.3. Set the AAS thresholds from the distribution of Staples' own families, whose AAS against the rest of Staples marks "on-brand" (for example the 10th percentile of Staples' own AAS gives `T_A_low`).
2. **Pat calibration session** (from the doc, kept; still open). Use 60 side-by-side pairs, stratified across the CRS range with extra pairs in the REVIEW band, 20 of them stratified by PPR. Hide the scores. Ask "would this take sales from that?" and "would you rather carry it at this price?". Refit `cal()`, the PPR bands and T_AD, then show Pat the resulting label distribution.

**Hygiene rules (kept from the doc):** no raw cosine in any deliverable; all thresholds are re-fitted when the encoder changes; PPR bands are set per L2.

**Archetype roll-up (Method 1 gate, §7):** per archetype, `n_safe` = CURATE + STYLE-EXTENSION + TRADE-UP + LEAN-APPROVE products; safe share = safe ÷ decided (non-REVIEW) products; reject share = (SUBSTITUTE + UNDERCUT) ÷ all products. Archetype CRS, AAS, AD and PPR are member medians; VW is the member mean.

### 6.7 S6 METHOD 2: Attribute-level gap metrics
All metrics are computed per node, both per archetype and per attribute value, on **family shares**.

#### 6.7.1 Share gap (replaces Depth Gap and Coverage Ratio)
- For archetype *a* in node *n*: `p_W(a) = n_W(a)/N_W(n)` and `p_S(a) = n_S(a)/N_S(n)`.
- Beta posteriors with a Jeffreys prior: `p_X ~ Beta(n_X + 0.5, N_X − n_X + 0.5)`.
- **Log Share Ratio** `LSR(a) = log(E[p_W] / E[p_S])`. This stays finite when Staples has 0.
- **Credibility:** `Pr(p_W > p_S)` by Monte Carlo. The gap is *credible* when it is ≥ 0.9.
- **Coverage flags:** `ABSENT` when `n_S = 0` and `n_W ≥ 5`; `THIN` when `p_S < 0.25·p_W`.

#### 6.7.2 Price Position Gap (PPG)
- `PPG_mag(a) = W1(log price_W, log price_S)` within the archetype (0 if either side has fewer than 3 families; then the archetype-level band gap below is used). Direction: `PPG_dir = sign(median_W − median_S)`.
- **Node-level price-band coverage:** per price band *b* (node quartiles, rounded), the share gap `p_W(b) − p_S(b)` with credibility. This is where "Staples has no $120–250 accent chairs" shows up.
- **Price view (Phase 2):** price is kept out of the archetype definitions and read per node: price-band coverage plus a **price ladder** (each archetype's median price on both sides, the ratio, and premium ≥ 1.5× / parity / cheaper < 0.85×).

#### 6.7.3 Attribute Distribution Gap (ADG): colour gap generalised
For each categorical attribute *k* (colour_family, colour_tone, material_class, style_family, aesthetic_tags, use_context, size_class, and Tier 2 features):
- `ADG_k(n) = JSD(P_W^k ‖ P_S^k)`, on smoothed shares. This answers how different the node's mix is on this attribute.
- **Value-level signed gap** `δ_{k,v} = p_W(v) − p_S(v)`, with Beta credibility. These are the attribute-level insights (for example "boucle 11% vs 0%", "white/cream 24% vs 6%").
- The **Colour Gap** of the original formula becomes `CG(a)` = JSD on colour_tone within the archetype. Colourway breadth is reported separately (next).

#### 6.7.4 Colourway breadth (the "flavours" of existing items)
- Staples: `n_colourways` per family (from S1).
- Wayfair: observed colours per family, which is a lower bound until the option list is crawled.
- Metric: for colour families present at Wayfair but absent from Staples in the same archetype, list the missing colour families. This feeds STYLE-EXTENSION recommendations directly.

#### 6.7.5 Design-Forward Gap (DFG)
- `DFG(a) = median DFI_W(a) − median DFI_S(a)`, plus the node-level **design-forward share gap** (share of DFI ≥ 0.6).
- The headline chart: DFI densities for Staples and Wayfair per node.

#### 6.7.6 Total Gap (TG): archetype-level composite
```
TG(a) = 0.35·pct(LSR) + 0.20·pct(PPG_mag) + 0.15·pct(CG) + 0.15·pct(MSG) + 0.15·pct(DFG)
```
- `MSG` = mean JSD over material_class and style_family within the archetype (this was missing from the original formula).
- `pct()` = percentile rank across **all archetypes in the same L2 peer group** (for example all Chairs & Seating archetypes), so nodes are comparable.
- Only credible LSR (Pr ≥ 0.9) contributes fully. Non-credible LSR is shrunk by ×0.5.
- **Sensitivity:** draw 1,000 weight vectors from Dirichlet(α = 20·w). Report each archetype's probability of staying in the node top-5 and Kendall τ against the base ranking. Also report the user's original 4-term weighting (0.35/0.25/0.20/0.20) side by side for comparison.

#### 6.7.7 Attribute Cannibalisation Risk (ACR): Method 2's own cannibalisation check
TG measures gaps only; on its own it cannot tell "Staples lacks this" from "the competitor sells cheaper copies of a Staples product". ACR gives Method 2 its own check, from **attributes and price only** (no Method 1 score):
- **Attribute twin:** a Staples family anywhere in the node with the same value on every known, validated functional (Tier-2) attribute, with ≥ 2 attributes compared. Searched node-wide, because cannibalisation is about function and price, not look (archetypes also carry look attributes).
- **Product label:** price ÷ the twins' median price < 0.85 → **ATTR-UNDERCUT**; < 1.5 with the same colour tone → **ATTR-SUBSTITUTE**; ≥ 1.5 → ATTR-TRADE-UP; otherwise ATTR-STYLE-EXT; no twin → NO-TWIN.
- **ACR(a)** = (ATTR-UNDERCUT + ATTR-SUBSTITUTE) ÷ competitor products in the archetype. It gates (§7); it is not part of TG.
- Limitation: coarser than CRS (it sees only the extracted attributes), so it leans conservative where few attributes validate.

**Attribute-level Total Gap:** for attribute value *v* of attribute *k* in node *n*, `TG_attr(k,v) = pct(δ_{k,v}) × credibility`. This ranks "which values to add" independently of archetypes and answers the attribute-level question directly.

---

## 7. Safety gates: common → per method → final (S2–S8)

The two methods keep their own final scores, **VOS** (Method 1, §6.5.6) and **TG** (Method 2, §6.7.6), and they are never blended into one formula. Up to the archetypes the pipeline is common. From there the two methods are treated as two models: each has **its own safety gate on its own scores**, including its own cannibalisation check, so one method's metric never filters the other's recommendations. A final gate combines them (Sai, 2026-10-01; evidence in §14.6). All thresholds are under `gates` in `config/pipeline.yaml`.

| Gate | Stage | Applies to | Rule |
|---|---|---|---|
| **C1 Node scope** | S2 | products | page maps to a focus node AND predicted node = page node AND affinity ≥ τ (§5.4) |
| **C2 Valid archetype** | S4 | archetypes | ≥ 4 attributes AND no "other (mixed)" value AND ≥ 5 competitor families |
| **M1-a Product labels** | S5 | products | decision tree §6.6 on CRS / PPR / AAS / AD (incl. LEAN-APPROVE); safe = CURATE, STYLE-EXTENSION, TRADE-UP, LEAN-APPROVE |
| **M1-b Method 1 gate** | S5 | archetypes | ≥ 2 safe products AND safe share ≥ 10% of decided (non-REVIEW) products AND (SUBSTITUTE + UNDERCUT) < 70% of all products |
| **M1-c Method 1 list** | S5 | archetypes | top 10 per node by VOS among those passing M1-b |
| **M2-a Product labels** | S6 | products | attribute twin + price → ATTR-UNDERCUT / ATTR-SUBSTITUTE / ATTR-TRADE-UP / ATTR-STYLE-EXT / NO-TWIN (§6.7.7) |
| **M2-b Method 2 gate** | S6 | archetypes | (LSR credibility ≥ 0.9 OR absent at Staples) AND ACR < 50% AND ≥ 2 non-cannibalising products |
| **M2-c Method 2 list** | S6 | archetypes | top 10 per node by TG among those passing M2-b |
| **F1 Union & tier** | S7 | archetypes | union of the two lists; **Strong** = on both, **Vector-led** = Method 1 only, **Gap-led** = Method 2 only; ordered Strong first, then by the fused rank `Final = 0.5·pctrank(VOS) + 0.5·pctrank(TG)` among valid archetypes in the node |
| **F2 Per-node size** | S7 | archetypes | 3 to 10 per node; below 3, a labelled **Conditional** fill: best remaining valid archetypes holding a product safe under either method (most safe products, then Final) |
| **F3 SKU picks** | S8 | products | only products safe under the method(s) that recommended the archetype: Method 1 safe labels for Vector-led; not ATTR-UNDERCUT / ATTR-SUBSTITUTE (and not EXCLUDE) for Gap-led; both for Strong (falling back to either when fewer than 3) |

**Reading the tiers.** Strong = both methods see an opportunity and both cannibalisation checks pass: the most robust. Vector-led = whitespace in the vector view that passes Method 1's checks (e.g. a style extension Method 2 sees as a cheaper twin). Gap-led = a credible attribute gap with few cheaper or same-look Staples twins; Method 2 has no fit-with-Staples check, so read these as "check fit". Conditional = only to reach the per-node minimum.

**Also reported.** Spearman ρ between VOS and TG per node (method agreement); reciprocal-rank fusion as a robustness check; Dirichlet weight sensitivity of both scores (top-5 retention, G7). Every non-recommended archetype carries its reason from each method's gate.

**Demand.** D stays off until review counts or rank position exist (and those columns are deliberately not used, §2.5). If added later, it enters as a third ranking in the final ordering, not inside either method's score or gate.

**Headline chart per node:** TG (x) vs VOS (y), one point per archetype, coloured by tier; hollow = not recommended.

## 8. S8 SKU stage: exemplars and sellers

### 8.1 Exemplar selection (up to 3 per recommended archetype)
- Candidates are the archetype's products that are safe under the method(s) that recommended it (gate F3, §7).
- Rank by `0.5·(1 − CRS/100) + 0.3·centroid proximity + 0.2·DFI` and pick with MMR diversity (λ = 0.7), so the exemplars are not near-identical. Each card says which method it is safe under.
- **Style extensions:** per node, the 5 STYLE-EXTENSION products with the largest AD, independent of the recommendations.

### 8.2 Evidence card per exemplar
Title, price, URL, display brand, key attributes, DFI, label, and **the nearest Staples family side by side** (title, price, URL) with CRS, PPR and AD. This is the same format as Pat's calibration pairs, so the recommendations read the way Pat already judged them.

### 8.3 Brand and seller information (replaces brand fragmentation)
- `brand_on_staples`: the Wayfair display brand already sells on Staples.com (for example Flash Furniture, Boss). This is a **quick-win recruit**, because the supplier relationship already exists.
- `wayfair_house_brand`: flag from a maintained list (Latitude Run, Ebern Designs, Inbox Zero, George Oliver, Red Barrel Studio, 17 Stories, Wrought Studio, Mercer41, Corrigan Studio, Hokku Designs, Wade Logan, Orren Ellis, Trule, Winston Porter, Mercury Row, Zipcode Design, Andover Mills, Etta Avenue, …). The manufacturer is not observable, so the recruit path is **source the archetype, not the SKU**.
- **Brand fragmentation** (HHI of display brands in the archetype) is reported descriptively and caveated.

---

## 9. S9 Insights and outputs

### 9.1 Deliverables (current phase)
1. **Python code**: the pipeline stages S0–S9, config-driven (§1.4).
2. **PNG figures**: one set per analysis node plus the overview figures, in `outputs/figures/`.
3. **One self-contained static HTML report**: `outputs/report/Staples_Assortment_Report_v<N>.html`; every build writes the next version and earlier versions are never overwritten or deleted.

No Excel workbook or deck for now. Intermediate tables (CSV or parquet) are pipeline artefacts for debugging and re-runs, not deliverables.

### 9.2 HTML report: format
- **A single file, fully static and shareable.** It works offline and opened from email or a shared drive, with no server, no CDN and no external fonts or libraries. Figures are the same PNGs embedded as base64. Tables are plain HTML. A small inline vanilla-JS script handles tabs, the node dropdown and table sorting. Target size under 25 MB; if it grows past that, PNG resolution is reduced.
- The page is generated from the pipeline outputs by a template (Jinja2), so a re-run on new data rebuilds it with no manual editing.
- Must work in light and dark mode and at laptop and phone widths. Must print cleanly (each node section prints on its own).

**Wording (Sai, Phase 2).** "Node", never "shelf". Archetypes are labelled **Archetype (Attributes Combination)**, each shown as its name followed by its attribute combination. Every metric abbreviation carries its full name, e.g. "TG (Total Gap)", "ACR (Attribute Cannibalisation Risk)". No person's name appears in the report.

**Tab 1: Approach & Methodology.**
- The business question; the **12 focus nodes** (segment · play, Staples path, Primary 1 competitor, status).
- A flow chart of S0 → S8 (one box per stage: purpose, steps, outputs, gate, tech); the report itself (S9) is not shown as a method step.
- Archetypes (Attributes Combinations): the three tiers, each with examples; the two methods side by side (VOS and TG components, ACR); Method 1 and Method 2 label tables; "from two scores to one list" (the gates of §7).
- **Safety gates** first (grouped Common / Method 1 / Method 2 / Final with this run's counts), then **Quality gates** (§10) as a scorecard; encoder bake-off and calibration.
- Assumptions and caveats (columns used, convenience samples, full-text length differences, provisional vocabularies).

**Tab 2: Gaps & Recommendations.** A single-select dropdown groups the focus nodes by L1, ordered by path inside each L1 (Staples-only nodes marked). Choosing a node shows, in this order (Sai, 2026-10-01):

| Section | Content |
|---|---|
| **Node header** | Path; segment · play; competitor; family counts; mapping confidence and products set aside; archetype (attributes combination) definition; number of archetypes and long-tail share |
| **Key insights** | Plain-English findings grouped: where the competitor is deeper, where Staples is deeper, price (median prices, credible price-band gaps, premium and cheaper archetypes), design, recommendations by tier, Method 1 and Method 2 cannibalisation counts |
| **Coverage** | One 2 × 2 grid: price-band coverage, DFI density, attribute divergence (JSD), largest credible attribute-value gaps |
| **Attribute level gaps (detailed)** | Collapsed by default. Credible value-level gaps with a Tier column, ordered Tier 1 → Tier 2 → Tier 3, then by each attribute's largest gap |
| **Final recommendations** | Method agreement (Spearman ρ) with a one-line reading; table of Rank, Archetype (Attributes Combination), Tier, Final score, VOS, TG, Staples / competitor families; TG-vs-VOS chart |
| **SKU recommendations** | Evidence cards per recommended archetype (competitor product beside its nearest Staples product: price, link, label, CRS, PPR, AD, Method 2 label, safe-under basis), then style extensions |
| **Vendor / seller view** | Display brands of the products shown: already on Staples (quick win), competitor house brand (source the archetype), independent seller |
| **Excluded archetypes** | Collapsed. Every non-recommended archetype with its reason from each method's gate |
| **Method 1 results** | Collapsed. VOS components chart, decision scatter, and per archetype VW, AAS, AD, CRS, PPR, safe products, safe share, substitute + undercut, M1 gate and reason |
| **Method 2 results** | Collapsed. TG components chart, and per archetype shares, LSR and credibility, PPG, CG, MSG, DFG, ACR, non-cannibalising products, M2 gate and reason |

No provisional or tier-relaxation badges are shown in the node header (both stay recorded in the QA files). The separate price section (price ladder) was dropped from the report; its findings appear in Key insights and the price ladder stays in `outputs/tables/final_archetypes.csv` (median prices per side).

Staples-only nodes show a Staples profile (price bands and top attribute values) until competitor data arrives. The Phase-1 "shelf filter" (capping the dropdown) was removed in Phase 2.

### 9.3 Figures (PNG, per node unless noted)
Price-band coverage · DFI density · attribute divergence (JSD) · largest credible attribute-value gaps · decision scatter (AAS vs CRS) · TG vs VOS by tier · Method 1 label mix · VOS components · TG components · extractor accuracy per field · overview: families per node.

## 10. Quality gates G1–G8 (a scorecard; they never cut recommendations)

Quality gates check how far each step can be trusted. In the PoC they are computed on every run and reported in Tab 1 with PASS / FAIL / PENDING; a failure is reported plainly, not worked around. They **do not** remove products or recommendations (that is the job of the safety gates, §7), with one side effect: fields failing G2 are kept out of the gap scores and archetype attributes.

| Gate | Metric | Target |
|---|---|---|
| G1 Mapping | top-1 accuracy on the 200-family gold set; NONE precision | ≥ 90% / ≥ 85% |
| G2 Extraction (T1/T2) | per-field accuracy against Staples specs (text-only extractor) | ≥ 85% per field used in gaps |
| G3 Extraction (T3, DFI) | κ between raters; LLM vs humans | κ ≥ 0.6; ≥ 0.8 × human agreement |
| G4 Families and dedup | manual audit of 100 merges and 100 cross-retailer pairs | precision ≥ 95% |
| G5 Embedding | source-mixing: identical pair in the top-3 | ≥ 80% |
| G6 Archetypes | ARI grid vs HDBSCAN; bootstrap stability; nameability | ≥ 0.4 / ≥ 0.6 / 5 of 5 |
| G7 Scores | TG and VOS top-5 stability under Dirichlet weights; PPR and CRS calibration AUC | ≥ 70% / AUC ≥ 0.8 |
| G8 Sanity | DATA-ERROR share; spot-check of 20 recommendations by a merchant-literate reviewer | ≤ 2% / ≥ 16 of 20 judged sensible |

**As computed in the PoC (proxies until the human gold sets exist):** G1 = Staples leave-one-out node accuracy ≥ 90% AND NONE balanced accuracy ≥ 85%; G2 = per node and field, accuracy-when-found ≥ 85% on length-matched Staples text; G5 = retailer predictability (5-fold AUC) from the neutral card ≤ 0.80; G6 = median ARI ≥ 0.4 AND median bootstrap stability ≥ 0.6; G7 = TG and VOS top-5 retention ≥ 70% AND minimum CRS calibration AUC ≥ 0.8; G8 = share of products with AAS < T_A_low and CRS ≥ 70 ≤ 2%. G3 and G4 are PENDING (human labels).

---

## 11. Assumptions, open questions and data requests

**Assumptions** (reviewed by Sai on 2026-09-27)
1. ✅ *Confirmed.* Every item on Staples.com counts as "1P / existing assortment" for cannibalization, including third-party brands Staples retails. We have no marketplace flag.
2. ⚠️ *Revised.* The competitor sample is a **convenience sample**: every product page that scraped successfully, with failures dropped. It is not designed to be representative, and the failures may not be random (for example, some page templates failing more often). Consequences:
   - All claims are **share-based and within-sample**. No absolute-depth claims.
   - Every node reports its sample size, and every gap its credibility, so a thin sample shows up as "not credible" rather than as a false gap.
   - Where the scraper logs it, scrape success rate per listing page is kept as a data-quality column.
   - Samples will grow. The pipeline is re-run end to end on the new data, and nothing is tuned to today's counts.
3. ✅ *Confirmed.* Wayfair consumer and Professional pages are pooled as one competitor. `scope` is kept as a column so they can be split if needed.
4. ✅ *Confirmed.* Price is the list price at crawl time. Promotions are ignored.

**Open questions: status**
1. *Answered.* The Wayfair sample is a random or convenience set for now. The goal is to get the framework, code, outputs and recommendations working first, then correct from the top as data is enriched. No rank position or page totals, so the demand term stays off.
2. **Open (keep).** Can Ayan re-crawl for: Wayfair review count and rating, option or colour lists, primary image URL; the Staples review count (currently empty); and Staples Big & Tall, Hutches and Table Lamps, which are under-covered?
3. *Answered.* Chairs & Seating and Desks for now, but scope must adapt to whatever categories are shared later. See §1.3–1.4.
4. *Answered.* Run HuggingFace encoders locally. Checked 2026-09-27: huggingface.co is reachable (HTTP 200). `torch` and `sentence-transformers` are not installed yet and there is no GPU (12 CPU cores). CPU is enough at this scale: about 15k short cards with a base-size model takes minutes. The large models are tried in the bake-off only if run time allows. The Claude API is assumed available for extraction and adjudication.
5. **Open.** Is Pat's calibration session realistic in the timeline? If not, the weakly supervised thresholds (§6.6) become final, with a caveat.

**Data requests, by priority** (all optional: the pipeline runs without them)
- **P1:** Wayfair review count and rating, and image URL (both sides).
- **P2:** Wayfair option lists; Staples review counts; listing rank position; "customers also viewed" (which would enable A_ctx through a graph); scrape success rate per page.

---

## 12. Build plan (after sign-off)

| Phase | Deliverable | Gate |
|---|---|---|
| P0 | Ingest, clean, family grouping, dedup, analysis nodes; **coverage report** (which nodes are in scope for the data supplied) | G4 |
| P1 | Page crosswalk, product-level mapping, gold set | G1 |
| P2 | Schema induction and freeze; extraction; extractor validation; DFI | G2, G3 |
| P3 | Embedding bake-off, canonical cards, vector store | G5 |
| P4 | Archetypes for the vertical slice (*Accent & Waiting Room Chairs* and *Office Chairs*) | G6 |
| P5 | Method 1 and Method 2 on the slice; decision tree; weak calibration | G7 |
| P6 | Integration, insights, SKU cards, figures and the **HTML report** for the slice → **review with Sai** | G8 |
| P7 | Roll out to every in-scope node the coverage report finds (today: the rest of Chairs & Seating, then Desks); Pat calibration; final HTML report | all |

Each phase runs on the vertical slice before any bulk LLM spend. The bulk extraction run happens only after the P2 prompts pass validation on the slice.

**Status (2026-10-03):** P0–P7 are built and run for all 12 Phase-2 focus nodes (report v13; all 12 scored). Open: Pat's calibration session (CRS bands, PPR thresholds, AAS thresholds, the gate parameters), human gold sets (G1, G3, G4), the Claude extraction / adjudication backend (needs an API key), and a small-node rule for archetype support (§14.7).

**Re-run on new data:** when enriched or new-category samples arrive, the same pipeline runs from S0. New L2s get their generated artefacts (§1.4) drafted automatically and flagged *provisional* until reviewed. Existing reviewed artefacts are reused.

---

## 13. Implementation notes (Phase 1 build, 2026-09-28; Phase-1 stage numbers S0–S11)

These decisions were made while building the pipeline. Each one either tightens a rule above or fills a gap that only showed up in the data. The code in `src/alpoc/` follows them.

| # | Where | Decision | Why (evidence from the run) |
|---|---|---|---|
| 1 | S5 | Extraction backend is **local rules + embedding zero-shot**. The Claude backend is not wired yet | No API key was available. All Tier-3 and DFI outputs are provisional (G3 pending) |
| 2 | S3 | The **NONE threshold is calibrated across sources**: Youden-J between known in-scope products (single-candidate pages) and known out-of-scope products (pages with no Staples shelf) | Calibrating on Staples-vs-Staples similarity rejected 5,006 in-scope Wayfair products, because the two sources' text is systematically less similar |
| 3 | S2 | Pseudo-L5 split keys exclude **component facets** (Arm, Base, Back, Seat…) | The first run split Office Chairs on "Arm Type". It now splits on "Chair Type" |
| 4 | S6–S7, DFI | All vector math (VW, AAS, CRS, AD, archetype validation, DFI) runs on a **source-neutral card** built only from *text-instrument* extracted fields. There is no free title text, and the Staples spec values are not used in cards | Title-bearing cards let a classifier tell the retailer apart with AUC 0.97, and the median Wayfair product fell at the 10th percentile of Staples' affinity. Spec-filled Staples cards added a missingness signature. Specs remain the truth for physical facts in Method 2 |
| 5 | S7 | **AAS semantic affinity uses the functional view** (type, features, size), not the full card | On the full card, the aesthetic difference that is the White Chair opportunity was scored as "off-brand". The look is rewarded through AD only |
| 6 | S7 | **Functional peers** = every Staples family within 0.02 of the best functional match (up to 15). PPR uses their median price; AD is taken against the best-looking peer (conservative) | Neutral cards create many ties, and an arbitrary top-3 made PPR and AD unstable |
| 7 | S5 | Features that text can only confirm (swivel, lumbar, headrest…) are measured as **"mentioned: yes/no" on both sides** | Mixing a spec "no" with text-only "yes" would create false gaps |
| 8 | S5 | Colour is read from the **last** title segment first | Titles put the colour variant last ("…, Walnut Trim, Black") |
| 9 | QA | **G1** = Staples leave-one-out leaf accuracy plus NONE balanced accuracy (proxy until the human gold set exists). **G5** = retailer predictability from the card (lower is better), reported against the title-bearing card | No human gold set, and too few same-brand pairs (2) for the original G5 |
| 10 | S11 | **Report shelf filter**: Chairs & Seating is capped at 5 shelves and Desks at 3 (R1 data and R2 recommendations are gates; R3 confidence, R4 agreement and R5 Strong backing are counted) | 23 shelves made the report long (11.5 MB) and would crowd out new categories. Filtering drops the size to 5 MB, and no scoring changes (§9.2) |

**What the first full run shows (for review, not for sign-off):**
- G1 **fails** on the NONE decision. Out-of-scope products such as patio chairs and bean bags are semantically close to seating, so similarity alone rejects only about 29% of them. The page crosswalk catches whole pages; mixed pages need LLM adjudication.
- G6 **fails**. The embedding clusters split on product sub-form (barrel, wingback, club), which the grid does not use. Candidate facet for the next iteration: `form_factor` with finer accent-chair values.
- G8 **fails**. The DATA-ERROR share is about 12%. These products sit close to a few Staples items but far from the wider Staples catalogue or its use contexts. They are to be reviewed in Pat's calibration.
- Recommendations skew to **premium price bands**, because cheaper look-alikes are labelled UNDERCUT (PPR < 0.85). This protects 1P as intended, but the band is the first thing Pat's calibration should test.

---

## 14. Phase 2 changes (2026-10-01)

**Scope.** Phase 2 narrows the PoC to 12 focus nodes (exact Staples L3/L4 paths, Sai's selection), each compared with its **Primary 1** competitor: Amazon (planners, desk organizers, backpacks, water bottles, lunch bags, desk pads, coffee organizers) and Wayfair (office desks, accent chairs, desk lamps, clocks, partitions). Water bottles were planned against Scheels; Sai moved them to Amazon on 2026-10-03 when the Amazon file gained those pages. The node list, segment · play and competitor order live in `config/nodes.yaml`. A node whose competitor has no data runs as a **Staples-only profile** until data arrives, with no code change. Where this section conflicts with §4–§9, §14 wins.

**Columns.** The Phase-1 columns are read: id, title, price, url, brand/vendor, selected choice, description, listing page (and the L1–L6 path of that page, used only to identify it, because many page names are facet labels such as "Type: Folding"). Since 2026-10-03 the Wayfair `specifications` column is also read as text (§14.8). Ratings, review counts, ranks, badges, list prices and images are not used.

### 14.1 Stage simplification (S0–S9)

| Phase 2 | Phase 1 | Change |
|---|---|---|
| S0 Ingest | S0 | Generic competitor adapter (Amazon added); prices must carry a `$` ("2 sizes" is not a price); vendor noise ("Learn more", size codes) blanked; Amazon links rebuilt as `/dp/<ASIN>`; Staples rating no longer parsed |
| S1 Families & nodes | S1 + S2 | **Same grouping rule for every retailer** (brand + name stem), because Amazon and Wayfair now list colour/size variants as separate ids too. Competitor variants also need the same description start (house-brand titles are generic). A title prefix counts as a brand only if it is a known brand. **Node = exact Staples leaf**: the pseudo-L5 split is dropped (the focus list already names the granular node) |
| S2 Mapping | S3 + S2 finalize | Each page now points to at most one node, so the multi-leaf classifier is replaced by: longest-prefix **page-path crosswalk** → node or [] (pages whose products Staples shelves under a *sibling* leaf, e.g. calendars, briefcases, standing desks, desktop dividers) → **product-level scope check**: k-NN over all Staples nodes, mapped only if the predicted node is the page's node and the product is close enough. The NONE cut is Youden's J but never rejects more than 5% of known in-scope products (the page crosswalk already removes whole out-of-scope pages) |
| S3 Attributes | S4–S5 | Per-node vocabularies (`config/nodes/*.yaml`) incl. material overrides, Tier-3 node attributes (design theme, pattern, audience…), numeric fields and bands. **Full text** on both sides since 2026-10-03 (§14.8; text parity before). `spec_role: indicator` marks Tier-2 fields whose Staples spec vocabulary differs from product copy (measured by text on both sides, spec for validation only). Derived single-valued `vibe` facet = first aesthetic tag in priority order, else "plain" |
| S4 Archetypes | S6 | Redesigned, §14.2 |
| S5 / S6 / S7 / S8 | S7 / S8 / S9 / S10 | Same formulas. Per-node competitor, cards and functional core. S6 adds the price view (§14.3) |
| S9 Report | S11 | Node filter removed (all 12 nodes listed); §14.4 |

### 14.2 Archetypes: 4–6 attributes, three tiers, no price (Sai)
- **Every archetype is defined by 4 to 6 attribute values.** Candidates per node are listed by tier in the node config: Tier 1 universal look/physical (material, colour tone/family, size), Tier 2 functional (type, features, size bands), Tier 3 lifestyle (style, vibe, theme/pattern/audience).
- **Core (4):** the combination with ≥ 1 attribute from each tier that puts the largest *balanced* share of both retailers' families into supported cells (support: ≥ 10 pooled families and ≥ 5 competitor or ≥ 8 Staples families); ties go to higher mean entropy. If no combination meets the tier mix, the constraint is relaxed tier by tier and the relaxation is shown.
- **Refinement (5th, 6th):** a cell is split by the next attribute only if ≥ 2 children are supported and the rest of the cell is supported (kept as "<attribute>: other") or empty. There is no back-off below 4 attributes: families in no supported 4-attribute cell form the node's **long tail** (reported, not scored).
- **Price band is not an attribute**, so archetypes do not collapse into price tiers. Price stays in PPG (inside TG), in PPR (labels) and in the separate price view.
- **Naming:** a short merchant name from the node's `name_order` plus the full attribute combo; every output shows "Archetype (Attributes combo)".

### 14.3 Price view (separate from archetypes)
Per node: price-band coverage (node quartiles, rounded) with credibility, and a **price ladder**: each archetype's median price on both sides, the ratio, and a reading (premium ≥ 1.5×, cheaper < 0.85×, parity).

### 14.4 Report
"Node" replaces "shelf" everywhere. Every metric abbreviation is shown with its full name, e.g. "TG (Total Gap)". Tab 2 order: header → key insights → coverage → attribute-level gaps → price insights → final recommendations → SKU recommendations and style extensions → sellers → excluded → Method 1 and Method 2 detail (bottom). Tab 1 lists the 12 nodes with segment · play and data status, without naming retailers.

### 14.5 Build decisions (Phase 2 run, 2026-10-01)
Each fixes a problem the first Phase-2 run exposed; none is tuned to a target number. All are config switches in `config/pipeline.yaml`.

| # | Where | Decision | Why (evidence) |
|---|---|---|---|
| 1 | S1 | An inferred title-prefix brand is kept only if it is a known brand (a Staples brand or a vendor the retailer shows); single colour/material/generic words are never brands | 83% of Amazon products have no brand; title prefixes were "Coffee Pod", "2 Pack", "Black" and created false "sells on Staples" flags |
| 2 | S2 | NONE threshold floored at 95% in-scope recall | The Youden cut would reject 8–9% more in-scope products; out-of-scope products are "hard negatives" (wall calendars vs planners) already removed by the page crosswalk |
| 3 | S3 | Desk and chair material read by priority (surface / upholstery first) | Text named the metal frame or wood arms first; Staples specs name the top / upholstery |
| 4 | S3 | Desk type, chair form, planner / lunch / clock / coffee / divider type are `spec_role: indicator` | Staples' type vocabulary ("Workstations", "Table", "Guest") differs from product copy; measured by text on both sides |
| 5 | S4 | Facet guards: colour tone and colour family never together; the product-type facet is required; facets with one value > 85% are dropped; values < 5% grouped as "other"; support scales per side (competitor ≥ 0.5% of its families, Staples ≥ 4%); ≤ 40 archetypes per node from refinement | The unguarded search picked near-constant facets ("USB port: not stated", "vibe: plain") and duplicate colour facets, and a fixed support of 10 gave 122 desk archetypes |
| 6 | S4 | If fewer than 4 facets pass every check, the best near-misses are admitted (skewed first, then partly unknown, then below the G2 bar) and flagged; a tier with no usable facet is relaxed and shown | Keeps Sai's 4-attribute minimum; several nodes have no usable Tier-1 facet because colour/material fail G2 on short Amazon text |
| 7 | S7 | Archetypes containing a grouped "other (mixed)" value are scored and shown but never recommended | Not nameable |
| 8 | S5 | AAS reference excludes Staples families with an identical functional card | Repeated Staples profiles (colour twins, identical planner specs) set the bar at "an exact copy"; 37% of competitor products were OFF-BRAND |
| 9 | S5 | A_ctx uses the use contexts Staples serves across all its nodes in the data | Fit with Staples' *customer* is store-wide; node-only context labelled 68% of Wayfair accent chairs (the White-Chair products) off-brand; 18% after |
| 10 | S5/S7 | *(Superseded by §14.6.)* Safe Share is taken over decided products (REVIEW excluded) and needs ≥ 40% decided; the substitute + undercut cap stays over all products | REVIEW is "awaiting Pat's calibration"; counting it as unsafe blocked nodes whose products sit in the middle CRS band |
| 11 | Display | For yes/no features "no" is shown as "not stated" | They are "mentioned in the text" measures |

**What the Phase-2 run shows (for review):** competitor ranges in desks, partitions, lunch bags, planners and backpacks are dominated by functional substitutes, cheaper look-alikes (UNDERCUT, e.g. Wayfair folding screens at ~0.25× Staples' price) or off-profile products (Amazon journals and travel/hiking packs), so few archetypes pass the shared gate there. Recommendations concentrate in clocks, desk lamps, accent chairs and coffee organizers. Pat's calibration of the CRS bands and PPR thresholds is the lever most likely to change this.

### 14.6 Two-method safety gates (Sai, 2026-10-01; replaced the earlier shared gate and §14.5 #10; now the body's §7)
Up to the archetypes the pipeline is common; from there the two methods are treated as two models, each with its own safety gate on its own scores, and one final gate combines them. Quality gates (G1–G8, §10) remain a scorecard: they never remove recommendations.

| Gate | Stage | Rule (config `gates`) |
|---|---|---|
| **C1 Node scope** | S2 | page on a focus node AND predicted node = page node AND affinity ≥ τ (unchanged) |
| **C2 Valid archetype** | S4 | ≥ 4 attributes AND no "other (mixed)" value AND ≥ 5 competitor families |
| **M1-a Product labels** | S5 | decision tree of §6.6 on CRS / PPR / AAS / AD, plus **LEAN-APPROVE** (§6.6 rule 3, now implemented): 30 ≤ CRS < 70 AND AD ≥ 0.5 AND AAS ≥ T_high counts as safe |
| **M1-b Archetype gate** | S5 | ≥ 2 safe products AND safe share ≥ 10% of decided (non-REVIEW) products AND substitute + undercut < 70% |
| **M1-c Method 1 list** | S5 | top 10 per node by VOS |
| **M2-a Product labels** | S6 | **attribute twin** = a Staples family anywhere in the node with the same values on every known, validated functional attribute (≥ 2 compared). Price ÷ twins' median < 0.85 → ATTR-UNDERCUT; < 1.5 with the same colour tone → ATTR-SUBSTITUTE; ≥ 1.5 → ATTR-TRADE-UP; otherwise ATTR-STYLE-EXT; no twin → NO-TWIN. Attributes and price only, no Method 1 scores |
| **M2-b Archetype gate** | S6 | (LSR credibility ≥ 0.9 OR absent at Staples) AND **ACR (Attribute Cannibalisation Risk)** < 50% AND ≥ 2 non-cannibalising products; ACR = (ATTR-UNDERCUT + ATTR-SUBSTITUTE) ÷ competitor products in the archetype |
| **M2-c Method 2 list** | S6 | top 10 per node by TG |
| **F1 Union & tier** | S7 | union of the two lists; Strong = both, Vector-led = Method 1 only, Gap-led = Method 2 only; ordered Strong first, then by the fused rank 0.5·rank(VOS) + 0.5·rank(TG) |
| **F2 Per-node size** | S7 | 3–10 per node; below 3, a labelled **Conditional** fill (best remaining valid archetypes with a product safe under either method) |
| **F3 SKU picks** | S8 | only products safe under the method(s) that recommended the archetype: Method 1 labels for Vector-led, not an attribute undercut/substitute for Gap-led, both for Strong (falling back to either) |

Why: a single gate built from Method 1's product labels let Method 1's weaknesses (e.g. its fit score on Amazon planners and travel packs) suppress real Method 2 gaps, and the methods could not be tuned separately. ACR mirrors Method 1's CRS + PPR logic from Method 2's own inputs, so each method carries its own 1P protection.

Twins are searched across the whole node because cannibalisation is about function and price, not look (an archetype also carries look attributes). ACR is coarser than CRS: it sees only the extracted attributes, so it leans conservative where few attributes validate. Gap-led recommendations have no fit-with-Staples check, so they read as "credible attribute gap, check fit"; Strong recommendations (both methods) are the most robust. Iterations behind the thresholds (what-if simulations, 2026-10-01): the shared gate gave 8 recommendations in 4 of 9 nodes; threshold loosening alone could not lift backpacks, lunch bags, partitions, planners or coffee organizers above 0, because almost no individual product there is Method-1-safe.

**Result of the Phase-2 run with §14.6 (report v8):** C1 keeps 16,035 of 24,326 competitor products; C2 213 of 298 archetypes valid. Method 1: 3,601 products safe (22%), 90 archetypes pass, 60 listed. Method 2: 5,786 attribute undercuts and 1,165 attribute substitutes, 4,074 products with no Staples twin; 72 archetypes pass, 58 listed. Final: **75 recommendations (20 Strong, 26 Vector-led, 29 Gap-led)**, 4–10 per scored node, no Conditional fill needed:

| Node | Strong | Vector-led | Gap-led | Total |
|---|---|---|---|---|
| Accent & Waiting Room Chairs | 3 | 4 | 3 | 10 |
| Clocks & Timers | 4 | 2 | 4 | 10 |
| Office Desks | 3 | 5 | 2 | 10 |
| Lunch Bags & Boxes | 4 | 0 | 6 | 10 |
| Backpacks | 0 | 0 | 10 | 10 |
| Desk Lamps | 3 | 5 | 1 | 9 |
| Coffee Organizers & Dispensers | 3 | 3 | 1 | 7 |
| Office Partitions & Dividers | 0 | 5 | 0 | 5 |
| Planners & Personal Organizers | 0 | 2 | 2 | 4 |

Reading: backpacks are all Gap-led (hiking, travel and sling packs Staples does not carry; Method 1 calls them off-profile); partitions are Vector-led only (Method 1 sees style extensions, Method 2 sees cheaper functional twins). Weight-sensitivity top-5 retention: TG 92%, VOS 93%.

### 14.7 Amazon data for the three pending nodes; all 12 nodes scored (Sai, 2026-10-03; report v13)
**Data.** The Amazon file was replaced by `Amazon product level dataset - 7 Chosen L3s - Final Samples.xlsx`, which adds pages for Water Bottles, Desk Organizers and Desk Pads. Water Bottles' competitor changed from Scheels to Amazon (`config/nodes.yaml`). Only the Phase-1 columns are read, as before. The new pages are small: about 650 new ASINs in total, against 13,954 before.

**Config changes (no code change):**

| File | Change |
|---|---|
| `config/retailers.yaml` | Amazon file name |
| `config/nodes.yaml` | Water Bottles competitors `[amazon]` |
| `config/crosswalk/amazon.yaml` | Sports Water Bottles, Thermoses, Flasks → Water Bottles, Tumblers & Travel Mugs; Desk Supplies Holders & Dispensers (pencil and paper-clip holders) and Desktop & Off-Surface Shelves → Desk Organizers; Desk Pads & Blotters → Desk Pads; Keyboard Drawers & Platforms → `[]` (Staples: Keyboard Trays leaf); Copyholders → `[]` (Staples: Book & Document Holders leaf). A leaf name with a comma must be quoted in the YAML list |
| `config/nodes/water_bottles_tumblers_travel_mugs.yaml` | Vessel type `soft flask` (collapsible / hydration / hip flasks) |
| `config/nodes/desk_organizers.yaml` | Organizer type `clip holder`; desk hutch, bookshelf and printer stand under `monitor stand/shelf` |

**Mapping (C1) on the new pages.** Kept (mapped) families per page:
- Pencil Holders 100 of 100.
- Paper Clip Holders 45 of 52.
- Desktop Shelves 40 of 64 (23 are monitor risers or printer stands that Staples shelves elsewhere).
- Desk Pads & Blotters 61 of 63.
- Sports Water Bottles 72 of 73.
- Thermoses 86 of 86.
- Flasks 47 of 54.

Node competitor families: Water Bottles 194, Desk Organizers 185, Desk Pads 61.

**Result (full re-run S0–S9).** C1 keeps 16,512 of 24,911 competitor families. C2: 217 of 305 archetypes valid. Method 1: 81 archetypes pass, 50 listed. Method 2: 70 archetypes pass, 58 listed. Final: **74 recommendations (22 Strong, 17 Vector-led, 32 Gap-led, 3 Conditional)** over 12 scored nodes:

| Node | Strong | Vector-led | Gap-led | Conditional | Total | v8 |
|---|---|---|---|---|---|---|
| Accent & Waiting Room Chairs | 5 | 2 | 3 | 0 | 10 | 10 |
| Backpacks | 0 | 0 | 10 | 0 | 10 | 10 |
| Clocks & Timers | 6 | 1 | 3 | 0 | 10 | 10 |
| Lunch Bags & Boxes | 2 | 0 | 8 | 0 | 10 | 10 |
| Office Desks | 4 | 4 | 2 | 0 | 10 | 10 |
| Coffee Organizers & Dispensers | 4 | 2 | 0 | 0 | 6 | 7 |
| Planners & Personal Organizers | 0 | 2 | 4 | 0 | 6 | 4 |
| Office Partitions & Dividers | 0 | 4 | 0 | 0 | 4 | 5 |
| Desk Lamps | 0 | 2 | 1 | 0 | 3 | 9 |
| Water Bottles, Tumblers & Travel Mugs | 1 | 0 | 0 | 2 | 3 | new |
| Desk Organizers | 0 | 0 | 1 | 1 | 2 | new |
| Desk Pads | 0 | 0 | 0 | 0 | 0 | new |

Weight-sensitivity top-5 retention: TG 95%, VOS 95%.

**Reading and caveats:**
- **The new nodes are small, so archetypes are sparse.** Desk Pads has 55 Staples + 61 Amazon families; only one 4-attribute cell reaches the 10-family pooled bar, and 81% of families sit in the long tail. Desk Organizers has 6 archetypes and an 80% long tail. The Conditional fill only uses valid archetypes, so the 3-per-node minimum cannot be met: Desk Organizers gets 2 and Desk Pads 0. The fixed `min_pooled: 10` was set for nodes with thousands of families. A support bar that scales with node size is the open fix; it needs Sai's approval.
- **Water Bottles: one Strong pick** (stainless steel water bottle: Amazon 25 families vs Staples 5, ACR 4%) plus two Conditional picks (16–24 oz and 25–40 oz stainless bottles, where Staples is already deep). Several archetypes share one display name because the attribute that separates them (insulation or vibe) is not in `name_order`.
- **Unchanged Wayfair nodes moved.** The NONE threshold τ is re-fitted on all retailers' products, so the new Amazon pages shifted τ and a few Wayfair families moved in or out of scope (mapped 9,899 → 9,935). For Desk Lamps this changed the competitor median description length, which drives text parity, and so the Staples parity text. USB-port accuracy went to 84.5% (G2 bar 85%), so USB port left the archetype facets. Colour tone replaced it, and recommendations fell from 9 to 3. This is a knife-edge effect of the G2 bar, not a change in the data. Fixing τ, parity length and the G2 field set per run (frozen calibration) would stop data changes in one retailer from moving another retailer's nodes; that is a candidate method change for Sai.

### 14.8 Full text, gap-aligned archetypes, small-node pass (Sai, 2026-10-03; report v15)
**Why.** On Desk Pads the attribute chart showed clear gaps (water-resistant 48% vs 0%, faux leather, luxe, corporate office), yet the node had no recommendation. Three causes:
- Text parity cut Staples text to ~120 characters, so most Staples pads lost their "water-resistant / spill-proof" wording.
- The archetype search picked attributes for coverage only, not for difference.
- The 10-family bar split the premium faux-leather pocket into cells of 7 and 6.

**Changes:**

| # | Change | Where |
|---|---|---|
| 1 | **Full text, no cut**, for every attribute on both sides: Staples title + paragraph + bullets + spec values; Amazon title + description; Wayfair name + choice + description + `specifications` (newly read). Spec values only; names only for "Yes"; negative values skipped. G2 on Staples prose without specs. Unlabelled sizes in titles ("31.5\" x 15.7\"", "36x17 in") are now read as width × depth | `s0_ingest`, `s1_families`, `s3_attributes`, `retailers.yaml`, `pipeline.yaml` → `extraction` |
| 2 | **Small-node pass**: nodes with < 3 gate-passing recommendations re-run S4–S7 with a 5-family bar | `run_pipeline.py`, `s4_archetypes`, `pipeline.yaml` → `archetypes.small_node` |
| 3 | Unknown-share limit for archetype facets 40% → **45%** | `pipeline.yaml` → `archetypes.max_unknown_share` |
| 4 | **Gap-aligned archetypes**: (a) score adds 1.0 × mean JSD of the facets; (b) up to 4 gap facets per node from credible competitor-deeper tag values | `s4_archetypes`, `pipeline.yaml` → `archetypes.divergence_weight`, `gap_facets` |

**Two corrections made during the run:**
- Spec names first leaked category words into the text ("Gaming: Non Gaming" made 96% of Staples desks "gaming"; "Accent & Waiting Room Chair Type" made every Staples chair "reception/lobby"). Specs now add values only.
- Gap facets first took both directions, and were dominated by Staples-deeper artefacts of Staples' longer text. They now take only competitor-deeper gaps, which is the point of the analysis.

**Result (S3–S9 re-run; report v15):**
- **Extraction:** G2 70 node-fields pass, 36 fail. Desk Lamps USB port passes again; Backpacks water-resistant fails.
- **Archetypes:** 325, of which 250 valid (C2); 279 use a gap facet.
- **Method 1:** 134 archetypes pass, 77 listed.
- **Method 2:** 96 archetypes pass, 80 listed.
- **Final:** **89 recommendations (30 Strong, 19 Vector-led, 38 Gap-led, 2 Conditional)**; 77 of the 89 include a gap facet.
- **Weight-sensitivity top-5 retention:** TG 91%, VOS 96%.

| Node | Strong | Vector-led | Gap-led | Conditional | Total | v13 |
|---|---|---|---|---|---|---|
| Accent & Waiting Room Chairs | 2 | 3 | 5 | 0 | 10 | 10 |
| Backpacks | 1 | 0 | 9 | 0 | 10 | 10 |
| Clocks & Timers | 5 | 2 | 3 | 0 | 10 | 10 |
| Desk Lamps | 7 | 1 | 2 | 0 | 10 | 3 |
| Lunch Bags & Boxes | 4 | 1 | 5 | 0 | 10 | 10 |
| Office Desks | 2 | 5 | 3 | 0 | 10 | 10 |
| Office Partitions & Dividers | 5 | 1 | 4 | 0 | 10 | 4 |
| Coffee Organizers & Dispensers | 2 | 3 | 2 | 0 | 7 | 6 |
| Planners & Personal Organizers | 0 | 1 | 3 | 0 | 4 | 6 |
| Desk Organizers | 1 | 1 | 0 | 1 | 3 | 2 |
| Water Bottles, Tumblers & Travel Mugs | 0 | 1 | 2 | 0 | 3 | 3 |
| Desk Pads | 1 | 0 | 0 | 1 | 2 | 0 |

**Gap facets in use (competitor vs Staples share):**
- Office Desks: luxe 35% vs 7%; home office 52% vs 19%; remote workers 51% vs 19%.
- Accent Chairs: residential living 38% vs 7%.
- Desk Lamps: residential living 42% vs 12%; luxe 24% vs 8%.
- Clocks: statement 39% vs 9%; sleek/minimal 33% vs 9%.
- Partitions: natural/woven 32% vs 2%; residential living 24% vs 0%; commercial-grade.
- Backpacks: men 33% vs 2%; women 36% vs 9%; outdoor 25% vs 3%.
- Lunch Bags: women 23% vs 4%; travel/commute 31% vs 15%.
- Desk Pads: water-resistant 48% vs 15%; corporate office.
- Desk Organizers: education 46% vs 22%.
- Water Bottles: water-resistant; gym/sports.

**Reading and caveats:**
- **Desk Pads.** The Strong pick is the premium faux-leather pocket: no anti-slip or "water-resistant" wording; Amazon 17 vs Staples 5; median $94 vs $157; 9 safe products. The Conditional pick is the cheap anti-slip "water-resistant" PU pad (Amazon $13.99 vs Staples $49.44, ACR 94%), shown only to reach the per-node minimum. The small-node pass cannot help further: the node's other cells have no Amazon products.
- **"Not stated" values in archetype names** come from the gap facets and from Amazon's short text. A combination such as "Water-resistant: not stated" means the product's text does not say so, not that the product lacks the feature.
- **Full text favours the retailer with more text.** Amazon's "not stated" share is higher for every feature, so competitor-deeper tag gaps are conservative, and Staples-deeper ones are partly a text effect. Gap facets therefore use competitor-deeper gaps only.
- **Selection on the gap.** Archetypes are now chosen partly because they differ (JSD term and gap facets). TG on these archetypes reads larger than on coverage-only archetypes; compare TG within a run, not across v13 and v15.
- **Planners fell from 6 to 4**: the archetype set changed, and fewer archetypes pass a gate.
