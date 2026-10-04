"""S0 Ingest & clean: retailer adapters -> one SKU table per retailer (methodology §5.1).

Only the Phase-1 columns are read (id, title, price, url, brand/vendor, selected choice, description, listing page
and its path), plus a competitor specification column where the adapter names one (Wayfair, Sai 2026-10-03).
Ratings, review counts, badges, ranks, list prices and images are ignored.
"""
from __future__ import annotations

import ast
import json
import re

import numpy as np
import pandas as pd
from ftfy import fix_text

from .common import interim, log, path, retailers, save


def _read_excel_cached(fname: str) -> pd.DataFrame:
    src = path("raw_dir") / fname
    cache = interim("raw_" + re.sub(r"\W+", "_", fname) + ".pkl")
    if cache.exists() and cache.stat().st_mtime > src.stat().st_mtime:
        return pd.read_pickle(cache)
    log(f"reading {fname}")
    df = pd.read_excel(src, sheet_name=0)
    df.to_pickle(cache)
    return df


def parse_price(v) -> tuple[float, bool]:
    """'$1,099.99' -> 1099.99. Strings without a $ amount ('2 sizes', '1 text input') are not prices."""
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return np.nan, False
    if isinstance(v, (int, float)):
        return float(v), False
    s = str(v)
    per_item = "per item" in s.lower()
    mt = re.search(r"\$\s*([\d,]+(?:\.\d+)?)", s)
    if mt is None:
        mt = re.fullmatch(r"\s*([\d,]+(?:\.\d+)?)\s*", s)
    return (float(mt.group(1).replace(",", "")) if mt else np.nan), per_item


_MOJIBAKE = {"â„¢": "™", "â€™": "'", "â€œ": '"', "â€\x9d": '"', "â€“": "–", "â€”": "—", "Â®": "®", "Â°": "°"}


def _clean(s) -> str:
    if s is None or (isinstance(s, float) and np.isnan(s)):
        return ""
    s = str(s)
    for bad, good in _MOJIBAKE.items():
        s = s.replace(bad, good)
    return re.sub(r"\s+", " ", fix_text(s)).strip()


def parse_staples_description(raw) -> tuple[str, str, dict]:
    """-> (paragraph text, bullets joined, {spec name: value})"""
    if not isinstance(raw, str) or not raw.startswith("{"):
        return _clean(raw), "", {}
    try:
        d = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return _clean(raw), "", {}
    para = " ".join(_clean(p) for p in d.get("paragraph", []) or [])
    bullets = " • ".join(_clean(b) for b in d.get("bullets", []) or [])
    specs = {}
    for sp in d.get("specification", []) or []:
        name, val = _clean(sp.get("name")), _clean(sp.get("value"))
        if name and val and name not in specs:
            specs[name] = val
    return para, bullets, specs


def parse_pipe_specs(raw) -> dict:
    """'Product Type: Armoire Desk | Overall Shape: Rectangle' -> {name: value}"""
    out = {}
    for part in _clean(raw).split(" | "):
        if ":" in part:
            k, v = part.split(":", 1)
            k, v = k.strip(), v.strip()
            if k and v and k not in out:
                out[k] = v
    return out


def _path(r: dict, cols: list[str]) -> list[str]:
    return [_clean(r[k]) for k in cols if isinstance(r.get(k), str) and r[k].strip()]


