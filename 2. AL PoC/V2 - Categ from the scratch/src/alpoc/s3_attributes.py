"""S3 Attribute schema + extraction + validation (methodology §6.1-6.2, §14). Phase-1 S4/S5.

Instrument: backend 'rules' = controlled-vocabulary matchers + embedding zero-shot (local, no API).
Rules (§6.2.2):
  * physical facts (colour, material, Tier-2 with a spec key, numbers): Staples = spec if present, else text;
    competitor = text. A Tier-2 field marked `spec_role: indicator` is measured by text on both sides (the Staples
    spec vocabulary differs from product copy) and its spec is used for validation only.
  * style, Tier-3 lifestyle fields, yes/no "mentioned" features and DFI: the SAME text instrument on both sides.
  * full text (Sai, 2026-10-03; replaced text parity): every field reads ALL available text, uncut.
    Staples = title + paragraph + bullets + specification values; Amazon = title + description; Wayfair = name +
    selected choice + description (review part dropped) + specifications. Amazon has the least text, so its
    "not stated" share is higher; shares are compared, and the report says so.
  * G2: the text instrument is run on Staples title + paragraph + bullets (full, no specs: not circular) and scored
    against Staples specs; fields below the accuracy bar are 'descriptive only' and kept out of gap metrics and
    archetype grids.
"""
from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd

from . import embed
from .cards import neutral_card, tier2_attrs
from .common import cfg, load, log, node_config, pct_of, save, save_json
from .s2_mapping import mapping_card
from .vocab import Matcher, colour_tone, matcher, universal

MULTI_ATTRS = ["aesthetic_tags", "use_context", "end_user_segment", "key_benefits"]
COLOUR_SPEC_KEYS = ["Color Family", "Furnishing Color", "True Color"]
DIM_SPEC = {"width": ["Width in Inches"], "depth": ["Depth in Inches"], "height": ["Height in Inches"],
            "capacity": ["Maximum Weight Capacity (Lbs)", "Capacity (lbs.)"], "diameter": ["Diameter in Inches"]}
_U = r'(?:"|”|″|\'\'|in\.?|inches|-inch)?'
RX_TRIPLE = re.compile(rf"(\d+(?:\.\d+)?)\s*{_U}\s*W\s*x\s*(\d+(?:\.\d+)?)\s*{_U}\s*(?:D|L)\s*x?\s*(\d+(?:\.\d+)?)\s*{_U}\s*H\b", re.I)
RX_DIM = {
    "width": re.compile(rf"(\d+(?:\.\d+)?)\s*{_U}\s*(?:W\b|wide\b|width\b)|\bwidth\s*[:\-]?\s*(\d+(?:\.\d+)?)", re.I),
    "depth": re.compile(rf"(\d+(?:\.\d+)?)\s*{_U}\s*(?:D\b|deep\b|depth\b)|\bdepth\s*[:\-]?\s*(\d+(?:\.\d+)?)", re.I),
    "height": re.compile(rf"(\d+(?:\.\d+)?)\s*{_U}\s*(?:H\b|high\b|tall\b|height\b)|\bheight\s*[:\-]?\s*(\d+(?:\.\d+)?)", re.I),
    "diameter": re.compile(rf"(\d+(?:\.\d+)?)\s*{_U}\s*(?:dia\.?\b|diameter\b|round\b)|\bdiameter\s*[:\-]?\s*(\d+(?:\.\d+)?)", re.I),
}
_IN = r'(?:"|”|″|\'\'|in\b\.?|inch(?:es)?\b)'
RX_PLAIN3 = re.compile(rf"(\d+(?:\.\d+)?)\s*{_IN}?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*{_IN}?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*{_IN}", re.I)
RX_PLAIN2 = re.compile(rf"(\d+(?:\.\d+)?)\s*{_IN}?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*{_IN}", re.I)
RX_CAP = re.compile(r"(?:capacity|supports?|holds?|up to)[^.\d]{0,30}(\d{2,4})\s*(?:lbs?|pounds)\b", re.I)


