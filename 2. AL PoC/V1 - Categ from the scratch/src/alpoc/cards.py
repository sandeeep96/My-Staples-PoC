"""Canonical product cards (§6.4): the same template on both sides, no price, no raw spec dump."""
from __future__ import annotations

import re

import pandas as pd

from .common import node_config, split_multi
from .vocab import matcher

_AESTHETIC = ["colour_family", "material_class", "style_family"]


def node_label(node_id: str) -> str:
    parts = node_id.split(" > ")
    return " > ".join(parts[-2:]) if len(parts) > 2 else node_id


def _val(v) -> str:
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) else str(v)


def full_card(r: pd.Series, tier2: list[str]) -> str:
    feats = ", ".join(f"{a.replace('_', ' ')} {_val(r.get(a))}" for a in tier2 if _val(r.get(a)))
    return (f"{node_label(r['node_id'])} | {r['title_clean']} | colour: {_val(r['colour_family'])} "
            f"{_val(r['colour_tone'])} | material: {_val(r['material_class'])} | style: {_val(r['style_family'])} | "
            f"features: {feats} | vibe: {', '.join(split_multi(r['aesthetic_tags']))} | "
            f"use: {', '.join(split_multi(r['use_context']))}")


def strip_aesthetic_words(title: str, node_id: str | None = None) -> str:
    """Remove colour / material / style words so the functional view ignores the look."""
    t = title
    for a in _AESTHETIC:
        mt = matcher(a, node_id)
        for plist in mt.values.values():
            for p in plist:
                t = re.sub(mt._wrap(p), " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip(" ,-|")


def type_attrs(node_id: str) -> list[str]:
    return list(node_config(node_id).get("type_attrs") or [])


def _tx(r: pd.Series, a: str) -> str:
    """Text-instrument value (same instrument on both sides, including its misses); falls back to the field."""
    return _val(r.get("txt_" + a)) if ("txt_" + a) in r.index else _val(r.get(a))


def neutral_card(r: pd.Series, tier2: list[str]) -> str:
    """Source-neutral card: only text-instrument extracted fields, no free text, so neither retailer's copy style
    nor its spec-sheet completeness can separate the two sides."""
    ta = type_attrs(r["node_id"])
    typ = " ".join(_tx(r, a) for a in ta if _tx(r, a))
    feats = ", ".join(f"{a.replace('_', ' ')} {_tx(r, a)}" for a in tier2 if a not in ta and _tx(r, a))
    return (f"{node_label(r['node_id'])} | type: {typ} | colour: {_tx(r, 'colour_family')} {_tx(r, 'colour_tone')} | "
            f"material: {_tx(r, 'material_class')} | style: {_val(r['style_family'])} | features: {feats} | "
            f"vibe: {', '.join(split_multi(r['aesthetic_tags']))} | use: {', '.join(split_multi(r['use_context']))} | "
            f"size: {_tx(r, 'size_class')}")


def neutral_functional_card(r: pd.Series, core: list[str]) -> str:
    ta = type_attrs(r["node_id"])
    typ = " ".join(_tx(r, a) for a in ta if _tx(r, a))
    feats = ", ".join(f"{a.replace('_', ' ')} {_tx(r, a)}" for a in core if a not in ta and _tx(r, a))
    return f"{node_label(r['node_id'])} | type: {typ} | features: {feats} | size: {_tx(r, 'size_class')}"


def tier2_attrs(node_id: str) -> list[str]:
    """Functional attributes of the node: Tier-2 vocabularies plus numeric bands."""
    c = node_config(node_id)
    return list((c.get("tier2") or {}).keys()) + list((c.get("numeric_bands") or {}).keys())


def tier3_attrs(node_id: str) -> list[str]:
    """Node-specific lifestyle attributes (text on both sides)."""
    return list((node_config(node_id).get("tier3") or {}).keys())


def functional_core(node_id: str) -> list[str]:
    return node_config(node_id).get("functional_core") or tier2_attrs(node_id)