def ingest_staples(ad: dict) -> pd.DataFrame:
    raw = _read_excel_cached(ad["file"])
    c = ad["columns"]
    raw = raw.drop_duplicates()
    rows = []
    for r in raw.to_dict("records"):
        levels = _path(r, ad["path_columns"])
        para, bullets, specs = parse_staples_description(r.get(c["description"]))
        price, per_item = parse_price(r.get(c["price"]))
        rows.append({
            "retailer": "staples",
            "sku_id": str(r[c["id"]]),
            "title": _clean(r[c["title"]]),
            "price": price, "per_item_price": per_item,
            "url": str(r.get(c["url"]) or ""),
            "model": _clean(r.get(c["model"])),
            "desc": para, "bullets": bullets, "specs": json.dumps(specs, ensure_ascii=False),
            "leaf_path": " > ".join(levels),
            "l2_key": " > ".join(levels[:2]),
            "leaf": _clean(r[ad["leaf_column"]]),
        })
    df = pd.DataFrame(rows)
    # a SKU listed under several leaves keeps its first leaf as primary (secondary kept for reference)
    sec = df.groupby("sku_id")["leaf_path"].agg(lambda s: "|".join(sorted(set(s))[1:]) if s.nunique() > 1 else "")
    df = df.drop_duplicates("sku_id", keep="first").copy()
    df["secondary_leaves"] = df["sku_id"].map(sec).fillna("")
    return df


def clean_vendor(v, ad: dict) -> str:
    s = re.sub(r"[®™]", "", _clean(v)).strip()
    for rx in ad.get("vendor_strip") or []:
        s = re.sub(rx, "", s, flags=re.I).strip()
    if any(re.search(rx, s, flags=re.I) for rx in ad.get("vendor_junk") or []):
        return ""
    return s


def ingest_competitor(name: str, ad: dict) -> pd.DataFrame:
    raw = _read_excel_cached(ad["file"])
    c = ad["columns"]
    raw = raw.drop_duplicates()
    raw = raw[raw[c["id"]].notna() & raw[c["title"]].notna()]
    rows = []
    for r in raw.to_dict("records"):
        desc_full = _clean(r.get(c["description"]))
        # right of " | " = customer review with name, city, date (PII): dropped, never used
        desc = desc_full.split(" | ")[0] if ad.get("description_format") == "text_with_review" else desc_full
        levels = []
        for k in ad.get("path_columns") or []:
            v = r.get(k)
            if isinstance(v, str) and v.strip():
                for bad, good in (ad.get("page_name_fixes") or {}).items():   # before whitespace is collapsed
                    v = v.replace(bad, good)
                levels.append(_clean(v))
        page_name = str(r[c["page"]])
        for bad, good in (ad.get("page_name_fixes") or {}).items():
            page_name = page_name.replace(bad, good)
        page_name = _clean(page_name)
        page = " > ".join(levels) if levels else page_name      # the page is identified by its full path
        price, per_item = parse_price(r.get(c["price"]))
        pid = str(r[c["id"]]).strip()
        url = ad["url_template"].format(id=pid) if ad.get("url_template") else str(r.get(c["url"]) or "")
        rows.append({
            "retailer": name,
            "sku_id": pid,
            "title": _clean(r[c["title"]]),
            "price": price, "per_item_price": per_item,
            "url": url,
            "vendor": clean_vendor(r.get(c["vendor"]), ad) if c.get("vendor") else "",
            "choice": _clean(r.get(c["choice"])) if c.get("choice") else "",
            "desc": desc, "bullets": "",
            "specs": json.dumps(parse_pipe_specs(r.get(c["specs"])) if c.get("specs") else {}, ensure_ascii=False),
            "page": page, "page_name": page_name,
            "had_review_text": ad.get("description_format") == "text_with_review" and " | " in desc_full,
        })
    return pd.DataFrame(rows)


def run() -> dict:
    stats = {}
    for name, ad in retailers().items():
        if not (path("raw_dir") / ad["file"]).exists():
            log(f"S0 {name}: file not found ({ad['file']}), skipped")
            continue
        df = ingest_staples(ad) if ad["role"] == "base" else ingest_competitor(name, ad)
        save(df, f"sku_{name}.parquet")
        stats[name] = {"rows": int(len(df)), "skus": int(df["sku_id"].nunique()),
                       "price_missing": int(df["price"].isna().sum())}
        log(f"S0 {name}: {stats[name]}")
    return stats
