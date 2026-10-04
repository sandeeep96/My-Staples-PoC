#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=====================================================================================
 STAPLES MARKETPLACE PoC  -  CATEGORY-LEVEL RECOMMENDATION  (v3, six retailers)
 poc_common.py : SHARED LIBRARY used by all three scripts
=====================================================================================

   method_v_vector.py   Method V - embeddings + Qdrant vector DB  -> node_scores_V.csv
   method_g_graph.py    Method G - category knowledge graph        -> node_scores_G.csv
   run_framework.py     Ensemble + Track C framework + every chart and table used in the
                        documents and the deck                     -> outputs/final/...

Everything a merchant might want to change lives at the top of this file:
   CONFIG            thresholds, weights, encoder, paths
   RETAILERS         one adapter per navigation tree (file, columns, counts, scope rules)
   CORE_*            1P "coreness" assumptions (replace with Staples sales bands later)

What changed in v3 (see plan.md / Methodology.md in the project root):
   * every Excel row is reconciled (used / dropped with a reason / reference-only)
   * Walmart / OD / West Elm L5 is genuinely folded into L4 (breadth + labels kept as aliases)
   * Office Depot "Unmapped Nodes" are attached to the tree; Wayfair secondary placements are
     cross-list edges (graph); B2B channels (OD, Wayfair Professional, Walmart for Business) flagged
   * workplace-first BRAND FIT (BFS), brand-safety exclusions, EASE score, channel-split peers
   * encoder bake-off includes BAAI/bge-base-en-v1.5; cross-validated accuracy is reported

What changed from v1 (Office Depot only) - see the Methodology document, section 3:
   * counts are OPTIONAL per retailer (full / partial / none) - breadth is measured for all
   * embeddings use whatever path a node has (self + decaying ancestors), not fixed L1/L2/L3
   * navigation headings ("Shop By Category", "Featured") are skipped as context
   * department scope is one explicit, auditable universe applied to every retailer
   * calibration is per competitor (Office Depot gold + labelled samples for the others)

Install (Colab or local, Python 3.9+):
   pip install pandas numpy scipy scikit-learn openpyxl matplotlib networkx qdrant-client spacy
   python -m spacy download en_core_web_lg          # default encoder (offline once downloaded)
   pip install sentence-transformers                # optional: encoder="st" (needs HuggingFace)
   pip install wordllama                            # optional: encoder="wordllama" (bundled weights)
