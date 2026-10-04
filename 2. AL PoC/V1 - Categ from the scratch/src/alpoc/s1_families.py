"""S1 Families & nodes (methodology §5.2, §14). The family is the counting unit everywhere.

One grouping rule for every retailer: same brand + same name stem (title without the model code and without
short segments that only name a colour). Staples lists each colour as its own SKU; in Phase 2 Amazon and Wayfair
do too (Wayfair: same title + vendor, different selected_choice). Competitor variants merge only when their
descriptions also start the same, because house-brand titles are generic ("Metal Desk Lamp").

The analysis node of a Staples family is its Staples leaf (the Phase-2 focus L3/L4). There are no pseudo-L5
splits any more; competitor families get their node in S2.
"""
from __future__ import annotations

import json
import re
from collections import Counter

import numpy as np
import pandas as pd

from .common import cfg, hash_text, load, load_yaml, log, retailers, save
from .vocab import colour_family, matcher

COLOUR_SPEC_KEYS = ["Color Family", "Furnishing Color", "True Color"]
_SEP = re.compile(r",| - | \| | – | — ")
_YEAR = re.compile(r"^(?:20\d\d(?:\s*[-–/]\s*20\d\d)*\s+)+")
_GENERIC = {"the", "new", "large", "small", "mini", "kids", "women", "men", "womens", "mens", "set", "pack", "desk",
            "wall", "coffee", "lunch", "planner", "modern", "vintage", "a", "an", "with", "for", "and", "led", "metal",
            "day", "eco", "five", "hello", "lady", "freestanding", "reusable", "magnetic", "premium", "portable",
            "classic", "see", "house", "national", "case", "durable", "custom", "personalized", "original", "home",
            "office", "travel", "kids'", "baby", "adult", "cute", "funny", "decorative", "small", "big", "extra",
            "space", "studio", "tech", "three", "undated", "dated", "weekly", "monthly", "daily"}


def _strip_model(title: str) -> str:
    return re.sub(r"\s*\([^()]*\)\s*$", "", title).strip()


def _is_colour_segment(seg: str) -> bool:
    return bool(colour_family(seg)) and len(seg.split()) <= 5


def name_stem(title: str) -> str:
    """Title without trailing (MODEL) and without short segments that only name a colour / finish."""
    parts = [p.strip() for p in _SEP.split(_strip_model(title))]
    keep = [parts[0]] + [p for p in parts[1:] if p and not _is_colour_segment(p)]
    return re.sub(r"\s+", " ", ", ".join(keep)).lower()


def title_brands(titles: pd.Series) -> dict:
    """Brand = longest 1-3 word prefix still shared by >= 60% of the one-word prefix group (leading years skipped)."""
    stripped = titles.map(lambda t: _YEAR.sub("", t))
    words = stripped.str.split()
    pre = {k: Counter(" ".join(w[:k]) for w in words if len(w) >= k) for k in (1, 2, 3)}
    out = {}
    for t, w in zip(titles, words):
        b = w[0] if w else ""
        base = pre[1].get(b, 0)
        for k in (2, 3):
            if len(w) >= k and pre[k][" ".join(w[:k])] >= max(3, 0.6 * base):
                b = " ".join(w[:k])
        out[t] = b
    return out


def clean_title(title: str, brand: str) -> str:
    t = _YEAR.sub("", _strip_model(title))
    if brand and t.lower().startswith(brand.lower()):
        t = t[len(brand):]
    parts = [p.strip() for p in _SEP.split(t)]
    keep = [parts[0]] + [p for p in parts[1:] if p and not _is_colour_segment(p)]
    return re.sub(r"\s+", " ", ", ".join(keep)).strip(" ,-")


def title_colours(title: str) -> list[str]:
    segs = _SEP.split(_strip_model(title))[1:] + re.findall(r"\(([^()]*)\)\s*$", title)
    return [c for c in (colour_family(s) for s in segs if _is_colour_segment(s)) if c]


def sku_colour(specs: dict, title: str) -> str | None:
    for k in COLOUR_SPEC_KEYS:
        if specs.get(k):
            c = colour_family(specs[k])
            if c:
                return c
    tc = title_colours(title)
    return tc[0] if tc else None


def families_staples() -> pd.DataFrame:
    sku = load("sku_staples.parquet")
    sku["specs_d"] = sku["specs"].map(json.loads)
    brands = title_brands(sku["title"])
    sku["brand"] = sku["title"].map(brands)
    sku["stem"] = sku["title"].map(name_stem)
    sku["family_id"] = [("S_" + hash_text(lp + "|" + st)[:12]) for lp, st in zip(sku["leaf_path"], sku["stem"])]
    sku["colour"] = [sku_colour(s, t) for s, t in zip(sku["specs_d"], sku["title"])]
    rows = []
    for fid, g in sku.groupby("family_id", sort=False):
        rep = g.iloc[0]
        merged = {}
        for d in g["specs_d"]:                       # representative first, then fill gaps
            for k, v in d.items():
                merged.setdefault(k, v)
        colours = sorted({c for c in g["colour"] if isinstance(c, str)})
        rows.append({
            "retailer": "staples", "family_id": fid,
            "title": rep["title"], "title_clean": clean_title(rep["title"], rep["brand"]),
            "brand": rep["brand"], "brand_inferred": True,
            "price": float(np.nanmedian(g["price"])) if g["price"].notna().any() else np.nan,
            "url": rep["url"], "desc": rep["desc"], "bullets": rep["bullets"],
            "specs": json.dumps(merged, ensure_ascii=False),
            "colours_observed": "|".join(colours), "n_colourways": max(1, len(colours)),
            "n_skus": len(g), "sku_ids": "|".join(g["sku_id"]),
            "leaf_path": rep["leaf_path"], "leaf": rep["leaf"], "l2_key": rep["l2_key"],
            "node_id": rep["leaf_path"], "choice": "", "pages": "",
        })
    return pd.DataFrame(rows)


