"""Compute every number used in the Staples PoC deck from the pipeline outputs.

Usage (from the project root):
    PYTHONIOENCODING=utf-8 python outputs/ppt/src/deck_facts.py V1

Writes outputs/ppt/src/deck_facts_<VERSION>.json, which build_deck.js reads. No number on a slide is
typed by hand: insights read attribute_gaps / price_bands / node_summary / vendor_view, recommendations
read final_archetypes / sku_recommendations, and each pick is checked against the Staples catalog.
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
TABLES = ROOT / "outputs" / "tables"
INTERIM = ROOT / "data" / "interim"
VERSION = sys.argv[1] if len(sys.argv) > 1 else "V1"

# The 9 nodes shown in the deck (Sai, 2026-10-05): top 3 per segment, in segment rank order.
DECK_NODES = [
    "Office Supplies > Calendars & Planners > Planners & Personal Organizers",
    "Bags, Backpacks & Luggage > Backpacks & Laptop Bags > Backpacks",
    "Furniture > Desks > Office Desks",
    "Furniture > Chairs & Seating > Accent & Waiting Room Chairs",
    "Furniture > Lamps & Lighting > Desk Lamps",
    "Bags, Backpacks & Luggage > Totes & Handbags > Lunch Bags & Boxes",
    "Furniture > Decor > Clocks & Timers",
    "Furniture > Cubicle & Panel Systems > Office Partitions & Dividers",
    "Coffee, Water & Snacks > Coffee, Coffee Makers & Supplies > Coffee Organizers & Dispensers",
]
SHORT = {
    "Planners & Personal Organizers": "Planners",
    "Backpacks": "Backpacks",
    "Office Desks": "Office Desks",
    "Accent & Waiting Room Chairs": "Accent Chairs",
    "Desk Lamps": "Desk Lamps",
    "Lunch Bags & Boxes": "Lunch Bags",
    "Clocks & Timers": "Clocks",
    "Office Partitions & Dividers": "Partitions",
    "Coffee Organizers & Dispensers": "Coffee Organizers",
}

# Top-2 picks per node. Rule (Sai, 2026-10-05): walk the final rank, skip near-duplicates (same product
# idea with only a modifier added, e.g. "Luxe folding screen" after "Folding screen") and skip a pick
# whose "Staples lacks it" claim fails a title check on the Staples catalog. `skipped` documents why
# higher-ranked archetypes were passed over. `staples_kw` / `comp_kw` are the catalog checks (regex on
# family titles in the node). Exemplar = the recommended SKU whose price is closest to the archetype's
# competitor median, unless `exemplar` (rank) overrides it for a title that matches the idea better.
PICKS = {
    "Planners & Personal Organizers": [
        dict(rank=1, label="Minimal multi-year monthly planner", framing="deepen", exemplar=1,
             attr=[("design_theme", "plain"), ("date_format", "monthly")],
             staples_kw=r"monthly", comp_kw=r"monthly"),
        dict(rank=3, label="Guided / daily journal", framing="add", exemplar=1,
             attr=[("planner_type", "journal")],
             staples_kw=r"journal|guided|gratitude", comp_kw=r"journal|guided|gratitude",
             skipped="R2 plain-cover weekly planner: same idea as R1 (only the date layout differs)"),
    ],
    "Backpacks": [
        dict(rank=1, label="Hiking / outdoor daypack (unisex)", framing="add", exemplar=3,
             attr=[("pack_type", "hiking")],
             staples_kw=r"hiking|outdoor|daypack|trail", comp_kw=r"hiking|outdoor|daypack|trail"),
        dict(rank=4, label="Travel / carry-on backpack (40L)", framing="deepen", exemplar=3,
             attr=[("pack_type", "travel")],
             staples_kw=r"travel|carry.on|flight", comp_kw=r"travel|carry.on|flight",
             skipped="R2-R3 hiking/outdoor backpacks: same idea as R1"),
    ],
    "Office Desks": [
        dict(rank=1, label="Design-led (luxe) computer desk", framing="deepen",
             attr=[("aesthetic_tags", "luxe"), ("desk_type", "computer")],
             staples_kw=r"luxe|luxury|gold|marble|glam", comp_kw=r"luxe|luxury|gold|marble|glam"),
        dict(rank=2, label="Minimal remote-work desk with storage", framing="add",
             attr=[("end_user_segment", "remote workers"), ("aesthetic_tags", "sleek/minimal")],
             staples_kw=r"home office", comp_kw=r"home office"),
    ],
    "Accent & Waiting Room Chairs": [
        dict(rank=1, label="Warm-tone leather / fabric armchair", framing="deepen", exemplar=2,
             attr=[("form_factor", "armchair")],
             staples_kw=r"armchair|arm chair", comp_kw=r"armchair|arm chair"),
        dict(rank=3, label="Light-neutral swivel barrel chair", framing="add", exemplar=2,
             attr=[("form_factor", "barrel")],
             staples_kw=r"barrel", comp_kw=r"barrel",
             skipped="R2 lounge/club chair: Staples already lists 12 lounge chairs (commercial vinyl / faux leather)"),
    ],
    "Desk Lamps": [
        dict(rank=1, label="Decor-grade shaded table lamp ($150+)", framing="trade-up",
             staples_kw=r"shade", comp_kw=r"shade",
             attr=[("lamp_form", "shaded")], price_min=150,
             note="Staples already has 55 shaded lamps (mostly under $100), so this is a price/design trade-up"),
        dict(rank=6, label="Glass / Tiffany-style statement lamp", framing="add",
             staples_kw=r"tiffany|stained|glass", comp_kw=r"tiffany|stained|glass",
             attr=[("material_class", "glass")],
             skipped=("R2/R4 residential luxe shaded lamps: same idea as R1; R3/R5 wood-base shaded lamps: "
                      "Staples already sells 5 (Adesso Elmore, Roman)")),
    ],
    "Lunch Bags & Boxes": [
        dict(rank=1, label="Stainless-steel commuter bento (adult)", framing="add", exemplar=1,
             attr=[("lunch_type", "bento"), ("material_class", "stainless")],
             staples_kw=r"stainless.*bento|bento.*stainless", comp_kw=r"stainless.*bento|bento.*stainless"),
        dict(rank=4, label="Cordless heated lunch box", framing="deepen",
             attr=[("lunch_type", "heated")],
             staples_kw=r"heated|electric|self.heating", comp_kw=r"heated|electric|self.heating",
             skipped="R2-R3 bento box: same idea as R1"),
    ],
    "Clocks & Timers": [
        dict(rank=1, label="Statement oversized wall clock", framing="deepen",
             attr=[("aesthetic_tags", "statement"), ("clock_type", "wall")],
             staples_kw=r"oversized|statement|large", comp_kw=r"oversized|statement|large"),
        dict(rank=4, label="Wood pendulum wall clock", framing="add",
             attr=[("clock_type", "pendulum")],
             staples_kw=r"pendulum", comp_kw=r"pendulum",
             skipped="R2-R3 patterned / floral wall clocks: same idea as R1"),
    ],
    "Office Partitions & Dividers": [
        dict(rank=1, label="Decorative folding screen (under $150)", framing="add", exemplar=1,
             attr=[("divider_type", "folding")], price_max=150,
             staples_kw=r"screen|privacy", comp_kw=r"screen|privacy"),
        dict(rank=4, label="Natural rattan / woven folding screen", framing="add", exemplar=1,
             attr=[("aesthetic_tags", "natural/woven")],
             staples_kw=r"rattan|wicker|woven|bamboo|paper", comp_kw=r"rattan|wicker|woven|bamboo|paper",
             skipped="R2-R3 folding screen dividers: same idea as R1"),
    ],
    "Coffee Organizers & Dispensers": [
        dict(rank=1, label="Bamboo / wood K-Cup pod drawer", framing="add",
             attr=[("organizer_type", "drawer"), ("material_class", "wood")],
             staples_kw=r"bamboo|wood", comp_kw=r"bamboo|wood"),
        dict(rank=4, label="Bamboo Nespresso pod drawer", framing="add", exemplar=1,
             attr=[("organizer_type", "drawer"), ("pod_system", "nespresso")],
             staples_kw=r"nespresso|vertuo", comp_kw=r"nespresso|vertuo",
             skipped=("R2 metal K-Cup pod drawer: Staples already sells a Keurig metal pod drawer; "
                      "R3 K-Cup station organizer: priced at 0.36x Staples' nearest item (undercut risk) "
                      "and Staples carries station organizers")),
    ],
}


def leaf(node_id):
    return node_id.split(" > ")[-1]


def pct(x):
    return None if pd.isna(x) else round(float(x) * 100)


def main():
    nodes = pd.read_csv(TABLES / "nodes.csv")
    final = pd.read_csv(TABLES / "final_archetypes.csv")
    skus = pd.read_csv(TABLES / "sku_recommendations.csv")
    gaps = pd.read_csv(TABLES / "attribute_gaps.csv")
    bands = pd.read_csv(TABLES / "price_bands.csv")
    vendors = pd.read_csv(TABLES / "vendor_view.csv")
    summary = pd.read_parquet(INTERIM / "node_summary.parquet")
    fams = pd.read_parquet(INTERIM / "families.parquet")
    ftab = pd.read_parquet(INTERIM / "family_table.parquet")[["family_id", "retailer", "node_id"]]

    # Family titles per node (Staples by leaf, competitors by their mapped node).
    fams = fams.drop(columns=["node_id"]).merge(ftab, on=["family_id", "retailer"], how="inner")
    attrs = (pd.read_parquet(INTERIM / "attributes.parquet").drop(columns=["node_id"], errors="ignore")
             .merge(ftab, on=["family_id", "retailer"]).drop_duplicates(["family_id", "retailer"])
             .merge(fams[["family_id", "retailer", "title"]].drop_duplicates(["family_id", "retailer"]),
                    on=["family_id", "retailer"], how="left"))

    def attr_hits(nid, retailer, p):
        x = attrs[(attrs.node_id == nid) & (attrs.retailer == retailer)]
        m = pd.Series(True, index=x.index)
        for col, sub in p.get("attr", []):
            m &= x[col].astype(str).str.contains(sub, case=False, regex=False)
        if "price_min" in p:
            m &= x.price >= p["price_min"]
        if "price_max" in p:
            m &= x.price < p["price_max"]
        return int(m.sum()), int(len(x)), list(x[m].title.fillna("").head(3).str[:70])

    rec = final[final.final_rank.notna()]
    facts = {"version": VERSION, "source": "report v20 run (outputs/tables, data/interim)"}

    # ---------- totals (all 12 nodes) ----------
    facts["totals"] = dict(
        nodes_scored=int((nodes.status == "scored").sum()),
        staples_families=int(nodes.n_staples.sum()),
        competitor_families=int(nodes.n_competitor.sum()),
        amazon_families=int(nodes[nodes.competitor == "amazon"].n_competitor.sum()),
        wayfair_families=int(nodes[nodes.competitor == "wayfair"].n_competitor.sum()),
        archetypes_built=int(len(final)),
        recommended=int(len(rec)),
        tiers={t: int(n) for t, n in rec.tier.value_counts().items()},
        rec_absent_at_staples=int((rec.n_staples == 0).sum()),
        rec_absent_share=pct((rec.n_staples == 0).mean()),
        stability_tg=None, stability_vos=None,
    )
    qa = json.loads((INTERIM / "qa_integration.json").read_text(encoding="utf-8"))
    facts["totals"]["qa_integration_keys"] = sorted(qa.keys())[:40]

    # ---------- per-node facts ----------
    def gap(node_id, attribute, value):
        g = gaps[(gaps.node_id == node_id) & (gaps.attribute == attribute) & (gaps.value == value)]
        if g.empty:
            return None
        r = g.iloc[0]
        return dict(st=pct(r.share_staples), co=pct(r.share_competitor),
                    cred=round(float(r.credibility), 3), descriptive=bool(r.descriptive_only == True))

    def band(node_id, name):
        b = bands[(bands.node_id == node_id) & (bands.band == name)]
        if b.empty:
            return None
        r = b.iloc[0]
        return dict(st=pct(r.share_staples), co=pct(r.share_competitor), cred=round(float(r.credibility), 3))

    node_facts = {}
    for nid in DECK_NODES:
        n = nodes[nodes.node_id == nid].iloc[0]
        s = summary[summary.node_id == nid].iloc[0]
        r = rec[rec.node_id == nid]
        node_facts[SHORT[leaf(nid)]] = dict(
            node_id=nid, leaf=leaf(nid), segment=n.segment, rank=int(n["rank"]),
            competitor=n.competitor.capitalize(),
            n_staples=int(n.n_staples), n_competitor=int(n.n_competitor),
            price_median_staples=round(float(s.price_median_staples), 2),
            price_median_competitor=round(float(s.price_median_competitor), 2),
            design_forward_staples=pct(s.design_forward_share_staples),
            design_forward_competitor=pct(s.design_forward_share_competitor),
            recommended=int(len(r)),
            tiers={t: int(k) for t, k in r.tier.value_counts().items()},
            bands={b.band: dict(st=pct(b.share_staples), co=pct(b.share_competitor),
                                cred=round(float(b.credibility), 3))
                   for b in bands[bands.node_id == nid].itertuples()},
        )
    facts["nodes"] = node_facts
    rec9 = rec[rec.node_id.isin(DECK_NODES)]
    facts["totals9"] = dict(recommended=int(len(rec9)), tiers={t: int(n) for t, n in rec9.tier.value_counts().items()},
                            absent_share=pct((rec9.n_staples == 0).mean()))

    # ---------- insight statistics (each with its source cell) ----------
    N = {SHORT[leaf(n)]: n for n in DECK_NODES}
    G = lambda k, a, v: gap(N[k], a, v)  # noqa: E731
    facts["stats"] = {
        # who they build for
        "desks_corporate": G("Office Desks", "use_context", "corporate office"),
        "chairs_reception": G("Accent Chairs", "use_context", "reception/lobby"),
        "chairs_commercial": G("Accent Chairs", "key_benefits", "commercial-grade"),
        "desks_commercial": G("Office Desks", "key_benefits", "commercial-grade"),
        "chairs_residential": G("Accent Chairs", "use_context", "residential living"),
        "lamps_residential": G("Desk Lamps", "use_context", "residential living"),
        "partitions_residential": G("Partitions", "use_context", "residential living"),
        "desks_home_office": G("Office Desks", "use_context", "home office"),
        "desks_remote": G("Office Desks", "end_user_segment", "remote workers"),
        "bp_hiking": G("Backpacks", "pack_type", "hiking/outdoor"),
        "bp_travel": G("Backpacks", "pack_type", "travel/carry-on"),
        "bp_laptop": G("Backpacks", "pack_type", "laptop/work"),
        "bp_men": G("Backpacks", "end_user_segment", "men"),
        "bp_women": G("Backpacks", "end_user_segment", "women"),
        "bp_kids": G("Backpacks", "audience", "kids"),
        "lunch_women": G("Lunch Bags", "end_user_segment", "women"),
        "lunch_teens": G("Lunch Bags", "end_user_segment", "teens"),
        # design & look
        "chairs_black": G("Accent Chairs", "colour_family", "black"),
        "chairs_light": G("Accent Chairs", "colour_tone", "light-neutral"),
        "chairs_beige": G("Accent Chairs", "colour_family", "beige/cream"),
        "chairs_cozy": G("Accent Chairs", "aesthetic_tags", "cozy/plush"),
        "chairs_armchair": G("Accent Chairs", "form_factor", "armchair"),
        "chairs_guest": G("Accent Chairs", "form_factor", "guest/side"),
        "coffee_black": G("Coffee Organizers", "colour_family", "black"),
        "coffee_wood": G("Coffee Organizers", "colour_family", "brown/wood"),
        "coffee_plastic": G("Coffee Organizers", "material_class", "plastic"),
        "coffee_bamboo": G("Coffee Organizers", "material_class", "wood/bamboo"),
        "coffee_nespresso": G("Coffee Organizers", "pod_system", "nespresso"),
        "coffee_corporate": G("Coffee Organizers", "use_context", "corporate office"),
        "partitions_woven": G("Partitions", "aesthetic_tags", "natural/woven"),
        "partitions_luxe": G("Partitions", "aesthetic_tags", "luxe"),
        "partitions_print": G("Partitions", "design", "print/photo"),
        "partitions_tackable": G("Partitions", "tackable", "yes"),
        "partitions_wheels": G("Partitions", "wheels", "yes"),
        "partitions_grey": G("Partitions", "colour_family", "grey"),
        "partitions_folding": G("Partitions", "divider_type", "folding screen"),
        "clocks_statement": G("Clocks", "aesthetic_tags", "statement"),
        "clocks_oversized": G("Clocks", "size_class", "oversized (20 in+)"),
        "clocks_plastic": G("Clocks", "material_class", "plastic/resin"),
        "clocks_atomic": G("Clocks", "atomic", "yes"),
        "clocks_modern": G("Clocks", "style_family", "modern"),
        "planners_leather": G("Planners", "material_class", "leather"),
        "planners_journal": G("Planners", "planner_type", "journal/guided"),
        "planners_plain": G("Planners", "design_theme", "plain"),
        "planners_art": G("Planners", "design_theme", "art/pattern"),
        "planners_business": G("Planners", "audience", "business/professional"),
        "planners_daily": G("Planners", "date_format", "daily"),
        "lunch_stainless": G("Lunch Bags", "material_class", "stainless steel"),
        "lunch_boho": G("Lunch Bags", "style_family", "boho/coastal"),
        "lunch_sustainable": G("Lunch Bags", "key_benefits", "sustainable"),
        # where they go deeper
        "lamps_shaded": G("Desk Lamps", "lamp_form", "shaded table-style"),
        "lamps_gooseneck": G("Desk Lamps", "lamp_form", "gooseneck/flex"),
        "lamps_usb": G("Desk Lamps", "usb_port", "yes"),
        "lamps_dimmable": G("Desk Lamps", "dimmable", "yes"),
        "lamps_wireless": G("Desk Lamps", "wireless_charging", "yes"),
        "lamps_tech": G("Desk Lamps", "key_benefits", "tech-enabled"),
        "lamps_tall": G("Desk Lamps", "size_class", "extra tall (26 in+)"),
        "lamps_luxe": G("Desk Lamps", "aesthetic_tags", "luxe"),
        "desks_narrow": G("Office Desks", "width_band", "<40 in"),
        "desks_wide": G("Office Desks", "width_band", "60-72 in"),
        "desks_luxe": G("Office Desks", "aesthetic_tags", "luxe"),
        "desks_writing": G("Office Desks", "desk_type", "writing/table"),
        "bp_comfort": G("Backpacks", "key_benefits", "comfort"),
        "bp_outdoor": G("Backpacks", "use_context", "outdoor"),
        "coffee_capacity": G("Coffee Organizers", "capacity_band", "30-49 pods"),
    }
    facts["bands"] = {
        "desks_u200": band(N["Office Desks"], "under $200"),
        "desks_200_350": band(N["Office Desks"], "$200–$350"),
        "desks_600p": band(N["Office Desks"], "$600+"),
        "partitions_u150": band(N["Partitions"], "under $150"),
        "partitions_150_450": band(N["Partitions"], "$150–$450"),
        "partitions_1000p": band(N["Partitions"], "$1,000+"),
        "clocks_u50": band(N["Clocks"], "under $50"),
        "clocks_125p": band(N["Clocks"], "$125+"),
        "lamps_175p": band(N["Desk Lamps"], "$175+"),
        "lamps_100_175": band(N["Desk Lamps"], "$100–$175"),
        "planners_u10": band(N["Planners"], "under $10"),
        "coffee_u15": band(N["Coffee Organizers"], "under $15"),
        "coffee_15_25": band(N["Coffee Organizers"], "$15–$25"),
        "coffee_30p": band(N["Coffee Organizers"], "$30+"),
        "chairs_250_350": band(N["Accent Chairs"], "$250–$350"),
        "lunch_u15": band(N["Lunch Bags"], "under $15"),
    }

    # ---------- sourcing (vendor view of the products the report shows) ----------
    v9 = vendors[vendors.node_id.isin(DECK_NODES)].copy()
    v9["comp"] = v9.node_id.map(lambda x: nodes.set_index("node_id").competitor[x])
    wv = v9[v9.comp == "wayfair"]
    av = v9[v9.comp == "amazon"]
    on_st = v9[v9.brand_on_staples == True]
    on_st_brands = sorted(set(b.strip() for b in on_st.brand.astype(str)), key=str.lower)
    # case-merge (AT-A-GLANCE / at-A-Glance)
    seen, merged = set(), []
    for b in on_st_brands:
        if b.lower() not in seen:
            seen.add(b.lower())
            merged.append(b)
    v_all = vendors.copy()
    on_all = v_all[v_all.brand_on_staples == True]
    seen_all = sorted({b.strip().lower() for b in on_all.brand.astype(str)})
    facts["sourcing"] = dict(
        wayfair_brands=int(len(wv)), wayfair_house=int(wv.house_brand.sum()),
        wayfair_house_share=pct(wv.house_brand.mean()),
        wayfair_house_examples=list(wv[wv.house_brand == True].sort_values("products", ascending=False)
                                    .brand.drop_duplicates().head(6)),
        amazon_brands=int(len(av)), amazon_house=int(av.house_brand.sum()),
        brands_on_staples_9=merged, brands_on_staples_9_n=len(merged),
        brands_on_staples_12_n=len(seen_all),
    )

    # ---------- picks ----------
    picks_out = {}
    for nid in DECK_NODES:
        short = SHORT[leaf(nid)]
        comp = nodes.set_index("node_id").competitor[nid]
        st_titles = fams[(fams.retailer == "staples") & (fams.node_id == nid)].title.fillna("")
        co_titles = fams[(fams.retailer == comp) & (fams.node_id == nid)].title.fillna("")
        out = []
        for p in PICKS[leaf(nid)]:
            a = rec[(rec.node_id == nid) & (rec.final_rank == p["rank"])].iloc[0]
            ex = skus[skus.archetype_id == a.archetype_id].sort_values("exemplar_rank")
            if "exemplar" in p:
                e = ex[ex.exemplar_rank == p["exemplar"]].iloc[0]
            else:
                exp = ex[ex.price.notna()].copy()
                exp["d"] = (exp.price - a.price_median_competitor).abs()
                e = exp.sort_values(["d", "exemplar_rank"]).iloc[0]
            a_st, a_st_n, a_st_ex = attr_hits(nid, "staples", p)
            a_co, a_co_n, _ = attr_hits(nid, comp, p)
            st_hit = st_titles[st_titles.str.contains(p["staples_kw"], case=False, regex=True)]
            co_hit = co_titles[co_titles.str.contains(p["comp_kw"], case=False, regex=True)]
            out.append(dict(
                attr_check=dict(spec=p.get("attr"), price_min=p.get("price_min"), price_max=p.get("price_max"),
                                staples_hits=a_st, staples_total=a_st_n, staples_examples=a_st_ex,
                                comp_hits=a_co, comp_total=a_co_n,
                                staples_share=round(100 * a_st / max(a_st_n, 1), 1),
                                comp_share=round(100 * a_co / max(a_co_n, 1), 1)),
                note=p.get("note"),
                final_rank=int(a.final_rank), label=p["label"], archetype=a["name"], combo=a.combo_full,
                tier=a.tier, framing=p["framing"],
                # attribute combination as shown on the slide: stated values only; empty defaults
                # ("Vibe: plain", "Audience: general") give no information, as in the archetype names
                combo_shown=" · ".join(x for x in a.combo_full.split(" · ")
                                       if "not stated" not in x and x not in ("Vibe: plain", "Audience: general")), skipped=p.get("skipped"),
                n_staples=int(a.n_staples), n_competitor=int(a.n_competitor),
                share_staples=round(float(a.p_staples) * 100, 1), share_competitor=round(float(a.p_competitor) * 100, 1),
                median_price_competitor=None if pd.isna(a.price_median_competitor) else round(float(a.price_median_competitor), 2),
                median_price_staples=None if pd.isna(a.price_median_staples) else round(float(a.price_median_staples), 2),
                final=round(float(a.final), 1), vos=round(float(a.vos), 1), tg=round(float(a.tg), 1),
                exemplar=dict(title=str(e.title), price=None if pd.isna(e.price) else float(e.price), url=e.url,
                              brand=None if pd.isna(e.brand) else str(e.brand), house_brand=bool(e.house_brand),
                              brand_on_staples=bool(e.brand_on_staples), m1_label=e.label, m2_label=e.m2_label,
                              basis=e.basis, nearest_staples=str(e.st_title), nearest_staples_price=
                              None if pd.isna(e.st_price) else float(e.st_price)),
                check=dict(staples_kw=p["staples_kw"], staples_hits=int(len(st_hit)), staples_total=int(len(st_titles)),
                           staples_examples=list(st_hit.head(3).str[:70]),
                           comp_hits=int(len(co_hit)), comp_total=int(len(co_titles)),
                           staples_hit_share=round(100 * len(st_hit) / max(len(st_titles), 1), 1),
                           comp_hit_share=round(100 * len(co_hit) / max(len(co_titles), 1), 1)),
            ))
        picks_out[short] = out
    facts["picks"] = picks_out

    out_path = Path(__file__).with_name(f"deck_facts_{VERSION}.json")
    out_path.write_text(json.dumps(facts, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print("wrote", out_path)

    # console audit of the picks
    for k, ps in picks_out.items():
        for p in ps:
            c = p["check"]
            ac = p["attr_check"]
            print(f"{k:18} R{p['final_rank']} {p['tier']:10} {p['label'][:42]:42} | ATTR St {ac['staples_hits']}/{ac['staples_total']} vs {ac['comp_share']}% | kw {c['staples_hits']}/{c['staples_total']}"
                  f" ({c['staples_hit_share']}%) vs comp {c['comp_hits']}/{c['comp_total']} ({c['comp_hit_share']}%)"
                  f" | ex ${p['exemplar']['price']} {p['exemplar']['title'][:50]} [{p['exemplar']['basis']}]")


if __name__ == "__main__":
    main()