"""
import glob
import json
import math
import os
import re
import sys
import warnings
from collections import defaultdict

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
pd.set_option("display.width", 220)
pd.set_option("display.max_columns", 40)

HERE = os.path.dirname(os.path.abspath(__file__))

# %% ------------------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------------------
CONFIG = {
    # --- paths (Colab: upload the six .xlsx files + gold_matches_v2.csv to /content) ------
    # V3 project layout: <project>/Excels (inputs) and <project>/Outputs_v3 (outputs); env vars override
    "data_dir": os.environ.get("POC_DATA_DIR", os.path.join(HERE, "..", "..", "Excels")),
    "out_dir": os.environ.get("POC_OUT_DIR", os.path.join(HERE, "..", "..", "Outputs_v3")),
    "gold_file": "gold_matches_v3.csv",
    "seed": 42,
    # --- tree handling ------------------------------------------------------------------
    "max_depth": 4,                 # Staples is 4 deep; deeper competitor levels fold into L4
    "max_unit_depth": 3,            # recommendations at L1-L3 (category level)
    # --- encoder (Method V) -------------------------------------------------------------
    # "spacy" reproduces the documents. "auto" runs a bake-off of every encoder that loads and
    # keeps the one with the best top-1 shelf accuracy on the labelled set.
    "encoder": "auto",
    "encoder_candidates": ["st-base", "st", "spacy", "wordllama", "tfidf"],
    "spacy_model": "en_core_web_lg",
    "st_model": "BAAI/bge-small-en-v1.5",
    "st_base_model": "BAAI/bge-base-en-v1.5",
    "cv_folds": 5,
    # node vector = own label + ancestors (weight decays geometrically going up the path).
    # Asymmetric on purpose (context-weight grid, context_weight_grid.csv): competitor labels
    # are often generic ("Covers", "Bedroom") and need their context; Staples' upper levels
    # are noisy (patio furniture sits under Gift Shop > Professional Gifts > Compasses), so
    # Staples shelves lean on their own label.
    "w_self": 0.40, "ctx_decay": 0.35,              # competitor shelves
    "w_self_focal": 0.70, "ctx_decay_focal": 0.50,  # Staples shelves
    # --- retrieval + rerank (Method V) ----------------------------------------------------
    "k_retrieve": 50, "k_adjacency": 10,
    "w_sem": 0.65, "w_lex": 0.35,
    "multi_match_margin": 0.08,
    # --- graph (Method G) -------------------------------------------------------------------
    "lambda_parent": 0.40, "lambda_child": 0.35, "n_iter": 3,
    "ppr_alpha": 0.85, "aas_ppr_weight": 0.7, "xlist_weight_cap": 15,
    # --- calibration ------------------------------------------------------------------------
    "min_gold_rows": 40,
    "false_gap_cost": 1.0,
    "gap_screen_false_alarm": 0.10,
    # --- gap logic ----------------------------------------------------------------------------
    "enter_coverage_max": 0.20,     # < 20% of a node's leaves (items if counted) carried -> ENTER
    "deepen_min": math.log(2),      # competitor >= 2x Staples' relative depth/breadth -> DEEPEN
    "deepen_min_carriers": 2,       # ... shown by at least 2 competitors
    # --- Track C decision surface (0-100) --------------------------------------------------------
    "aas_hi": 60, "aas_lo": 40, "crs_hi": 60, "crs_lo": 40,
    # --- brand fit / ease (v3) -------------------------------------------------------------------
    "bfs_gate": 35,                 # BFS below this -> OFF-BRAND (unless CRS puts it in REVIEW / 1P-CORE GAP)
    "bfs_w_mission": 0.6, "bfs_w_b2b": 0.4,
    "lifestyle_weight": 0.5,        # West Elm / consumer Wayfair count half in the overall peer count
    "dock_exclude": r"^(Gift Shop|Expanded Assortment|Decor)( >|$)",   # never dock a recommendation here
    "dock_max_parents": 15,         # Staples shelves listed under more parents than this are hubs, not homes
    "crs_driver_min_sim": 0.60,     # unit vs CRS-driver shelf similarity (mission encoder) below this -> CRS halved
    "n_opportunities": 35,          # target number of category opportunities (sets the clustering threshold)
    # --- opportunity score -------------------------------------------------------------------------
    # B2B peers, marketplace peers, gap size, adjacency, brand fit, ease
    "rank_weights": {"pc_b2b": 0.20, "pc_mkt": 0.15, "gs": 0.15, "aas": 0.15, "bfs": 0.20, "ease": 0.15},
    "demand_weight": 0.25,          # used only if external_signals.csv is supplied
    "gamma": 1.0,                   # cannibalisation penalty exponent: O x (1 - CRS/100)^gamma
    "top_n": 20,
    "n_sensitivity": 500, "dirichlet_conc": 20, "threshold_jitter": 5.0,
    "coreness_jitter": 0.2,         # CRS scaled by U(0.8, 1.2) in the stress test (coreness is a judgement proxy)
    "n_bootstrap": 200,             # gold-label bootstrap: re-fit tau / gap screen, re-test every unit's gap
}

FOCAL = "Staples"

# ---------------------------------------------------------------------------------------
# DEPARTMENT UNIVERSE - one rule set for every retailer (auditable in 00_data_audit.xlsx).
# In: anything a workplace / home-office / breakroom / facilities / lifestyle-workspace
#     customer could plausibly buy from Staples.  Out: media, apparel, beauty, auto, baby
#     consumables, toys, grocery, pets, instruments, collectibles, gift cards, services,
#     brand / character / merchandising hubs.  (Pet was a HOLD in v1; it is out of the
#     universe for consistency with the team's Amazon scoping.)
# ---------------------------------------------------------------------------------------
UNIVERSE_EXCLUDE_L1 = (
    r"^(Books|Books & Magazines|Kindle|Audible|Magazine|Music|Digital Music|CDs|Movies|Amazon Instant Video|"
    r"Video Games|Apps & Games|Software$|Clothing|Jewelry|Beauty|Premium Beauty|Auto|Automotive|Vehicles|"
    r"Baby$|Toys|Food$|Grocery|Amazon Fresh|Pets?$|Pet Supplies|Musical Instruments|Collectibles|"
    r"Gift Cards|Services|Photo Center|Shop by (Brand|Movie|TV Show|Video Game)|Character Shop|Feature$|"
    r"Gifts & Registry|Amazon Devices|Handmade)"
)
# v3: breakroom food & drink and classroom / STEM toys are workplace missions Staples already serves
UNIVERSE_WHITELIST = (
    r"^(Food|Grocery & Gourmet Food)( > (Beverages|Coffee|Snacks.*|Candy|Breakfast & Cereal|"
    r"Beverages.*|Snack Foods|Coffee, Tea & Cocoa|Cookies|Candy & Chocolate))"
    r"|^(Toys|Toys & Games)( > (Learning Toys|STEM Toys|Learning & Education|Arts & Crafts for Kids|"
    r"Puzzles|Games & Puzzles))"
)
# merchandising / non-category pages anywhere in a path (drop the node and its subtree)
MERCH_NODE = (
    r"^(New|New Arrivals|Sale|Clearance|Deals|Best Sellers|Trending|Top Brands|Pierce & Ward.*|.*Inspiration|"
    r"Wood Swatches|Gift Guides?|Shop by Brand|Brands)$"
    r"|^New (?!Year)|^Sale |^Explore |Swatches|^In Stock|Build Your Own|in America$|by the Yard$"
    r"|Touch Up|Team Shop$|Fan Shop$|[Bb]y Brand"
)
# facets (colour, size, material, style, room) are filters, not categories
FACET_NODE = (
    r"(By|by) (Color|Colour|Fabric|Material|Style|Opacity|Wood Finish|Pattern|Room|Size|Shape|Price)"
    r"|Popular .*Sizes|Print & Pattern Shop|Shop By Color|^\d+'? ?x ?\d+'? "
)
# navigation headings: kept in the tree, skipped as semantic context, never a unit
HEADING_NODE = r"^(Shop By Category|Shop by Category|Shop By Type|Rugs By Type|More Rooms|Featured|Office Collections|" \
               r"Outdoor Collections|Shop All|Home Accessories|Categories|Departments|Shop by Department)$|^\(unnamed ID"
AGGREGATE_NODE = r"^(All|Shop All) "   # "All Office", "All Rugs" duplicate their parent
FOLDED = "deeper than L4 (folded into its L4 parent)"

# ---------------------------------------------------------------------------------------
# RETAILER ADAPTERS - add a competitor by adding one entry
#   count_mode : "terminal_only" leaf pages carry counts, parents do not (Staples)
#                "cumulative"    parent pages carry totals incl. children (OD, West Elm)
#                "partial"       cumulative, but only on some levels (Walmart L1-L2)
#                "none"          no usable counts (Wayfair, Amazon) - breadth only
#   role       : mirror (B2B peer) | lifestyle (design-led) | scale (everything store)
# ---------------------------------------------------------------------------------------
RETAILERS = [
    {"name": "Staples", "role": "focal",
     "file_glob": ["*Staples_Navigation_Tree*.xlsx"], "sheet": "Navigation Tree",
     "level_cols": ["L1", "L2", "L3", "L4", "L5"], "count_col": "Count", "count_mode": "terminal_only",
     "id_col": "Category ID", "url_col": "URL",
     "crosslist": {"sheet": "Cross-Listings", "header_row": 3, "name_col": "Category",
                   "parents_col": "All parents"},
     "header_nav": {"sheet": "Summary by L1", "header_row": 3, "name_col": "L1 (Super Category)",
                    "flag_col": "In header nav?"},
     "reference_sheets": {"Summary by L1": "used for 1P coreness (header-nav flag); other columns reference",
                          "Method & Notes": "reference (documentation)"},
     "scope_exclude": [r"^Gift Cards", r"^Tech Services", r"^Warranties", r"Furniture Assembly$",
                       r"^Expanded Assortment > (Books|Clothing)"]},
    {"name": "OfficeDepot", "role": "mirror",
     "file_glob": ["*OfficeDepot_Navigation_Tree*.xlsx", "*officedepot_tree*.csv"], "sheet": "Category Tree",
     "level_cols": ["L1", "L2", "L3", "L4", "L5"], "count_col": "Count", "count_mode": "cumulative",
     "id_col": "Node ID", "url_col": "URL", "b2b": "all",
     # categories whose page served no breadcrumb: attached to their nearest OD aisle (v3)
     "unmapped": {"sheet": "Unmapped Nodes", "name_col": "Category (derived from URL slug)", "count_col": "Count",
                  "id_col": "Node ID", "url_col": "URL"},
     "reference_sheets": {"L1 Summary": "reference (summary of the tree)", "Method & Notes": "reference (documentation)"},
     # services / programme pages / custom print: Staples runs these outside its tree
     "scope_exclude": [r"^Ink & Toner", r"^GreenerOffice", r"^Services", r"^Security Solutions",
                       r"^Print & Copy", r"Warranties & Services", r"Protection Plans$", r"^Pet Supplies"]},
    {"name": "WestElm", "role": "lifestyle",
     "file_glob": ["*WestElm_Navigation_Tree*.xlsx"], "sheet": "Category Tree",
     "level_cols": ["L1", "L2", "L3", "L4", "L5"], "count_col": "Count", "count_mode": "cumulative",
     "id_col": "Node ID", "url_col": "URL",
     "reference_sheets": {},
     # named product collections (Hughes, Marlowe, "Sofa Collections") are ranges, not categories
     "scope_exclude": [r"West Elm Business to Business", r"West Elm Office at Work", r"Explore West Elm",
                       r"Collections?( >|$)"]},
    {"name": "Wayfair", "role": "lifestyle",
     "file_glob": ["*Wayfair_Navigation_Tree*.xlsx"], "sheet": "Navigation Tree",
     "level_cols": ["L1", "L2", "L3", "L4"], "count_col": None, "count_mode": "none",
     "id_col": "Category ID", "url_col": "URL",
     "row_filter": lambda d: d["Primary placement"].astype(str).str.upper().eq("Y"),
     "row_filter_desc": "secondary placement of a category listed elsewhere (used as a cross-list edge)",
     "secondary_placements": True,   # rows with Primary placement = N -> CROSS_LISTED edges (Method G)
     "b2b": lambda path, raw: str(raw.get("Scope", "")).startswith("Professional"),
     "reference_sheets": {"Summary": "reference (summary of the tree)",
                          "Unique Categories": "reference (one row per category ID; checked against the primary placements)"},
     "scope_exclude": [r"^Pet"]},
    {"name": "Amazon", "role": "scale",
     "file_glob": ["*Amazon_Navigation_Tree*.xlsx"], "sheet": "Navigation Tree",
     "level_cols": ["L1", "L2", "L3"], "count_col": None, "count_mode": "none",
     "id_col": "Category ID", "url_col": None,
     # team's PoC-relevant flag, plus phone accessories (Staples sells them); v3: grocery and toys are
     # read so the breakroom / classroom whitelist can apply (the rest of them falls out of the universe)
     "row_filter": lambda d: d["PoC-relevant L1"].astype(str).eq("Yes") | d["L1"].isin(
         ["Cell Phones & Accessories", "Grocery & Gourmet Food", "Toys & Games"]),
     "row_filter_desc": "department outside the team's PoC-relevant Amazon L1 list",
     "reference_sheets": {"Coverage Before-After": "reference (gap-fill QA)", "Summary by L1": "reference (summary)",
                          "Gap Fill Log": "reference (audit log of rows already in Navigation Tree)",
                          "Legacy & Unmatched": "reference (audit of legacy nodes)", "Method & Notes": "reference (documentation)"},
     "scope_exclude": []},
    {"name": "Walmart", "role": "scale",
     "file_glob": ["*Walmart_Navigation_Tree*.xlsx"], "sheet": "Navigation Tree",
     "level_cols": ["L1", "L2", "L3", "L4", "L5"], "count_col": "Count", "count_mode": "partial",
     "count_cap": 900000,          # Walmart shows "900,000+" - treated as censored (unknown)
     "id_col": "Category ID", "url_col": "URL",
     "row_filter": lambda d: d["Node Type"].eq("Category") & ~d["Name Source"].astype(str).str.startswith("No name"),
     "row_filter_desc": "not a category page (node type) or no category name published",
     "b2b": lambda path, raw: path[0] == "Walmart for Business",
     "reference_sheets": {"Summary by L1": "reference (summary)", "vs Teammate File": "reference (comparison note)",
                          "Retired Categories": "reference (pages listed in the sitemap that no longer resolve)",
                          "Method & Notes": "reference (documentation)"},
     "scope_exclude": []},
]
ROLE_OF = {r["name"]: r["role"] for r in RETAILERS}
# files read for documentation only (row reconciliation lists them; nothing in them is analysed)
UNUSED_FILES = {"*Target_Navigation_Tree*.xlsx": "not used - the team marked the Target tree 'not using' (266 rows, L1-L2 only)"}
COMPETITORS = [r["name"] for r in RETAILERS if r["name"] != FOCAL]

# ---------------------------------------------------------------------------------------
# 1P CORENESS - proxy for "how much Staples 1P revenue sits on this shelf" (0..1).
# Editable assumptions; replace with Staples category sales / margin bands when available.
# ---------------------------------------------------------------------------------------
CORE_L1_WEIGHT = {
    "Paper": 1.0, "Office Supplies": 1.0, "Shipping, Packing & Mailing Supplies": 1.0,
    "Cleaning Supplies": 0.9, "Coffee, Water & Snacks": 0.9, "Printers & Scanners": 0.9,
    "Shredders, Projectors & Office Machines": 0.8, "Computers & Accessories": 0.8,
    "Facilities": 0.7, "Safety Supplies": 0.7, "School Supplies": 0.7, "Batteries & Power": 0.7,
    "Furniture": 0.6, "Hard Drives & Data Storage": 0.6, "Security, Banking & Cash": 0.6,
    "Networking & WiFi": 0.5, "Healthcare Supplies": 0.5, "Retail Store Supplies": 0.5,
    "Party Supplies": 0.4, "Phones, Cameras & Electronics": 0.4, "Tablets & iPads": 0.4,
    "Bags, Backpacks & Luggage": 0.6, "Computer Software": 0.5, "Audio": 0.4,
    "Restaurant & Foodservice Supplies": 0.5, "Laboratory & Scientific Supplies": 0.5,
    "Tools, Parts & Supplies": 0.5, "Appliances & Kitchenware": 0.5, "Workwear": 0.4,
    "Gift Shop": 0.3, "Arts & Crafts": 0.3, "TV & Streaming Media": 0.3, "Smart Home & Security": 0.3,
    "Gaming": 0.3, "Wearable Technology": 0.3, "Education": 0.5,
}
CORE_DEFAULT = 0.3
CORE_OVERRIDES = [  # (regex on Staples path, coreness) - last match wins
    (r"^Furniture > Chairs & Seating > (Office|Big and Tall|Stacking)", 1.0),
    (r"^Furniture > Desks > (Office Desks|Sit & Stand)", 0.9),
    (r"^Furniture > (File Cabinets|Chair Mats|Standing Desk Mats|Boards & Easels)", 0.9),
    (r"^Furniture > (Storage Furniture|Cubicle & Panel Systems|Carts & Stands|School Furniture)", 0.7),
    (r"^Furniture > Lamps & Lighting > Desk Lamps", 0.6),
    # the "white chair" zone: design / lifestyle shelves carry little 1P revenue
    (r"^Furniture > Decor", 0.15),
    (r"^Furniture > Lamps & Lighting > (?!Desk Lamps)", 0.2),
    (r"Accent|Sofa|Ottoman|Recliner|Loveseat|Bench|Coffee Tables", 0.2),
    (r"^Decor|^Fitness|^Expanded Assortment", 0.1),
]

# ---------------------------------------------------------------------------------------
# BRAND FIT (v3) - workplace-first. Each category is compared with buyer missions Staples serves and with
# residential / leisure missions it does not lead on. Descriptions are plain sentences so any sentence
# encoder can score them; editable.
# ---------------------------------------------------------------------------------------
WORK_MISSIONS = {
    "Office & business supplies": "office supplies for a business: paper, pens, binders, folders, filing, labels, desk accessories, printer ink",
    "Office & home-office furniture": "office and home office furniture: desks, office chairs, filing cabinets, bookcases, desk lamps, cubicles",
    "Technology for work": "computers, laptops, monitors, keyboards, office phones, networking, cables, chargers and batteries for work",
    "Breakroom & kitchen": "office breakroom supplies: coffee, tea, snacks, bottled water, cups, plates, microwaves, refrigerators, coffee makers",
    "Janitorial & facilities": "janitorial and facility maintenance: cleaning chemicals, trash cans, paper towels, restroom supplies, tools, heating, air conditioning, fans, lighting, electrical, plumbing repair",
    "Safety & security": "workplace safety and security: first aid, personal protective equipment, safety signs, fire safety, locks, security cameras, cash handling",
    "School & classroom": "school and classroom supplies for teachers and students: classroom furniture, art supplies, learning resources, educational and STEM toys",
    "Healthcare & clinics": "medical and healthcare supplies for clinics and care homes: exam gloves, medical instruments, mobility aids, health monitors",
    "Hospitality & foodservice": "restaurant, hotel and foodservice supplies: commercial kitchen equipment, tableware, dining tables and chairs, guest room amenities",
    "Retail store & shipping": "retail store fixtures and supplies, point of sale, shipping and packing supplies, mailers, displays and signage",
    "Workspace decor & comfort": "decor and comfort for offices, lobbies and waiting rooms: wall art, clocks, rugs, planters, lamps, reception seating",
    "Commercial grounds & outdoor": "grounds maintenance at business sites: landscaping equipment, lawn mowers, trimmers, snow removal, parking lot and outdoor signage, cafeteria patio seating",
}
RES_MISSIONS = {
    "Residential bedroom & bath": "residential bedroom and bathroom at home: beds, mattresses, bedding, comforters, kids and teen bedroom furniture, bath towels, shower curtains, makeup vanities",
    "Home living & seasonal decor": "home living room furnishings for a house: sofas, accent furniture, decorative throw pillows, curtains, home fragrance, holiday and seasonal decorations",
    "Leisure, hobbies & sports": "personal leisure, hobbies and sports: exercise equipment, camping, swimming, team sports, hunting, fishing, hobby crafts, games and toys",
    "Backyard & garden living": "residential backyard and garden living: grills, patio sets, gardening, plants and seeds, swimming pools, hot tubs, playsets, livestock",
    "Personal, fashion & novelty": "personal care, beauty, fashion accessories, jewelry, costumes, novelty and adult gifts",
}
# brand safety: never recommended, whatever the scores (regex on the category name and its path)
BRAND_SAFETY = (
    r"\b(adult (novelt\w*|toys?|games?|gifts?|entertainment)|sexual wellness|sex toys?|erotic\w*|lingerie|"
    r"firearms?|handguns?|rifles?|shotguns?|gun (safes?|cases?|cleaning|accessories)|ammunition|ammo|airsoft|"
    r"paintball|bb guns?|crossbows?|hunting|swords?|tobacco|vap(e|es|ing)|e-cig\w*|cigars?|hookahs?|cannabis|"
    r"cbd|marijuana|home brewing|wine making|beer making|liquor|alcoholic beverages?|livestock|poultry|"
    r"pharmacy|prescription|fireworks|pesticides?)\b"
)
# operational complexity for a marketplace launch (each hit lowers EASE)
COMPLEXITY = {
    "bulky freight": r"\b(sheds?|pergolas?|gazebos?|hot tubs?|spas?|trampolines?|playsets?|swing sets?|greenhouses?|carports?|"
                     r"pools?|boats?|kayaks?|mattress(es)?|bed frames?|sofas?|sectionals?|pianos?|treadmills?|riding mowers?|"
                     r"generators?|fenc(e|es|ing)|armoires?|wardrobes?|dressers?|daybeds?|bunk beds?)\b",
    "install required": r"\b(hvac|wall ovens?|ranges?|cooktops?|dishwashers?|flooring|tiles?|water heaters?|ceiling fans?|"
                        r"chandeliers?|garage doors?|windows?|doors?|countertops?|built-in|faucets?|toilets?|vanit(y|ies)|"
                        r"cabinetry|kitchen cabinets?|bathtubs?|showers?)\b",
    "regulated": r"\b(medications?|drugs?|rx|contact lens(es)?|hearing aids?|propane|fuel|batteries? acid|pesticides?|"
                 r"medical devices?|defibrillators?)\b",
    "perishable": r"\b(fresh|frozen|produce|meat|seafood|dairy|bakery|live plants?|flowers?|seeds?)\b",
}

GENERIC_NAMES = {"accessories", "other", "parts", "supplies", "storage", "more", "misc", "equipment",
                 "systems", "solutions", "kits", "refills", "tools", "products", "components",
                 "essentials", "basics", "appliances", "sets", "furniture", "decor", "hardware"}
STOP = {"and", "the", "of", "for", "with", "a", "an", "in", "to", "by", "all", "more", "other", "s", "shop"}
NOISE_WORDS = r"\b(shop( all| by)?|explore|west elm|pro\)|\(pro|professional)\b"

# Thesaurus (Method G): a small SKOS-style altLabel layer
THESAURUS = {
    "couch": "sofa", "sofas": "sofa", "loveseat": "sofa", "lamps": "lighting", "lamp": "lighting",
    "janitorial": "cleaning", "breakroom": "kitchen", "pantry": "grocery", "groceries": "grocery",
    "flatware": "cutlery", "dinnerware": "tableware", "serveware": "tableware", "carpet": "rug",
    "rugs": "rug", "bins": "container", "bin": "container", "containers": "container",
    "notepads": "pad", "notepad": "pad", "pads": "pad", "tissues": "tissue", "tv": "television",
    "pc": "computer", "laptop": "computer", "chromebooks": "laptop computer", "voip": "phone",
    "teleconferencing": "conference phone", "conferencing": "conference", "wellness": "health",
    "apparel": "clothing", "workwear": "clothing", "amenities": "personal care", "stationery": "paper",
    "drapes": "curtain", "curtains": "curtain", "sconces": "wall lighting", "chandeliers": "ceiling lighting",
    "pendants": "ceiling lighting", "barware": "drinkware", "throws": "blanket", "duvet": "bedding",
    "planters": "planter", "pots": "planter", "wearables": "wearable", "trackers": "tracker",
}

LABELS = ["CURATE", "VERTICAL EXTENSION", "REVIEW", "1P-CORE GAP", "OFF-BRAND", "VERIFY", "EXCLUDED"]
RECOMMEND = ["CURATE", "VERTICAL EXTENSION"]            # zones that are marketplace recommendations
# Zone colours: validated categorical steps (CVD-checked; OFF-BRAND is a deliberate neutral).
# Charts always add a second cue (shaded zones + direct labels, hollow VERIFY markers).
LABEL_COLOR = {"CURATE": "#008300", "VERTICAL EXTENSION": "#2a78d6", "REVIEW": "#eda100",
               "1P-CORE GAP": "#e34948", "OFF-BRAND": "#8c8c8c", "VERIFY": "#4a3aa7", "EXCLUDED": "#3d3d3a"}
ACTION = {
    "CURATE": "Open to marketplace sellers now (curated, design-led assortment)",
    "VERTICAL EXTENSION": "Phase 2 - enter through a vertical Staples already serves",
    "REVIEW": "Merchant decision - sits next to a 1P line",
    "1P-CORE GAP": "Fix in 1P merchandising - a marketplace here would cannibalise core",
    "OFF-BRAND": "Pass - real gap, wrong store for Staples",
    "VERIFY": "Check first - Staples may already carry it under another name (findability)",
    "EXCLUDED": "Do not pursue - fails the brand-safety screen (adult, weapons, tobacco, alcohol, Rx ...)",
}
RETAILER_COLOR = {"Staples": "#52514e", "OfficeDepot": "#2a78d6", "WestElm": "#eb6834", "Wayfair": "#1baf7a",
                  "Amazon": "#eda100", "Walmart": "#e87ba4"}
INK = {"primary": "#0b0b0b", "secondary": "#52514e", "muted": "#8a8984", "grid": "#e6e5e0", "surface": "#fcfcfb"}
STATUS_COLOR = {"carried": "#2a78d6", "likely": "#9dbfe9", "disputed": "#c9c8c3", "gap_soft": "#f0a3a2",
                "gap_hard": "#e34948"}

rng = np.random.default_rng(CONFIG["seed"])
RAW_ROWS = {}        # rows in each source file (filled by load_retailer; reported in the data audit)


def log(msg=""):
    print(msg, flush=True)


def out_path(*parts):
    p = os.path.join(CONFIG["out_dir"], *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# %% ------------------------------------------------------------------------------------
# FILES
# ---------------------------------------------------------------------------------------
def find_file(patterns, data_dir=None):
    """data_dir, one folder below it, the script folder and /content (Colab). Not recursive."""
    data_dir = data_dir or CONFIG["data_dir"]
    for root in [data_dir, os.path.join(data_dir, "*"), HERE, "/content"]:
        for pat in patterns:
            hits = sorted(glob.glob(os.path.join(root, pat)))
            if hits:
                return hits[0]
    return None


def read_table(path, sheet=None, header=0):
    if path.lower().endswith(".csv"):
        return pd.read_csv(path)
    return pd.read_excel(path, sheet_name=sheet, header=header)


# %% ------------------------------------------------------------------------------------
# TEXT
# ---------------------------------------------------------------------------------------
def tokens(s):
    s = str(s).lower().replace("™", "").replace("®", "").replace("’", "'")
    return [t for t in re.findall(r"[a-z0-9]+", s) if t not in STOP]


def stem(t):
    if len(t) > 4 and t.endswith("ies"):
        return t[:-3] + "y"
    if len(t) > 4 and re.search(r"(ses|xes|ches|shes)$", t):
        return t[:-2]
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    return t


def clean_name(name):
    """Strip navigation noise ('Shop', 'Explore', '(Pro)') from a label."""
    s = re.sub(NOISE_WORDS, " ", str(name), flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" -&,")
    return s or str(name)


def is_generic(name):
    toks = [stem(t) for t in tokens(name)]
    gen = {stem(g) for g in GENERIC_NAMES}
    return (not toks) or all(t in gen for t in toks)


def synonymise(text):
    return " ".join(THESAURUS.get(t, t) for t in tokens(text))


def path_str(parts):
    return " > ".join(parts)


# %% ------------------------------------------------------------------------------------
# LOADING: one standard node table for every retailer
# ---------------------------------------------------------------------------------------
SHEET_STATUS = {}    # (retailer, sheet) -> pd.Series: one status per data row of that sheet (row reconciliation)
SECONDARY_EDGES = {}  # retailer -> [(child_uid, parent_uid, weight)] from secondary placements (Wayfair)


def _b2b_flag(rc, path, rd):
    rule = rc.get("b2b")
    if rule == "all":
        return True
    if callable(rule):
        try:
            return bool(rule(path, rd))
        except Exception:  # noqa
            return False
    return False


def _id_str(v):
    if isinstance(v, float):
        return "" if np.isnan(v) else (str(int(v)) if v.is_integer() else str(v))
    return str(v)


def _parse_parts(rd, lv):
    parts = []
    for c in lv:
        v = rd.get(c)
        if v is not None and not (isinstance(v, float) and np.isnan(v)) and str(v).strip():
            parts.append(re.sub(r"\s+", " ", str(v)).strip())
    return parts


def _attach_unmapped(rc, f, df):
    """Office Depot pages that served no breadcrumb (v3). Each one is placed under an OD aisle by a
    reviewed placement file (od_unmapped_placement.csv: bge-base proposed the 3 nearest OD aisles, an
    analyst picked one or dropped the page as a duplicate / hub / merchandising page). The only aisle
    created is "School Supplies > Art & Craft Supplies", whose pages OD's rate-limiting kept out of the crawl.
    Without the file, the nearest aisle by character n-grams is used (indicative only)."""
    um = rc["unmapped"]
    x = read_table(f, um["sheet"])
    st = pd.Series("", index=x.index, dtype=object)
    names = x[um["name_col"]].astype(str).str.strip().tolist()
    pf = find_file([um.get("placement_file", "od_unmapped_placement.csv")])
    placed = {}
    if pf:
        pl = pd.read_csv(pf)
        placed = {n: (str(p) if pd.notna(p) else None, str(d)) for n, p, d in
                  zip(pl["name"], pl["parent_path"], pl["decision"])}
    else:
        from sklearn.feature_extraction.text import TfidfVectorizer
        have_kids = {p[:-1] for p in df["path"] if len(p) > 1}
        par = [p for p in df["path"] if 2 <= len(p) <= 3 and p in have_kids]
        ptxt = [" ".join(p[-1:] + p[:1]) for p in par]
        vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True).fit(ptxt + names)
        S = (vec.transform(names) @ vec.transform(ptxt).T).toarray()
        placed = {nm: (path_str(par[int(np.argmax(S[k]))]), "place (nearest aisle by wording)")
                  for k, nm in enumerate(names)}
    exist = set(df["path"])
    names_lower = {p[-1].lower() for p in df["path"]}
    rows = []
    for k, (idx, nm) in enumerate(zip(x.index, names)):
        parent, decision = placed.get(nm, (None, "drop: no placement decision"))
        if not decision.startswith("place") or not parent:
            st[idx] = "dropped: " + decision.replace("drop: ", "")
            continue
        if nm.lower() in names_lower:
            st[idx] = "dropped: already in the tree under the same name"
            continue
        best = tuple(parent.split(" > "))
        path = best + (nm,)
        if path in exist:
            st[idx] = "dropped: already in the tree under the same name"
            continue
        exist.add(path)
        cval = pd.to_numeric(x.at[idx, um["count_col"]], errors="coerce") if um.get("count_col") in x else np.nan
        rows.append({"path": path, "count_raw": cval, "native_id": str(x.at[idx, um["id_col"]]),
                     "url": x.at[idx, um["url_col"]], "b2b": _b2b_flag(rc, path, {}), "provenance": "unmapped sheet",
                     "raw_idx": -1})
        st[idx] = f"used: attached under {path_str(best)}"
    SHEET_STATUS[(rc["name"], um["sheet"])] = st
    return pd.DataFrame(rows)


def load_retailer(rc):
    f = find_file(rc["file_glob"])
    if f is None:
        raise FileNotFoundError(f"No file for {rc['name']} matching {rc['file_glob']} in {CONFIG['data_dir']}")
    raw = read_table(f, rc.get("sheet"))
    n_raw = len(raw)
    status = pd.Series("", index=raw.index, dtype=object)       # row reconciliation for the main sheet
    secondary = None
    if rc.get("row_filter") is not None:
        keep = rc["row_filter"](raw).fillna(False).astype(bool)
        status[~keep] = "dropped: " + rc.get("row_filter_desc", "retailer row filter")
        if rc.get("secondary_placements"):
            secondary = raw[~keep]
        raw = raw[keep]
    lv = [c for c in rc["level_cols"] if c in raw.columns]
    blank = raw[lv[0]].isna()
    status[raw.index[blank.values]] = "dropped: blank L1 (no category path)"
    raw = raw[~blank]
    cnt = rc.get("count_col")
    rows = []
    for idx, rd in zip(raw.index, raw.to_dict("records")):
        parts = _parse_parts(rd, lv)
        if not parts:
            status[idx] = "dropped: no category name"
            continue
        cval = pd.to_numeric(rd.get(cnt), errors="coerce") if cnt and cnt in rd else np.nan
        rows.append({"path": tuple(parts), "count_raw": cval,
                     "native_id": _id_str(rd.get(rc["id_col"], "")) if rc.get("id_col") in rd else "",
                     "url": rd.get(rc["url_col"], "") if rc.get("url_col") in rd else "",
                     "b2b": _b2b_flag(rc, tuple(parts), rd), "provenance": "tree", "raw_idx": idx})
    if not rows:
        raise RuntimeError(f"{rc['name']}: no rows parsed")
    df = pd.DataFrame(rows)
    dup = df.duplicated("path").values
    status[df.loc[dup, "raw_idx"].values] = "dropped: duplicate row (same path listed twice)"
    df = df[~dup].reset_index(drop=True)
    if rc.get("unmapped"):
        um = _attach_unmapped(rc, f, df)
        if len(um):
            df = pd.concat([df, um], ignore_index=True)

    # implied parents (a breadcrumb with no row of its own)
    have = set(df["path"])
    extra = []
    for p in list(have):
        for i in range(1, len(p)):
            if p[:i] not in have:
                have.add(p[:i])
                extra.append({"path": p[:i], "count_raw": np.nan, "native_id": "", "url": "",
                              "b2b": _b2b_flag(rc, p[:i], {}), "provenance": "implied parent", "raw_idx": -1})
    if extra:
        df = pd.concat([df, pd.DataFrame(extra)], ignore_index=True)

    df["retailer"] = rc["name"]
    df["role"] = rc["role"]
    df["depth"] = df["path"].map(len)
    df["name"] = df["path"].map(lambda p: p[-1])
    df["path_str"] = df["path"].map(path_str)

    # ---- node kinds and scope ------------------------------------------------------------
    re_merch, re_facet = re.compile(MERCH_NODE), re.compile(FACET_NODE)
    re_head, re_aggr = re.compile(HEADING_NODE), re.compile(AGGREGATE_NODE)
    re_univ, re_white = re.compile(UNIVERSE_EXCLUDE_L1), re.compile(UNIVERSE_WHITELIST)
    re_scope = [re.compile(x) for x in rc.get("scope_exclude", [])]
    md = CONFIG["max_depth"]

    parents_with_kids = {p[:-1] for p in df["path"] if len(p) > 1}

    def drop_reason(p):
        ps = path_str(p)
        if rc["name"] != FOCAL and re_univ.search(p[0]) and not (len(p) > 1 and re_white.search(ps)):
            return "universe: department out of scope"
        if any(x.search(ps) for x in re_scope):
            return "retailer scope rule"
        for q in p:
            if re_merch.search(q):
                return "merchandising page (new / sale / collection / sub-brand)"
            if re_facet.search(q):
                return "facet (colour / size / style / room filter)"
        if re_aggr.search(p[-1]) and p not in parents_with_kids:
            return "aggregate page duplicating its parent"
        if len(p) > md:
            return FOLDED
        return ""

    df["drop_reason"] = df["path"].map(drop_reason)
    # v3: a REAL fold - levels below L4 count towards their L4 parent's breadth and keep their labels
    # as aliases of that parent (they were silently lost in v2)
    folded = df[df["drop_reason"].eq(FOLDED)]
    aliases, n_folded = defaultdict(list), defaultdict(int)
    for p in folded["path"]:
        aliases[p[:md]].append(p[-1])
        if p not in parents_with_kids:
            n_folded[p[:md]] += 1
    df["aliases"] = df["path"].map(lambda p: "; ".join(dict.fromkeys(aliases.get(p, []))))
    df["n_folded"] = df["path"].map(lambda p: n_folded.get(p, 0))
    df["in_scope"] = df["drop_reason"].eq("")
    df["is_heading"] = df["name"].map(lambda n: bool(re_head.search(n) or re_aggr.search(n)))
    df["name_clean"] = df["name"].map(clean_name)

    df["uid"] = rc["name"] + "::" + df["path_str"]
    df["parent_uid"] = df["path"].map(lambda p: rc["name"] + "::" + path_str(p[:-1]) if len(p) > 1 else None)
    ins = df[df["in_scope"]]
    kids = ins.groupby("parent_uid")["uid"].apply(list).to_dict()
    df["children"] = df["uid"].map(lambda u: kids.get(u, []))
    df["is_leaf"] = df["children"].map(len).eq(0)
    df["source_file"] = os.path.basename(f)
    df.attrs["n_raw_rows"] = n_raw
    RAW_ROWS[rc["name"]] = int(n_raw)

    # row reconciliation for the main sheet: every surviving row -> used / folded / dropped (reason)
    dr = dict(zip(df["raw_idx"], df["drop_reason"]))
    for idx in status.index[status.eq("")]:
        r = dr.get(idx, None)
        status[idx] = ("used" if r == "" else "used: folded into its L4 parent (breadth + alias)" if r == FOLDED
                       else f"dropped: {r}" if r is not None else "dropped: unparsed")
    # secondary placements -> cross-list edges (child = the category's primary node, parent = this row's parent)
    if secondary is not None and len(secondary):
        prim = {nid: u for nid, u, s_ in zip(df["native_id"], df["uid"], df["in_scope"])
                if nid and nid != "nan" and s_}
        inscope = set(ins["uid"])
        canon_parent = dict(zip(df["uid"], df["parent_uid"]))
        sec_recs = [(idx, _parse_parts(rd, lv), _id_str(rd.get(rc["id_col"], "")))
                    for idx, rd in zip(secondary.index, secondary.to_dict("records"))]
        sec_id_of = {tuple(p): i for _, p, i in sec_recs if p}
        edges = []
        for idx, parts, cid in sec_recs:
            cu = prim.get(cid)
            pu = rc["name"] + "::" + path_str(parts[:-1]) if len(parts) > 1 else None
            if pu is not None and pu not in inscope:
                # the parent is itself a secondary copy (Wayfair repeats whole aisles): use its primary node
                pu = prim.get(sec_id_of.get(tuple(parts[:-1]), ""), pu)
            if cu and pu in inscope and canon_parent.get(cu) == pu:
                status[idx] = "dropped: duplicate copy of a placement already in the tree"
            elif cu and pu in inscope and pu != cu and not pu.startswith(cu + " > ") and not cu.startswith(pu + " > "):
                edges.append((cu, pu, 1.0))
                status[idx] = "used: cross-list edge to the category's primary placement (Method G)"
            else:
                status[idx] = "dropped: secondary placement whose parent or category is out of scope"
        SECONDARY_EDGES[rc["name"]] = list({(c, p): (c, p, w) for c, p, w in edges}.values())
    SHEET_STATUS[(rc["name"], rc.get("sheet"))] = status
    return df.drop(columns=["raw_idx"]).reset_index(drop=True), f


def load_crosslist_edges(rc, file, nodes):
    """Staples cross-listings (child -> extra parent). Parents are given by NAME; ~50 names
    are shared by two shelves - each name resolves to ONE shelf (same-L1 non-leaf, else the
    shallowest non-leaf, else the shallowest)."""
    cl = rc.get("crosslist")
    if not cl:
        return []
    x = read_table(file, cl["sheet"], header=cl["header_row"])
    ins = nodes[nodes["in_scope"]]
    by_name = defaultdict(list)
    for u, n, leaf, lvl, pth in zip(ins["uid"], ins["name"], ins["is_leaf"], ins["depth"], ins["path"]):
        by_name[n].append((u, leaf, lvl, pth[0]))
    canon_parent = dict(zip(ins["uid"], ins["parent_uid"]))
    l1_of = dict(zip(ins["uid"], ins["path"].map(lambda p: p[0])))

    def resolve(pname, child_uid):
        cands = by_name.get(pname, [])
        if not cands:
            return None
        same = [c for c in cands if c[3] == l1_of[child_uid] and not c[1]]
        pool = same or [c for c in cands if not c[1]] or cands
        return sorted(pool, key=lambda c: c[2])[0][0]

    edges = []
    st = pd.Series("", index=x.index, dtype=object)
    for idx, r in x.iterrows():
        child_name, parents = r.get(cl["name_col"]), str(r.get(cl["parents_col"], ""))
        if pd.isna(child_name):
            st[idx] = "reference: blank / note row"
            continue
        plist = [p.strip() for p in parents.split(";") if p.strip()]
        cands = by_name.get(child_name, [])
        if not cands:
            st[idx] = "dropped: category out of scope (e.g. gift cards, services)"
            continue
        cu = sorted(cands, key=lambda c: (-int(c[1]), -c[2]))[0][0]
        n0 = len(edges)
        for p in plist:
            pu = resolve(p, cu)
            if pu and pu != cu and pu != canon_parent.get(cu) and not pu.startswith(cu + " > ") \
                    and not cu.startswith(pu + " > "):
                edges.append((cu, pu, 1.0 / len(plist)))
        st[idx] = (f"used: {len(edges) - n0} cross-list edges" if len(edges) > n0
                   else "used: no extra in-scope parent (canonical placement only)")
    SHEET_STATUS[(rc["name"], cl["sheet"])] = st
    return list({(c, p): (c, p, w) for c, p, w in edges}.values())


HEADER_NAV = set()   # Staples departments shown in the site's header navigation (coreness input, v3)


def load_header_nav(rc, file):
    h = rc["header_nav"]
    x = read_table(file, h["sheet"], header=h["header_row"])
    st = pd.Series("", index=x.index, dtype=object)
    for idx, r in x.iterrows():
        nm, fl = r.get(h["name_col"]), str(r.get(h["flag_col"], "")).strip()
        if pd.isna(nm) or fl not in ("Yes", "No"):
            st[idx] = "reference: total / note row"
            continue
        if fl == "Yes":
            HEADER_NAV.add(str(nm).strip())
        st[idx] = "used: header-nav flag -> 1P coreness"
    SHEET_STATUS[(rc["name"], h["sheet"])] = st


def row_reconciliation(data_dir=None):
    """Every sheet of every input workbook, every data row -> one status (v3). Sheets the pipeline does
    not analyse are listed as reference-only with their row counts; status counts add up to the rows.
    Rows = data rows below the header line as pandas reads the sheet (header/title rows excluded)."""
    rows = []
    for rc in RETAILERS:
        f = find_file(rc["file_glob"], data_dir)
        xl = pd.ExcelFile(f)
        for sh in xl.sheet_names:
            key = (rc["name"], sh)
            if key in SHEET_STATUS:
                st = SHEET_STATUS[key]
                n = len(st)
                for status, cnt in st.value_counts().items():
                    rows.append({"retailer": rc["name"], "file": os.path.basename(f), "sheet": sh, "rows_in_sheet": n,
                                 "status": status.split(":")[0], "detail": status, "rows": int(cnt)})
            else:
                n = len(xl.parse(sh))
                why = rc.get("reference_sheets", {}).get(sh, "reference (not analysed)")
                rows.append({"retailer": rc["name"], "file": os.path.basename(f), "sheet": sh, "rows_in_sheet": n,
                             "status": "reference", "detail": why, "rows": n})
    for pat, why in UNUSED_FILES.items():
        f = find_file([pat], data_dir)
        if f:
            xl = pd.ExcelFile(f)
            for sh in xl.sheet_names:
                n = len(xl.parse(sh))
                rows.append({"retailer": "Target", "file": os.path.basename(f), "sheet": sh, "rows_in_sheet": n,
                             "status": "not used", "detail": why, "rows": n})
    R = pd.DataFrame(rows)
    chk = R.groupby(["file", "sheet"]).agg(rows_in_sheet=("rows_in_sheet", "first"), accounted=("rows", "sum"))
    bad = chk[chk.rows_in_sheet != chk.accounted]
    if len(bad):
        log(f"  !! row reconciliation mismatch:\n{bad}")
    return R


def harmonise_counts(nodes, rc, xedges=None):
    """subtree_items: comparable item counts where the retailer publishes them (NaN = unknown).
    n_leaves: number of in-scope category leaves under the node (breadth, every retailer)."""
    mode = rc["count_mode"]
    ins = nodes["in_scope"].values
    uid_idx = {u: i for i, u in enumerate(nodes["uid"])}
    kids = defaultdict(set)
    for u, p, s in zip(nodes["uid"], nodes["parent_uid"], ins):
        if p and s:
            kids[p].add(u)
    for c, p, _ in (xedges or []):
        kids[p].add(c)
    leaf_flag = (nodes["is_leaf"] & nodes["in_scope"] & ~nodes["is_heading"]).values
    memo = {}
    sys.setrecursionlimit(20000)

    def leaves_under(u, stack=()):
        if u in memo:
            return memo[u]
        s = {u} if leaf_flag[uid_idx[u]] else set()
        for c in kids.get(u, ()):
            if c not in stack:
                s |= leaves_under(c, stack + (u,))
        memo[u] = s
        return s

    leafsets = [leaves_under(u) if s else set() for u, s in zip(nodes["uid"], ins)]
    nodes["leaf_set"] = leafsets
    # breadth: a folded L4 counts as many shelves as the L5 pages folded into it (v3)
    wt = np.maximum(1, nodes["n_folded"].values) if "n_folded" in nodes else np.ones(len(nodes))
    nodes["n_leaves"] = [int(sum(wt[uid_idx[v]] for v in s)) for s in leafsets]
    counts = nodes["count_raw"].values.astype(float)
    if mode == "terminal_only":
        nodes["subtree_items"] = [float(np.nansum([counts[uid_idx[v]] for v in s])) if s else 0.0
                                  for s in leafsets]
        nodes["count_known"] = ins
    elif mode in ("cumulative", "partial"):
        cap = rc.get("count_cap")
        stated = nodes["count_raw"].copy()
        if cap:
            stated[stated >= cap] = np.nan        # censored
        sub, known = {}, {}
        order = sorted(range(len(nodes)), key=lambda i: -nodes.at[i, "depth"])
        for i in order:
            u = nodes.at[i, "uid"]
            if pd.notna(stated.iat[i]):
                sub[u], known[u] = float(stated.iat[i]), True
            else:
                ch = [c for c in nodes.at[i, "children"]]
                if mode == "cumulative" and ch and all(known.get(c, False) for c in ch):
                    sub[u], known[u] = float(sum(sub[c] for c in ch)), True
                elif mode == "cumulative" and not ch:
                    sub[u], known[u] = np.nan, False
                else:
                    sub[u], known[u] = np.nan, False
        nodes["subtree_items"] = nodes["uid"].map(sub)
        nodes["count_known"] = nodes["uid"].map(known).fillna(False).astype(bool)
    else:
        nodes["subtree_items"] = np.nan
        nodes["count_known"] = False
    nodes["count_mode"] = mode
    return nodes


def retailer_totals(nodes, rc):
    """Catalogue size for normalising: items (if counted) and category leaves (always)."""
    ins = nodes[nodes["in_scope"]]
    lf = ins["is_leaf"] & ~ins["is_heading"]
    leaves = int(np.maximum(1, ins.loc[lf, "n_folded"]).sum()) if "n_folded" in ins else int(lf.sum())
    if rc["count_mode"] == "terminal_only":
        items = float(ins.loc[ins["count_raw"].notna() & ins["is_leaf"], "count_raw"].sum())
    elif rc["count_mode"] == "cumulative":
        l1 = ins[ins["depth"] == 1]
        items = float(l1["subtree_items"].sum()) if l1["count_known"].all() else float(
            ins.loc[ins["is_leaf"] & ins["count_known"], "subtree_items"].sum())
    elif rc["count_mode"] == "partial":
        l2 = ins[(ins["depth"] == 2) & ins["count_known"]]
        items = float(l2["subtree_items"].sum())
    else:
        items = np.nan
    return {"items": items, "leaves": leaves}


def semantic_chain(path, heading_set):
    """Own label first, then ancestors bottom-up, skipping navigation headings and repeats."""
    chain, seen = [], set()
    for i in range(len(path), 0, -1):
        nm = path[i - 1]
        if i < len(path) and nm in heading_set:
            continue
        c = clean_name(nm)
        key = c.lower()
        if key in seen:
            continue
        seen.add(key)
        chain.append(c)
    return chain


def load_all(verbose=True):
    """Load, scope and harmonise all six trees. Returns (nodes, xedges, totals, files)."""
    frames, xedges, totals, files = [], {}, {}, {}
    for rc in RETAILERS:
        df, f = load_retailer(rc)
        files[rc["name"]] = f
        xe = load_crosslist_edges(rc, f, df) if rc.get("crosslist") else []
        if rc.get("header_nav"):
            load_header_nav(rc, f)
        # Staples' cross-listings feed breadth (its leaves really sit under several aisles); a competitor's
        # secondary placements (Wayfair) are graph edges only, so its leaf counts are not double-counted
        xedges[rc["name"]] = xe or SECONDARY_EDGES.get(rc["name"], [])
        df = harmonise_counts(df, rc, xe)
        totals[rc["name"]] = retailer_totals(df, rc)
        frames.append(df)
        if verbose:
            ins = df[df.in_scope]
            log(f"  {rc['name']:<12} rows {df.attrs.get('n_raw_rows', len(df)):>6} -> in scope {len(ins):>6} "
                f"(leaves {totals[rc['name']]['leaves']:>5}, max depth {ins['depth'].max()}, counts: {rc['count_mode']}"
                f"{', items %s' % format(int(totals[rc['name']]['items']), ',') if pd.notna(totals[rc['name']]['items']) else ''})"
                + (f"  + {len(xedges[rc['name']])} cross-listing edges" if xedges[rc['name']] else ""))
    nodes = pd.concat(frames, ignore_index=True)
    heads = set(nodes.loc[nodes["is_heading"], "name"])
    nodes["sem_chain"] = nodes["path"].map(lambda p: semantic_chain(p, heads))
    nodes["name_expanded"] = [
        (f"{ch[1]} {ch[0]}" if len(ch) > 1 and is_generic(ch[0]) else ch[0]) for ch in nodes["sem_chain"]]
    nodes["sem_path"] = nodes["sem_chain"].map(lambda c: " > ".join(reversed(c)))
    nodes["unit_ok"] = nodes["in_scope"] & ~nodes["is_heading"]
    return nodes, xedges, totals, files


def staples_coreness(focal):
    depth_pct = focal.groupby("depth")["subtree_items"].rank(pct=True).fillna(0).values
    base = focal["path"].map(lambda p: CORE_L1_WEIGHT.get(p[0], CORE_DEFAULT)).values.astype(float)
    # v3: departments Staples puts in its header navigation are treated as more core (+0.1, capped at 1)
    base = np.minimum(1.0, base + 0.1 * focal["path"].map(lambda p: p[0] in HEADER_NAV).values)
    for pat, w in CORE_OVERRIDES:
        base[focal["path_str"].str.contains(pat, regex=True).values] = w
    return base * (0.6 + 0.4 * depth_pct)


def staples_descendants(focal, xedges):
    """All descendants of every Staples node, following canonical AND cross-listed placements."""
    kids = defaultdict(set)
    for u, p in zip(focal["uid"], focal["parent_uid"]):
        if p:
            kids[p].add(u)
    for c, p, _ in xedges:
        kids[p].add(c)
    memo = {}

    def desc(u, stack=()):
        if u in memo:
            return memo[u]
        s = {u}
        for c in kids.get(u, ()):
            if c not in stack:
                s |= desc(c, stack + (u,))
        memo[u] = s
        return s

    return {u: desc(u) for u in focal["uid"]}


# %% ------------------------------------------------------------------------------------
# LEXICAL SIMILARITY (both methods)
# ---------------------------------------------------------------------------------------
class Lexical:
    """Wording similarity: stemmed word uni/bi-grams + character 3-5 grams, averaged."""

    def __init__(self, texts):
        from sklearn.feature_extraction.text import TfidfVectorizer

        def words(s):
            t = [stem(x) for x in tokens(s)]
            return t + [a + "_" + b for a, b in zip(t, t[1:])]

        self.w = TfidfVectorizer(analyzer=words, sublinear_tf=True).fit(texts)
        self.c = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True).fit(
            [t.lower() for t in texts])

    def transform(self, xs):
        from scipy.sparse import hstack
        xs = list(xs)
        return hstack([self.w.transform(xs) * np.sqrt(0.5),
                       self.c.transform([x.lower() for x in xs]) * np.sqrt(0.5)]).tocsr()


# %% ------------------------------------------------------------------------------------
# CALIBRATION (per competitor; both methods)
# ---------------------------------------------------------------------------------------
def load_gold(for_calibration=False):
    """Labelled rows. for_calibration=True keeps only the random / gap-enriched samples: rows from
    the verification loop were chosen BECAUSE the model flagged them, so they would bias tau; they
    are still used as overrides (truth beats the model) in run_framework.py."""
    f = find_file([CONFIG["gold_file"], "gold_matches*.csv"])
    if not f:
        log("  !! no gold file found - calibration falls back to score quantiles (indicative only)")
        return pd.DataFrame(columns=["competitor", "comp_path", "staples_carries", "gold_staples_path", "source"])
    g = pd.read_csv(f)
    g["staples_carries"] = g["staples_carries"].astype(int)
    if for_calibration:
        g = g[~g["source"].astype(str).str.contains("verification")]
    return g


def ablation_mask(focal, gold_path, comp_path):
    """True = keep. Hide the Staples department holding every gold alternative, plus any
    shelf with the same name as the answer or the competitor shelf."""
    hide = np.zeros(len(focal), dtype=bool)
    names = {comp_path.split(" > ")[-1].lower()}
    for alt in str(gold_path).split("|"):
        pre = " > ".join(alt.split(" > ")[:2])
        hide |= (focal["path_str"].eq(pre) | focal["path_str"].str.startswith(pre + " > ")).values
        names.add(alt.split(" > ")[-1].lower())
    hide |= focal["name"].str.lower().isin(names).values
    return ~hide


def calibrate(gold_c, best_score, ablation_scores, best_path):
    """tau  = 'same shelf' threshold (cost-weighted Youden's J on gold + ablation negatives)
       s_enter = gap screen: q-th percentile of scores of shelves Staples DOES carry
       neg  = median score of a non-match (anchors CRS at 0)."""
    rows = []
    for _, r in gold_c.iterrows():
        sc = best_score.get(r["comp_path"])
        if sc is None:
            continue
        rows.append({"comp_path": r["comp_path"], "y": int(r["staples_carries"]), "score": sc, "kind": "gold"})
        if int(r["staples_carries"]) == 1 and r["comp_path"] in ablation_scores:
            rows.append({"comp_path": r["comp_path"], "y": 0, "score": ablation_scores[r["comp_path"]],
                         "kind": "ablation"})
    cal_df = pd.DataFrame(rows)
    y, s = cal_df["y"].values, cal_df["score"].values
    c = CONFIG["false_gap_cost"]
    best = (float(np.median(s)), -1e9)
    for t in np.unique(np.round(s, 4)):
        pred = s >= t
        j = c * pred[y == 1].mean() - pred[y == 0].mean()
        if j > best[1]:
            best = (float(t), j)
    tau = best[0]
    from sklearn.metrics import roc_auc_score
    try:
        auc = float(roc_auc_score(y, s))
    except ValueError:
        auc = float("nan")
    g = cal_df[cal_df["kind"] == "gold"]
    pos = g[g.y == 1]["score"]
    s_enter = float(pos.quantile(CONFIG["gap_screen_false_alarm"])) if len(pos) else tau
    s_enter = min(s_enter, tau)
    negs = g[g.y == 0]["score"]
    # top-1: predicted Staples shelf equals a gold alternative, its parent or its child
    ok = n = 0
    for _, r in gold_c[(gold_c.staples_carries == 1) & gold_c.gold_staples_path.notna()].iterrows():
        pred = best_path.get(r["comp_path"])
        if pred is None:
            continue
        n += 1
        alts = str(r["gold_staples_path"]).split("|")
        ok += any(pred == a or pred.startswith(a + " > ") or a.startswith(pred + " > ") for a in alts)
    rnd = gold_c[gold_c.get("source", pd.Series("", index=gold_c.index)).astype(str).str.contains("stratified|random")]
    m = {"tau": tau, "s_enter": s_enter, "neg_median": float(cal_df.loc[cal_df.y == 0, "score"].median()),
         "auc": auc, "youden_j": best[1], "n_gold": int(len(g)), "n_pos": int((g.y == 1).sum()),
         "n_neg_real": int((g.y == 0).sum()), "n_neg_ablation": int((cal_df.kind == "ablation").sum()),
         "top1": ok / max(n, 1), "n_top1": n,
         "gold_accuracy": float(((g["score"] >= tau) == (g["y"] == 1)).mean()) if len(g) else np.nan,
         "false_gap_rate": float((pos < s_enter).mean()) if len(pos) else np.nan,
         "gap_recall_real": float((negs < s_enter).mean()) if len(negs) else np.nan,
         "base_rate_carried": float(rnd["staples_carries"].mean()) if len(rnd) else np.nan}
    return m, cal_df


def fit_tau(y, s):
    """Cost-weighted Youden's J threshold (same rule as calibrate)."""
    c = CONFIG["false_gap_cost"]
    best = (float(np.median(s)), -1e9)
    for t in np.unique(np.round(s, 4)):
        pred = s >= t
        j = c * pred[y == 1].mean() - (pred[y == 0].mean() if (y == 0).any() else 0)
        if j > best[1]:
            best = (float(t), j)
    return best[0]


def cv_threshold(cal_df, k=None):
    """k-fold cross-validated accuracy of the same-shelf threshold (v3). Folds are drawn over competitor
    shelves, so a gold row and its ablation negative always fall in the same fold. Returns
    (in-sample accuracy, held-out accuracy) on the gold rows."""
    k = k or CONFIG["cv_folds"]
    r = np.random.default_rng(CONFIG["seed"])
    keys = cal_df["comp_path"].unique()
    fold = dict(zip(keys, r.permutation(len(keys)) % k))
    f = cal_df["comp_path"].map(fold).values
    g = cal_df["kind"].eq("gold").values
    y, s_ = cal_df["y"].values, cal_df["score"].values
    t_all = fit_tau(y, s_)
    ins = float(((s_[g] >= t_all) == (y[g] == 1)).mean())
    hits = n = 0
    for i in range(k):
        tr, te = f != i, (f == i) & g
        if not te.any():
            continue
        t = fit_tau(y[tr], s_[tr])
        hits += int(((s_[te] >= t) == (y[te] == 1)).sum())
        n += int(te.sum())
    return ins, hits / max(n, 1)


def fallback_calibration(scores, pooled=None):
    """No labels for this competitor: borrow the pooled calibration (same scorer, same spine)."""
    if pooled:
        m = dict(pooled)
        m["note"] = "borrowed (pooled) calibration - label this competitor to confirm"
        return m
    return {"tau": float(np.quantile(scores, 0.10)), "s_enter": float(np.quantile(scores, 0.05)),
            "neg_median": float(np.quantile(scores, 0.02)), "note": "quantile fallback - indicative only"}


def status_from_scores(best, tau, s_enter):
    """matched (>= tau) | likely (carried, exact shelf not pinned) | gap (below the screen)"""
    return np.where(best >= tau, "matched", np.where(best < s_enter, "gap", "likely"))


# %% ------------------------------------------------------------------------------------
# NODE-LEVEL ROLL-UPS SHARED BY BOTH METHODS
# ---------------------------------------------------------------------------------------
def aas_scaler(A_leaves, matched_leaves):
    """AAS on ONE scale for every competitor and for both methods (quantile anchoring).
    F = empirical CDF of the method's raw adjacency over ALL competitor leaves, pooled;
        AAS = 100 x min(1, F(A) / F(median A of the leaves Staples carries))
    100 = as embedded in Staples' neighbourhood as a typical shelf Staples already carries;
    0 = the least embedded shelf in the panel. Pooling keeps one ruler across retailers;
    the quantile transform makes the vector and graph scales comparable before averaging."""
    ref = np.sort(np.asarray(A_leaves, dtype=float))
    f100 = np.searchsorted(ref, np.median(np.asarray(A_leaves)[np.asarray(matched_leaves)]), side="right") / len(ref)
    return lambda A: 100 * np.clip((np.searchsorted(ref, np.asarray(A, dtype=float), side="right") / len(ref))
                                   / max(f100, 1e-9), 0, 1)


def rollup_competitor(cn):
    """For each competitor node: breadth/items coverage and exposure-weighted AAS/CRS over leaves.
    cn needs: uid, is_leaf, unit_ok, status, subtree_items, count_known, AAS_leaf, CRS_leaf."""
    uid2row = {u: i for i, u in enumerate(cn["uid"])}
    leaf_rows = [i for i, (lf, ok) in enumerate(zip(cn["is_leaf"], cn["unit_ok"])) if lf and ok]
    desc = defaultdict(list)
    for i in leaf_rows:
        parts = cn.at[i, "path_str"].split(" > ")
        pre = cn.at[i, "uid"].split("::")[0] + "::"
        for k in range(1, len(parts) + 1):
            anc = pre + " > ".join(parts[:k])
            if anc in uid2row:
                desc[anc].append(i)
    status = cn["status"].values
    items = cn["subtree_items"].values.astype(float)
    known = cn["count_known"].values.astype(bool)
    aas, crs = cn["AAS_leaf"].values, cn["CRS_leaf"].values
    cov_leaf, cov_item, AAS, CRS, top_unc, n_gap_leaves = [], [], [], [], [], []
    for u in cn["uid"]:
        L = desc.get(u, [])
        own = uid2row[u]
        if not L:
            L = [own]
        gap = np.array([status[i] == "gap" for i in L])
        cov_leaf.append(1 - gap.mean())
        it = items[L]
        kn = known[L]
        if kn.all() and np.nansum(it) > 0:
            cov_item.append(float(np.nansum(it[~gap]) / np.nansum(it)))
            w = np.maximum(np.nan_to_num(it), 1.0)
        else:
            cov_item.append(np.nan)
            w = np.ones(len(L))
        AAS.append(float(np.average(aas[L], weights=w)))
        CRS.append(max(float(crs[own]), float(np.average(crs[L], weights=w))))
        n_gap_leaves.append(int(gap.sum()))
        unc = [cn.at[i, "name"] for i in L if status[i] == "gap"][:4]
        top_unc.append(", ".join(unc))
    cn["coverage_leaf"] = cov_leaf
    cn["coverage_items"] = cov_item
    cn["coverage"] = np.where(pd.notna(cn["coverage_items"]), cn["coverage_items"], cn["coverage_leaf"])
    cn["AAS"] = AAS
    cn["CRS"] = CRS
    cn["n_gap_leaves"] = n_gap_leaves
    cn["gap_leaves_example"] = top_unc
    return cn


# %% ------------------------------------------------------------------------------------
# TRACK C FRAMEWORK: labels, opportunity, sensitivity
# ---------------------------------------------------------------------------------------
def mission_profile(texts, embed):
    """Workplace-mission fit of category texts. embed(list[str]) -> L2-normalised vectors.
    fit_raw = similarity to the closest workplace mission - similarity to the closest residential /
    leisure mission. Returns one row per text."""
    wn, rn = list(WORK_MISSIONS), list(RES_MISSIONS)
    W, R = embed(list(WORK_MISSIONS.values())), embed(list(RES_MISSIONS.values()))
    T = embed(list(texts))
    sw, sr = T @ W.T, T @ R.T
    return pd.DataFrame({"mission": [wn[k] for k in sw.argmax(axis=1)], "mission_sim": sw.max(axis=1),
                         "res_mission": [rn[k] for k in sr.argmax(axis=1)], "res_sim": sr.max(axis=1),
                         "fit_raw": sw.max(axis=1) - sr.max(axis=1)})


def mission_score(fit_raw, ref_lo, ref_hi):
    """0 = as residential as the panel's least workplace-like shelves (10th percentile),
    100 = as workplace-like as a typical Staples core shelf (median, coreness >= 0.6)."""
    return 100 * np.clip((np.asarray(fit_raw, dtype=float) - ref_lo) / max(ref_hi - ref_lo, 1e-6), 0, 1)


def brand_fit(mission, pc_b2b):
    """BFS (0-100) = w_m x mission score + w_b x 100 x B2B-channel evidence."""
    return CONFIG["bfs_w_mission"] * np.asarray(mission, dtype=float) + \
        CONFIG["bfs_w_b2b"] * 100 * np.asarray(pc_b2b, dtype=float)


def safety_hit(text):
    m = re.search(BRAND_SAFETY, str(text), flags=re.I)
    return m.group(0).lower() if m else ""


def complexity_flags(text):
    return [k for k, rx in COMPLEXITY.items() if re.search(rx, str(text), flags=re.I)]


def ease_score(pc_mkt, n_flags, gap_type):
    """EASE (0-100): marketplace supply already exists (share of Amazon / Walmart that carry it), minus
    25 points per operational-complexity flag; deepening an aisle Staples already runs gets +15."""
    base = 50 + 50 * np.asarray(pc_mkt, dtype=float) - 25 * np.asarray(n_flags, dtype=float)
    base = base + np.where(np.asarray(gap_type) == "DEEPEN", 15, 0)
    return np.clip(base, 0, 100)


def label_row(aas, crs, bfs=100.0, residential=False, safety=False, aas_hi=None, aas_lo=None, crs_hi=None,
              crs_lo=None, bfs_gate=None):
    """Zone rule (v3). Safety first; then cannibalisation (a category this close to a core 1P line is a
    1P matter whatever its brand fit); then the brand gate; then adjacency. A residential-lifestyle unit
    (closer to a residential mission than to any workplace mission) drops one zone."""
    aas_hi = CONFIG["aas_hi"] if aas_hi is None else aas_hi
    aas_lo = CONFIG["aas_lo"] if aas_lo is None else aas_lo
    crs_hi = CONFIG["crs_hi"] if crs_hi is None else crs_hi
    crs_lo = CONFIG["crs_lo"] if crs_lo is None else crs_lo
    bfs_gate = CONFIG["bfs_gate"] if bfs_gate is None else bfs_gate
    if safety:
        return "EXCLUDED"
    if crs >= crs_hi:
        return "1P-CORE GAP"
    if crs >= crs_lo:
        return "REVIEW"
    if pd.notna(bfs) and bfs < bfs_gate:
        return "OFF-BRAND"
    lab = "CURATE" if aas >= aas_hi else "VERTICAL EXTENSION" if aas >= aas_lo else "OFF-BRAND"
    if residential:
        lab = {"CURATE": "VERTICAL EXTENSION", "VERTICAL EXTENSION": "OFF-BRAND"}.get(lab, lab)
    return lab


def opportunity(df, w=None, gamma=None, demand=None, crs=None):
    """O = [w_b2b PC_b2b + w_mkt PC_mkt + w_gs GS + w_aas AAS/100 + w_bfs BFS/100 + w_ease EASE/100]
           x (1 - CRS/100)^gamma                                            (all terms 0-1)
    PC_b2b  share of B2B channels carrying it (Office Depot, Wayfair Professional, Walmart for Business)
    PC_mkt  share of the scale marketplaces carrying it (Amazon, Walmart) - needed to compete with them
    GS      gap size (percentile, 0-1); AAS adjacency; BFS brand fit; EASE ease of opening; CRS risk."""
    w = w or CONFIG["rank_weights"]
    gamma = CONFIG["gamma"] if gamma is None else gamma
    crs = df["CRS"] if crs is None else crs
    base = (w["pc_b2b"] * df["PC_b2b"] + w["pc_mkt"] * df["PC_mkt"] + w["gs"] * df["GS"]
            + w["aas"] * df["AAS"] / 100 + w["bfs"] * df["BFS"].fillna(50) / 100 + w["ease"] * df["EASE"] / 100)
    if demand is not None and demand.notna().any():
        dw = CONFIG["demand_weight"]
        base = (1 - dw) * base + dw * demand.fillna(demand.median()) / 100
    return base * (1 - np.clip(crs, 0, 100) / 100) ** gamma


def sensitivity(units):
    """500 runs: weights re-drawn (Dirichlet around the base weights), zone thresholds and the brand gate
    jittered +-5, CRS scaled by U(0.8, 1.2) per unit (coreness is a judgement proxy), gamma in [0.5, 2].
    p_zone = how often a unit keeps its zone; p_top_n = how often it is in its zone's top N."""
    n, conc, jit = CONFIG["n_sensitivity"], CONFIG["dirichlet_conc"], CONFIG["threshold_jitter"]
    keys = list(CONFIG["rank_weights"])
    base = np.array([CONFIG["rank_weights"][k] for k in keys])
    r = np.random.default_rng(CONFIG["seed"])
    keep = np.zeros(len(units))
    topn = np.zeros(len(units))
    base_lab = units["label"].values
    lock = np.isin(base_lab, ["VERIFY", "EXCLUDED"])
    cj = CONFIG["coreness_jitter"]
    for _ in range(n):
        w = dict(zip(keys, r.dirichlet(conc * base)))
        th = {k: CONFIG[k] + r.normal(0, jit) for k in ("aas_hi", "aas_lo", "crs_hi", "crs_lo", "bfs_gate")}
        crs = units["CRS"].values * r.uniform(1 - cj, 1 + cj, len(units))
        lab = np.array([label_row(a, c, b, rs, sf, th["aas_hi"], th["aas_lo"], th["crs_hi"], th["crs_lo"],
                                  th["bfs_gate"])
                        for a, c, b, rs, sf in zip(units["AAS"], crs, units["BFS"], units["residential"],
                                                   units["safety"].astype(bool))])
        lab = np.where(lock, base_lab, lab)
        same = lab == base_lab
        O = opportunity(units, w, CONFIG["gamma"] * r.uniform(0.5, 2.0), crs=crs).values
        for z in set(base_lab):
            idx = np.where(same & (base_lab == z))[0]
            top = idx[np.argsort(-O[idx])][:CONFIG["top_n"]]
            topn[top] += 1
        keep += same
    return pd.DataFrame({"unit_id": units["unit_id"].values, "p_zone": keep / n, "p_top_n": topn / n})


def bootstrap_thresholds(cal_rows, n=None, seed=None):
    """Gold-label bootstrap (v3): resample a competitor's calibration rows (gold + ablation negatives,
    grouped by competitor shelf) and re-fit tau and the gap screen each time. Returns arrays (n,) of tau and
    s_enter. Propagates labelling / matching uncertainty into the gap verdicts."""
    n = n or CONFIG["n_bootstrap"]
    r = np.random.default_rng(CONFIG["seed"] if seed is None else seed)
    keys = cal_rows["comp_path"].unique()
    by = {k: g for k, g in cal_rows.groupby("comp_path")}
    taus, screens = np.zeros(n), np.zeros(n)
    c = CONFIG["false_gap_cost"]
    for b in range(n):
        d = pd.concat([by[k] for k in r.choice(keys, len(keys), replace=True)])
        y, s_ = d["y"].values, d["score"].values
        best = (float(np.median(s_)), -1e9)
        for t in np.unique(np.round(s_, 3)):
            pred = s_ >= t
            j = c * pred[y == 1].mean() - (pred[y == 0].mean() if (y == 0).any() else 0)
            if j > best[1]:
                best = (float(t), j)
        pos = d[(d["kind"] == "gold") & (d["y"] == 1)]["score"]
        taus[b] = best[0]
        screens[b] = min(float(pos.quantile(CONFIG["gap_screen_false_alarm"])) if len(pos) else best[0], best[0])
    return taus, screens


# %% ------------------------------------------------------------------------------------
# CHART STYLE
# ---------------------------------------------------------------------------------------
def set_style():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 10, "axes.titlesize": 12.5, "axes.titleweight": "bold",
        "axes.titlelocation": "left", "axes.labelsize": 10, "axes.spines.top": False, "axes.spines.right": False,
        "axes.edgecolor": INK["muted"], "axes.labelcolor": INK["secondary"], "xtick.color": INK["secondary"],
        "ytick.color": INK["secondary"], "text.color": INK["primary"], "axes.grid": False,
        "figure.facecolor": "white", "axes.facecolor": "white", "figure.dpi": 110, "savefig.dpi": 200,
        "savefig.bbox": "tight", "legend.frameon": False,
    })
    return plt


def _clean_json(o):
    """NaN/inf -> None and numpy scalars -> Python, so summary.json is strict JSON."""
    if isinstance(o, dict):
        return {str(k): _clean_json(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean_json(v) for v in o]
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        try:
            o = o.item()
        except Exception:  # noqa
            return str(o)
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return None
    return o


def save_json(obj, *parts):
    p = out_path(*parts)
    with open(p, "w") as fh:
        json.dump(_clean_json(obj), fh, indent=2, default=str, allow_nan=False)
    return p