def families_competitor(name: str, staples_brands: set) -> pd.DataFrame:
    sku = load(f"sku_{name}.parquet")
    house = {b.lower() for b in (load_yaml("house_brands.yaml").get(name) or [])}
    k = cfg()["families"]["competitor_desc_prefix"]
    # one row per product id first (a product can sit on several listing pages)
    per_id = sku.groupby("sku_id", sort=False).agg(
        title=("title", "first"), vendor=("vendor", "first"), price=("price", "median"), url=("url", "first"),
        desc=("desc", lambda s: max(s, key=len)), specs=("specs", lambda s: max(s, key=len)), choices=("choice", lambda s: sorted({c for c in s if c})),
        pages=("page", lambda s: sorted(set(s)))).reset_index()
    # a title prefix is only accepted as a brand when it is a known brand (a Staples brand or a vendor this retailer
    # shows elsewhere); Amazon titles often start with generic words ("Coffee Pod", "2 Pack")
    missing = per_id["vendor"] == ""
    known = staples_brands | {v.lower() for v in per_id["vendor"] if _brand_ok(v)}
    inferred = title_brands(per_id.loc[missing, "title"]) if missing.any() else {}
    per_id["brand_inferred"] = missing
    per_id["brand"] = [(inferred.get(t, "") if inferred.get(t, "").lower() in known else "") if m_ else v
                       for t, v, m_ in zip(per_id["title"], per_id["vendor"], missing)]
    per_id["stem"] = per_id["title"].map(name_stem)
    per_id["fam_key"] = [f"{name}|{b.lower()}|{s}|{d[:k].lower()}" for b, s, d in
                         zip(per_id["brand"], per_id["stem"], per_id["desc"])]
    rows = []
    for key, g in per_id.groupby("fam_key", sort=False):
        rep = g.iloc[0]
        choices = sorted({c for cs in g["choices"] for c in cs})
        colours = sorted({c for c in (colour_family(x) for x in choices) if c}
                         | {c for t in g["title"] for c in title_colours(t)})
        rows.append({
            "retailer": name, "family_id": f"{name[:1].upper()}_{hash_text(key)[:12]}",
            "title": rep["title"], "title_clean": clean_title(rep["title"], rep["brand"]),
            "brand": rep["brand"], "brand_inferred": bool(rep["brand_inferred"]),
            "house_brand": rep["brand"].lower() in house,
            "price": float(np.nanmedian(g["price"])) if g["price"].notna().any() else np.nan,
            "url": rep["url"], "desc": rep["desc"], "bullets": "", "specs": rep["specs"],
            "choice": " / ".join(choices),
            "colours_observed": "|".join(colours), "n_colourways": max(1, len(colours)),
            "n_skus": len(g), "sku_ids": "|".join(g["sku_id"]),
            "pages": "|".join(sorted({p for ps in g["pages"] for p in ps})),
            "leaf_path": "", "leaf": "", "l2_key": "", "node_id": None,
        })
    return pd.DataFrame(rows)


def _brand_ok(b: str) -> bool:
    """Plausible brand: not a number, not a generic word; a single word must not be a colour or material word."""
    if not b or len(b) < 3 or not re.search(r"[A-Za-z]{2,}", b) or b.lower() in _GENERIC:
        return False
    if len(b.split()) == 1 and (colour_family(b) or matcher("material_class").first(b)):
        return False
    return True


def run() -> dict:
    fs = families_staples()
    stats = {"staples": {"skus": int(fs["n_skus"].sum()), "families": len(fs)}}
    frames = [fs]
    st_brands = {b.lower() for b in fs["brand"] if _brand_ok(b)}
    for name, ad in retailers().items():
        if ad["role"] == "competitor":
            try:
                fc = families_competitor(name, st_brands)
            except FileNotFoundError:
                continue
            stats[name] = {"products": int(fc["n_skus"].sum()), "families": len(fc),
                           "multi_page": int((fc["pages"].str.count(r"\|") > 0).sum())}
            frames.append(fc)
    fam = pd.concat(frames, ignore_index=True)
    fam["house_brand"] = fam["house_brand"].fillna(False).astype(bool)
    # brand_on_staples: the competitor display brand also starts Staples titles (existing supplier)
    st_titles = fs["title"].map(lambda t: _YEAR.sub("", t).lower())
    brand_hits = {}
    for b in fam.loc[fam["retailer"] != "staples", "brand"].dropna().unique():
        bl = b.lower().strip()
        brand_hits[b] = _brand_ok(b) and (bl in st_brands or bool(st_titles.str.startswith(bl + " ").any()))
    fam["brand_on_staples"] = (fam["retailer"] != "staples") & fam["brand"].map(brand_hits).fillna(False).astype(bool)
    save(fam, "families.parquet")
    log(f"S1 families: {stats}")
    return stats
