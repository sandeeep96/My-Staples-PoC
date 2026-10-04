# Staples Category-Level PoC — Methodology (V3)

> Status: as built and run for V3 (October 2026). It describes what the code in `Codes/code/` does after the V3 changes. Where V3 differs from V2, the change is marked **[V3]**. Every number quoted in the deliverables comes from the pipeline outputs in `Outputs_v3/final/` (`summary_v3.json`, `units_all.csv`, `opportunities.csv`, `Category_Recommendations_v3.xlsx`). The client report is `reports/Staples_Category_Recommendations_<version>.html` (section 10).

## 1. The question
Staples does not sell everything a workplace buys. Some categories are missing or thin on Staples.com but are sold by Office Depot and by the big marketplaces (Amazon, Walmart, Wayfair). The PoC asks:

1. **Where are the gaps?** Which categories do competitors carry that Staples does not carry (ENTER), or carries only thinly (DEEPEN)?
2. **Are they within Staples' brand reach?** Would a business, school, healthcare, hospitality or home-office buyer expect to find this at Staples? (Antique collectables would be a "no".)
3. **Are they easy to expand into, and do they help Staples compete with marketplaces?**
4. **Are they safe for 1P?** Would a marketplace there cannibalise Staples' own core assortment?

The answer is a short, ranked list of **category opportunities**. Each one comes with the competitors that carry it, the Staples aisle it would sit in, an action and an evidence grade.

**Brand reach definition [V3] — workplace-first.** A category is in reach when one of 12 workplace buyer missions plausibly includes it (descriptions are editable in `poc_common.WORK_MISSIONS`):
- Office & business supplies
- Office & home-office furniture
- Technology for work
- Breakroom & kitchen
- Janitorial & facilities
- Safety & security
- School & classroom
- Healthcare & clinics
- Hospitality & foodservice
- Retail store & shipping
- Workspace décor & comfort
- Commercial grounds & outdoor

They are scored against 5 residential / leisure missions (`RES_MISSIONS`): residential bedroom & bath, home living & seasonal décor, leisure, hobbies & sports, backyard & garden living, and personal, fashion & novelty. Residential lifestyle categories are downgraded, not banned. Brand-unsafe categories are excluded outright.

## 2. Data
| Retailer | Role | File / sheet used | Counts | Notes |
|---|---|---|---|---|
| Staples | focal | `1. Staples_Navigation_Tree_repaired.xlsx` · Navigation Tree, Cross-Listings, Summary by L1 **[V3]** | leaf pages only | 2,622 cross-listing placements. "In header nav?" is used for coreness **[V3]** |
| Office Depot | mirror (B2B peer) | `2. OfficeDepot_Navigation_Tree.xlsx` · Category Tree + Unmapped Nodes **[V3]** | cumulative | the 80 unmapped categories are placed via a reviewed file (bge-base proposed 3 aisles, an analyst picked one or dropped duplicates/hubs) **[V3]** |
| West Elm | lifestyle | `2. WestElm_Navigation_Tree.xlsx` · Category Tree | cumulative | named collections and facets removed |
| Wayfair | lifestyle + B2B (Professional scope) | `3. Wayfair_Navigation_Tree_v3.xlsx` · Navigation Tree (+ secondary placements as cross-list edges **[V3]**; Unique Categories = reference) | none | Professional (B2B) scope is used as B2B evidence **[V3]** |
| Amazon | scale marketplace | `3. Amazon_Navigation_Tree_v3.xlsx` · Navigation Tree (PoC-relevant L1 + Cell Phones) | none | max depth L3 |
| Walmart | scale marketplace (+ Walmart for Business) | `3. Walmart_Navigation_Tree_v2.xlsx` · Navigation Tree | L1–L2 only (900k+ = censored) | L5 folded into L4 **[V3]** |
| Target | — | not used (file marked "not using") | — | listed in the row reconciliation |

**Row reconciliation [V3].** Every row of every sheet gets exactly one status:
- *used* (a node in the analysis)
- *dropped* with a reason: universe, retailer scope, merchandising page, facet, aggregate, brand-safety
- *reference-only*: audit/log sheets, Retired categories, Gap Fill Log, Legacy & Unmatched, Target

Per sheet, the statuses add up to the raw row count. This is sheet `Row_Reconciliation`.