def _nan(v) -> bool:
    return v is None or (isinstance(v, float) and np.isnan(v))


def spec_text(specs: dict) -> str:
    """Specification values as text. Only the VALUE is added ("Chair Type: Guest" -> "Guest"), because spec names
    hold category words ("Accent & Waiting Room Chair Type"); the name is added only for an affirmative value
    ("Water Resistant: Yes" -> "Water Resistant"); negative values are left out ("No", "Non Gaming",
    "Non-Antimicrobial", "Not Included")."""
    ex = cfg()["extraction"]
    neg = {v.lower() for v in ex.get("spec_negative_values", [])}
    yes = {v.lower() for v in ex.get("spec_affirmative_values", ["yes", "true", "y"])}
    out = []
    for k, v in specs.items():
        v = str(v).strip()
        lv = v.lower()
        if not v or lv in neg or re.match(r"^(?:non|not|no|without)\b|^non-", lv):
            continue
        out.append(k if lv in yes else v)
    return "; ".join(out)


def sources(r, specs: dict) -> tuple[list, list]:
    """(full sources, validation sources): [(name, text, confidence)] in precedence order. Full = all text, uncut,
    incl. specification values; validation = Staples title + paragraph + bullets (no specs, so G2 is not circular)."""
    st = spec_text(specs)
    if r["retailer"] == "staples":
        val = [("title", r["title"], 0.9), ("bullets", r["bullets"], 0.75), ("desc", r["desc"], 0.6)]
        return val + [("specs", st, 0.55)], val
    full = [("title", r["title"], 0.9), ("choice", r["choice"], 0.85), ("desc", r["desc"], 0.6), ("specs", st, 0.55)]
    return full, full


def text_dims(text: str) -> dict:
    out = {}
    mt = RX_TRIPLE.search(text)
    if mt:
        out = {"width": float(mt.group(1)), "depth": float(mt.group(2)), "height": float(mt.group(3))}
    labelled_w = RX_DIM["width"].search(text)
    if not out and not labelled_w:
        # unlabelled "A x B x C in" / "A x B in": first = width, second = depth (, third = height)
        m3 = RX_PLAIN3.search(text)
        m2 = None if m3 else RX_PLAIN2.search(text)
        nums = [float(x) for x in (m3 or m2).groups()] if (m3 or m2) else []
        if nums and all(3 <= v <= 150 for v in nums):
            out = dict(zip(("width", "depth", "height"), nums))
    for k, rx in RX_DIM.items():
        if k not in out:
            mt = rx.search(text)
            if mt:
                v = float(mt.group(1) or mt.group(2))
                if 3 <= v <= 150:
                    out[k] = v
    mt = RX_CAP.search(text)
    if mt:
        out["capacity"] = float(mt.group(1))
    return out


def spec_number(specs: dict, keys: list[str]):
    for k in keys or []:
        if k in specs:
            mt = re.search(r"\d+(?:\.\d+)?", specs[k].replace(",", ""))
            if mt:
                return float(mt.group(0))
    return np.nan


def text_number(text: str, regexes: list[str], lo: float, hi: float):
    for rx in regexes or []:
        for mt in re.finditer(rx, text, flags=re.I):
            g = next((x for x in mt.groups() if x), None)
            if g is not None and lo <= float(g) <= hi:
                return float(g)
    return np.nan


def spec_value(specs: dict, keys: list[str], mt: Matcher, spec_map: dict | None = None):
    for k in keys or []:
        if k in specs:
            raw = specs[k]
            if spec_map and raw in spec_map:
                return spec_map[raw]
            v = mt.first(raw)
            if v:
                return v
    return None


def _band(x, bands: dict):
    if _nan(x):
        return None
    for label, (lo, hi) in bands.items():
        if float(lo) <= x < float(hi):
            return label
    return None


def extract_node(df: pd.DataFrame, nid: str) -> tuple[pd.DataFrame, dict]:
    nc = node_config(nid)
    ex = cfg()["extraction"]
    col_m, mat_m, sty_m = matcher("colour_family", nid), matcher("material_class", nid), matcher("style_family", nid)
    tier2 = {k: (Matcher(v["values"], v.get("mode", "priority")), v) for k, v in (nc.get("tier2") or {}).items()}
    tier3 = {k: (Matcher(v["values"], v.get("mode", "priority")), v) for k, v in (nc.get("tier3") or {}).items()}
    numeric = nc.get("numeric") or {}
    col_keys = nc.get("colour_spec_keys") or COLOUR_SPEC_KEYS
    mat_keys = nc.get("material_spec_keys") or ["Furnishing Material"]
    mat_map = nc.get("material_spec_map")
    sty_map = universal()["style_family"]["spec_style_map"]
    tag_order = list(universal()["aesthetic_tags"]["values"].keys())
    rows, val_rows = [], []
    for _, r in df.iterrows():
        specs = json.loads(r["specs"] or "{}")
        full, val = sources(r, specs)
        is_st = r["retailer"] == "staples"
        o = {"family_id": r["family_id"]}

        # colour (physical): titles put the colour variant last, so read title segments from the end
        t_col, t_col_src = None, None
        for seg in reversed(re.sub(r"\([^()]*\)\s*$", "", r["title"]).split(",")):
            t_col = col_m.first(seg)
            if t_col:
                t_col_src = "title"
                break
        if not t_col:
            t_col, t_col_src, _ = col_m.from_sources(val[1:])
        s_col = spec_value(specs, col_keys, col_m) if is_st else None
        f_col = t_col or col_m.from_sources(full[1:])[0]
        o["colour_family"] = s_col or f_col
        o["colour_src"] = "spec" if s_col else t_col_src
        o["txt_colour_family"] = t_col
        # material (physical)
        t_mat, t_mat_src, _ = mat_m.from_sources(val)
        s_mat = spec_value(specs, mat_keys, mat_m, mat_map) if is_st else None
        o["material_class"] = s_mat or mat_m.from_sources(full)[0]
        o["material_src"] = "spec" if s_mat else t_mat_src
        o["txt_material_class"] = t_mat
        # style (same instrument both sides; spec only as a validation indicator)
        t_sty = sty_m.from_sources(val)[0]
        o["style_family"], o["style_src"], _ = sty_m.from_sources(full)
        # Tier 3 universal multi-label (same instrument) + derived single-valued vibe
        for a in MULTI_ATTRS:
            o[a] = matcher(a, nid).from_sources(full)[0]
        tags = set(o["aesthetic_tags"].split("|")) if o["aesthetic_tags"] else set()
        o["vibe"] = next((t for t in tag_order if t in tags), "plain")
        # Tier 3 node-specific (same instrument; spec = indicator)
        for a, (mt, spec) in tier3.items():
            o[a] = mt.from_sources(full)[0] or spec.get("default")
            o["txt_" + a] = mt.from_sources(val)[0] or spec.get("default")
            if is_st and spec.get("spec_keys"):
                sv = spec_value(specs, spec["spec_keys"], mt, spec.get("spec_map"))
                if sv:
                    val_rows.append((a + " (indicator)", sv, o["txt_" + a]))
        # Tier 2 functional
        for a, (mt, spec) in tier2.items():
            tv = mt.from_sources(val)[0]
            fv = mt.from_sources(full)[0]
            sv = spec_value(specs, spec.get("spec_keys"), mt, spec.get("spec_map")) if is_st else None
            if set(mt.values) == {"yes"}:
                # text can only ever find "yes": measure "feature mentioned" with the same instrument on
                # both sides (yes / no); the Staples spec is used for validation only
                o[a] = fv or "no"
                o["txt_" + a] = tv or "no"
                if is_st and sv:
                    val_rows.append((a, sv, o["txt_" + a]))
                continue
            if spec.get("spec_role") == "indicator":
                o[a] = fv or spec.get("default")
                o["txt_" + a] = tv or spec.get("default")
                if is_st and sv:
                    val_rows.append((a + " (indicator)", sv, tv))
                continue
            o[a] = sv or fv or spec.get("default")
            o["txt_" + a] = tv or spec.get("default")
            if is_st and sv and spec.get("spec_keys"):
                val_rows.append((a, sv, tv))
        # numbers (physical): built-in dimensions + node-specific numeric fields
        full_text = " ".join(t for _, t, _ in full if t)
        val_text = " ".join(t for _, t, _ in val if t)
        fd, pdm = text_dims(full_text), text_dims(val_text)
        for d, keys in DIM_SPEC.items():
            sv = spec_number(specs, keys) if is_st else np.nan
            o[d] = sv if not np.isnan(sv) else fd.get(d, np.nan)
            o["spec_" + d] = sv
            o["txt_" + d] = pdm.get(d, np.nan)
            if is_st and not np.isnan(sv) and d in ("width", "depth", "height", "diameter"):
                val_rows.append((d, sv, pdm.get(d)))
        for a, spec in numeric.items():
            lo, hi = float(spec.get("min", -1e9)), float(spec.get("max", 1e9))
            sv = spec_number(specs, spec.get("spec_keys")) if is_st else np.nan
            sv = sv if (not np.isnan(sv) and lo <= sv <= hi) else np.nan
            tv = text_number(val_text, spec.get("text_regex"), lo, hi)
            o[a] = sv if not np.isnan(sv) else text_number(full_text, spec.get("text_regex"), lo, hi)
            o["spec_" + a] = sv
            o["txt_" + a] = tv
            if is_st and not np.isnan(sv):
                val_rows.append((a, sv, None if np.isnan(tv) else tv))
        if is_st:
            val_rows.append(("colour_family", s_col, t_col))
            val_rows.append(("colour_tone", colour_tone(s_col), colour_tone(t_col)))
            val_rows.append(("material_class", s_mat, t_mat))
            raw_sty = next((specs[k] for k in universal()["style_family"].get("spec_style_keys", []) if k in specs), None)
            val_rows.append(("style_family (indicator)", sty_map.get(raw_sty), t_sty))
        rows.append(o)
    att = pd.DataFrame(rows)
    size_cfg = nc["size_bands"] if "size_bands" in nc else {"source": "width", "bands": universal()["size_class_by_width"]}
    for pre in ("", "txt_"):
        att[pre + "colour_tone"] = att[pre + "colour_family"].map(colour_tone)
        for band_name, spec in (nc.get("numeric_bands") or {}).items():
            att[pre + band_name] = att[pre + spec["source"]].map(lambda x, b=spec["bands"]: _band(x, b))
        att[pre + "size_class"] = (att[pre + size_cfg["source"]].map(lambda x: _band(x, size_cfg["bands"]))
                                   if size_cfg else None)
    # numeric-band validation (Staples spec band vs text band)
    for band_name, spec in list((nc.get("numeric_bands") or {}).items()) + ([("size_class", size_cfg)] if size_cfg else []):
        src = "spec_" + spec["source"]
        if src not in att.columns:
            continue
        for sv_num, tv in zip(att[src], att["txt_" + band_name]):
            sv = _band(sv_num, spec["bands"])
            if sv:
                val_rows.append((band_name, sv, tv))

    # style zero-shot for families without a style keyword (same instrument both sides)
    cards = [mapping_card(r) for _, r in df.iterrows()]
    if nc.get("style_zero_shot", ex["style_zero_shot"]):
        E = embed.encode(cards)
        protos = universal()["style_family"]["zero_shot_prototypes"]
        P = embed.encode(list(protos.values()))
        sims = E @ P.T
        order = np.argsort(-sims, axis=1)
        names = list(protos.keys())
        for i in np.where(att["style_family"].isna())[0]:
            a, b = order[i, 0], order[i, 1]
            if sims[i, a] - sims[i, b] >= ex["style_zero_shot_margin"]:
                att.at[i, "style_family"] = names[a]
                att.at[i, "style_src"] = "zero-shot"
    # Design-Forward Index: anchor contrast on the source-neutral card, then pooled percentile within the node
    anchors = nc.get("dfi_anchors") or universal()["generic_dfi_anchors"]
    D = embed.encode(anchors["design"]).mean(axis=0)
    U = embed.encode(anchors["utility"]).mean(axis=0)
    tmp = att.assign(node_id=nid)
    En = embed.encode([neutral_card(r, tier2_attrs(nid)) for _, r in tmp.iterrows()])
    att["dfi_raw"] = En @ D - En @ U
    att["dfi"] = pct_of(att["dfi_raw"].values, att["dfi_raw"].values)

    # validation table (Staples text instrument on title + paragraph + bullets vs Staples spec)
    val = {}
    for field in sorted({v[0] for v in val_rows}):
        pairs = [(s, t) for f, s, t in val_rows if f == field and not _nan(s)]
        if not pairs:
            continue
        known = [(s, t) for s, t in pairs if not _nan(t)]
        if field in ("width", "depth", "height", "diameter") or field in numeric:
            acc = np.mean([abs(t - s) <= 0.05 * max(s, 1) + 0.5 for s, t in known]) if known else np.nan
        else:
            acc = np.mean([s == t for s, t in known]) if known else np.nan
        val[field] = {"n_spec": len(pairs), "text_coverage": len(known) / len(pairs),
                      "accuracy_when_found": float(acc) if known else None}
    return att, val