### 2.1 Scope and cleaning
- **One department universe for every retailer.** It excludes media, apparel, beauty, auto, baby consumables, toys, grocery, pets, instruments, collectibles, gift cards, services, and brand/character hubs. **[V3]** A narrow whitelist (`UNIVERSE_WHITELIST`) brings back breakroom food and drink (beverages, coffee, tea, snacks, candy, breakfast and cereal) and classroom toys (learning, STEM, kids' arts & crafts, puzzles).
- **Merchandising pages** (New, Sale, Deals, Shop by Brand, fan shops, named collections) are dropped together with their subtrees.
- **Facets** (by colour, size, style, room) are dropped.
- **Navigation headings** ("Shop By Category", "Featured") stay in the tree as structure but are never used as meaning.
- **Depth.** Staples is 4 levels deep. **[V3]** Competitor levels below L4 are *folded*, not dropped: they count towards their L4 parent's breadth and their labels are kept as aliases of that parent (shown in Node_Ensemble; not used for matching).
- **Text hygiene.** The suspected encoding damage turned out to be a console artefact, not a data problem; CSVs are written as UTF-8 (BOM).

## 3. Pipeline (S0–S8)
| Stage | What happens | Code |
|---|---|---|
| S0 Load & scope | Six adapters → one node table: scope, headings, L5 fold, counts harmonised by mode, row reconciliation | `poc_common.load_all` |
| S1 Represent | Label + decaying ancestor context (vectors); wording + thesaurus + structure (graph) | `method_v_vector.node_vectors`, `poc_common.Lexical` |
| S2a Method V (parallel) | Top-50 nearest Staples shelves (Qdrant / NumPy) → hybrid rerank 0.65·cosine + 0.35·wording; its own per-competitor calibration (τ_V, gap screen) → verdict, AAS_V, CRS_V per shelf | `method_v_vector.py` |
| S2b Method G (parallel) | Similarity flooding over the 6-retailer graph, PageRank adjacency; its own per-competitor calibration (τ_G) → verdict, AAS_G, CRS_G per shelf | `method_g_graph.py` |
| S3 Combine & verify | The two independent verdicts are combined (section 4, ensemble); AAS and CRS are averaged; labelled rows override both methods | `run_framework.build_node_table` |
| S4 Units | ENTER concepts (≥ 80% of leaves missing, L1–L3, clustered across competitors, peer search in every collection); DEEPEN aisles (≥ 2 competitors ≥ 2× deeper after size-factor normalisation) | `run_framework.enter_units / concept_table / deepen_units` |
| S5 Opportunities **[V3]** | Consensus units in actionable zones roll up into category opportunities: one per zone × Staples department they dock into (embedding clusters were tried and rejected because they mixed look-alikes such as Workbenches with Weight Benches); single-competitor units go to a watch list | `run_framework.cluster_opportunities` |
| S6 Score | AAS, CRS, BFS **[V3]**, Ease **[V3]**, PC_b2b / PC_mkt **[V3]**, GS → O | `poc_common.brand_fit / ease_score / opportunity` |
| S7 Decide | Zones with the brand gate, VERIFY, evidence grade, docking to a Staples aisle | `poc_common.label_row`, `run_framework.assign_families` |
| S8 Stress test | 500 runs (weights re-drawn, thresholds and brand gate ±5, CRS ±20%, penalty 0.5–2×) → `p_zone`, `p_top_n`; **[V3]** 200 gold-label bootstraps re-fit τ and re-test every gap verdict → `p_gap` | `poc_common.sensitivity / bootstrap_thresholds`, `run_framework.gap_stability` |

## 4. Matching
- **Encoder.** It is chosen by a bake-off on the labelled rows: top-1 shelf accuracy after the hybrid rerank. **[V3]** The candidates add `BAAI/bge-base-en-v1.5` (sentence-transformers), alongside bge-small, spaCy (if installed) and TF-IDF+SVD. `encoder="auto"` keeps the winner, and the thresholds re-calibrate automatically.
- **Path embedding.** v = w·e(label) + (1−w)·Σ δ^(k−1)·e(ancestor_k) / Σ δ^(k−1). Competitors use w = 0.40, δ = 0.35. Staples uses w = 0.70, δ = 0.50, because Staples' upper levels are noisy.
- **Graph (Method G).** It contains CHILD_OF edges, CROSS_LISTED_UNDER edges (Staples and **[V3]** Wayfair), and SAME_AS edges from confident matches. Similarity flooding uses λp = 0.40 and λc = 0.35 over 3 rounds. Adjacency is the Personalised PageRank lift from Staples shelves, blended 70/30 with sibling coverage.
- **Independence.** Methods V and G do not read each other's output: each loads the trees, matches and calibrates on its own, and they can run in parallel. They share the same cleaned trees and labelled rows. After combining, the framework reuses Method V's vector collections for concept merging, peer search and DEEPEN shelf assignment; Method G contributes its verdicts, its half of AAS/CRS and its docking votes.
- **Ensemble.** A gap needs **both** methods to find nothing close: both gap → hard gap; gap + likely → soft gap (feeds VERIFY); either method matched → carried or disputed, not a gap.
- **Validation [V3].** Top-1 and AUC are reported both in-sample and with **5-fold cross-validation** within each competitor. A 60-row blind re-label gives Cohen's κ for the gold set.
- **Verification loop.** Model-flagged gaps behind shortlisted recommendations are checked against the Staples tree. The verdicts are stored as labels (`gold_matches_v3.csv`) that override the models. They are excluded from threshold fitting, because those rows were selected by the model. **[V3]** Round 4 covers every V3 shortlisted opportunity.

## 5. Scores (all 0–100 unless stated)
| Score | Meaning | Construction |
|---|---|---|
| **AAS** adjacency | How embedded the category is in Staples' current assortment | Mean of V (density of the top-10 hybrid neighbours) and G (PPR lift + sibling coverage), each on one pooled quantile scale; 100 = as embedded as a typical carried shelf |
| **CRS** cannibalisation | 1P revenue at risk | max over nearby Staples shelves of coreness × closeness. Coreness = editable department weights (+0.1 for header-nav departments **[V3]**) scaled by the shelf's item-count rank within its level (x0.6 to x1.0). **[V3]** CRS is halved when the driver shelf is not about the same thing (mission-encoder similarity < 0.60); the stress test scales CRS ±20% |
| **BFS** brand fit **[V3]** | Fit with Staples' workplace-first brand | 0.6 × mission score + 0.4 × 100 × B2B-channel share. Mission score = similarity to the closest of the 12 workplace missions minus the closest of the 5 residential missions (bge-base), anchored 0 = panel 10th percentile, 100 = median Staples core shelf. A brand-safety hit in the unit's name or representative path → EXCLUDED |
| **EASE** **[V3]** | How easy it is to open to sellers | 50 + 50 × PC_mkt − 25 per complexity flag (bulky freight, install required, regulated, perishable); DEEPEN +15; clipped 0–100 |
| **PC_b2b / PC_mkt** **[V3]** | Peer consensus split by channel | PC_b2b = share of the 3 B2B channels (Office Depot, Wayfair Professional, Walmart for Business) carrying it; PC_mkt = share of Amazon / Walmart carrying it (DEEPEN: ≥ 2× deeper). The overall PC counts lifestyle retailers at 0.5 |
| **GS** gap size (0–1) | How big the missing assortment is | Percentile of the missing chunk within the carrier's L1–L3 catalogue (shelves; items where counted) |
| **O** opportunity (0–1) | The final score; ranks units within a zone and orders the report table | O = [0.20·PC_b2b + 0.15·PC_mkt + 0.15·GS + 0.15·AAS/100 + 0.20·BFS/100 + 0.15·EASE/100] × (1 − CRS/100)^γ, γ = 1 (`CONFIG["rank_weights"]`) |

## 6. Zones
Rules are applied in this order:

| Zone | Rule | Action |
|---|---|---|
| EXCLUDED **[V3]** | brand-safety list hit | Do not pursue |
| 1P-CORE GAP | CRS ≥ 60 | Fix in 1P merchandising; keep the marketplace out |
| REVIEW | 40 ≤ CRS < 60 | Merchant decision with sales and margin data |
| OFF-BRAND | CRS < 40 and (BFS < 35 **[V3]** or AAS < 40) | Pass: a real gap, but the wrong store |
| CURATE | CRS < 40, AAS ≥ 60, BFS ≥ 35 | Open to curated marketplace sellers now |
| VERTICAL EXTENSION | CRS < 40, 40 ≤ AAS < 60, BFS ≥ 35 | Phase 2, through a vertical Staples serves |
| VERIFY | ENTER, not yet confirmed (mostly soft gap or contradicted by peers) | Check first: probably a findability issue |

**[V3]** Residential-lifestyle units (mission fit below the residential anchors) drop one zone: CURATE → VERTICAL EXTENSION → OFF-BRAND.

**Evidence grade.** A = 3+ competitors and both methods agree. B = 2+ competitors, or the methods agree. C = neither.

**Docking [V3].** Each new-category unit docks into the allowed Staples L1 › L2 aisle that maximises mission similarity (bge-base) + 0.03 × votes. Votes come from the members' carried parent aisles, followed across Method G's and V's SAME_AS links, and from the 10 nearest Staples shelves. Gift Shop, Expanded Assortment and top-level Decor are never docks, and hub shelves listed under more than 15 parents never vote. DEEPEN units keep their own aisle unless it is in one of those catch-all departments. VERIFY units go where the Staples shelf was found.

**Category opportunities [V3].** Consensus units (2+ competitors, or DEEPEN) in CURATE, VERTICAL EXTENSION, REVIEW and 1P-CORE GAP are grouped by zone × the Staples department they dock into. That gives one action and one owning merchant per opportunity. Each opportunity is named by its aisles and led by its highest-O sub-category.

## 7. Assumptions and caveats
- Only navigation-tree data is used. There is no sales, margin, search or traffic data, so demand is a proxy (marketplace breadth, Walmart counts). The `external_signals.csv` hook is where real demand would plug in.
- Coreness is an editable judgement proxy and should be replaced with Staples category sales bands.
- Gold labels were produced by the analysis team with Claude. They should be reviewed by a Staples merchant.
- Trees are snapshots from September 2026. Amazon and Wayfair publish no counts, so they contribute breadth only.
- Category level only. Product and archetype gaps belong to the separate product-recommendation PoC.

## 8. V2 → V3 changes (summary)
These are the critique items A1–A8, B1–B11 and C in `plan.md`:
- every Excel row reconciled
- real L5 fold
- OD unmapped nodes, Wayfair cross-lists and B2B signals used
- breakroom-food whitelist
- brand-fit gate and safety exclusions
- channel-split peer consensus
- Ease score
- bge-base encoder with CV metrics
- category-opportunity roll-up
- docking and CRS fixes
- gold bootstrap and κ

## 9. Results of the V3 run (from `Outputs_v3/final/summary_v3.json`)
- **Row reconciliation:** 24 sheets and 47,586 data rows. 19,486 rows used, 24,258 dropped with a reason, 3,576 reference-only, 266 not used (Target). No sheet has a mismatch.
- **Encoder bake-off:** bge-base won (pooled hybrid top-1 about 67%, versus about 66% for bge-small and 59% for TF-IDF). With bge, vector-only matching beats the 0.65/0.35 hybrid rerank, which was tuned for spaCy. Re-tune it on fresh labels.
- **Cross-validation:** Office Depot top-1 is 79% in-sample and 77% with the encoder choice nested in CV. Held-out threshold accuracy is 48–68% by competitor; Walmart is the weakest.
- **Label agreement:** a blind second pass on 60 rows gives 87% agreement, Cohen's κ = 0.65. The original labels accept parent or neighbouring shelves more readily, so the gap list is conservative.
- **Verification round 4:** only 3 unlabelled member shelves remained behind recommended units. All 3 were confirmed gaps (ramekins, carports, clay & modelling).
- **Answer:** 43 category opportunities (11 CURATE, 10 VERTICAL EXTENSION, 12 REVIEW, 10 1P-CORE GAP), 18 VERIFY findability items, 42 units EXCLUDED by the safety screen. None of V2's brand-risk picks (Adult Novelty, Home Brewing, Makeup Vanities, Daybeds, Teen Dressers) is recommended any more.

## 10. The client report
`Codes/code/build_html.py` writes one self-contained HTML file, `reports/Staples_Category_Recommendations_<version>.html` (bump `REPORT_VERSION` for every published change; old versions are kept).

- **Approach & Methodology:**
  - The question and the brand-reach definition.
  - The six trees and the row reconciliation.
  - The flow, with Methods V and G in parallel.
  - The scores and the zone rule.
  - Framework charts: the AAS × CRS map, all units on it, and the brand gate.
  - Matching quality (in-sample vs CV, κ), stability, and caveats.
- **Gaps & Recommendations:**
  - KPI tiles.
  - The decision picture, collapsible: opportunities on AAS × CRS (labelled by lead sub-category), brand fit vs adjacency, and peer evidence.
  - Zone filter (default CURATE) and theme filter (default All).
  - The filtered sub-category table, sorted by O, highest first.
  - Opportunity deep dives, collapsed.
  - Findability (VERIFY), Pass and Watch list, all collapsed.