def run() -> dict:
    nodes = load("nodes.parquet")
    fam = load("families.parquet")
    mp = load("mapping.parquet")
    comp_assign = mp.loc[mp["status"] == "mapped", ["family_id", "node_id"]]
    st = fam[fam["retailer"] == "staples"][["family_id", "node_id"]]
    assign = pd.concat([st, comp_assign])
    df = fam.drop(columns=["node_id"]).merge(assign, on="family_id", how="inner")
    df = df[df["node_id"].isin(nodes["node_id"])]
    node_l2 = nodes.set_index("node_id")["l2_key"]
    g2_min = cfg()["qa"]["g2_field_acc"]
    frames, qa = [], {}
    for nid, g in df.groupby("node_id"):
        g = g.reset_index(drop=True)
        att, val = extract_node(g, nid)
        att = g[["family_id", "retailer", "node_id", "price"]].merge(att, on="family_id")
        att["l2_key"] = node_l2[nid]
        passing = [f for f, v in val.items() if v["accuracy_when_found"] is not None
                   and v["accuracy_when_found"] >= g2_min and "indicator" not in f]
        failing = [f for f, v in val.items() if v["accuracy_when_found"] is not None
                   and v["accuracy_when_found"] < g2_min and "indicator" not in f]
        nc = node_config(nid)
        facets = ["colour_family", "colour_tone", "material_class", "style_family", "size_class", "vibe"] + \
            tier2_attrs(nid) + list((nc.get("tier3") or {}).keys())
        qa[nid] = {"validation": val, "g2_pass": passing, "g2_fail": failing,
                   "provisional_config": not bool(nc) or not nc.get("reviewed_by"),
                   "unknown_share": {a: {r: float(att.loc[att["retailer"] == r, a].isna().mean())
                                         for r in att["retailer"].unique()} for a in facets if a in att.columns}}
        frames.append(att)
        log(f"S3 {nid.split(' > ')[-1]}: {len(att)} families (full text); G2 pass {passing}; fail {failing}")
    out = pd.concat(frames, ignore_index=True)
    for a in MULTI_ATTRS:
        out[a] = out[a].fillna("")
    save(out, "attributes.parquet")
    save_json({"backend": cfg()["extraction"]["backend"], "nodes": qa}, "qa_extraction.json")
    return qa
