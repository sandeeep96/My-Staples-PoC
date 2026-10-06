"""S8 SKU stage (Phase-1 S10): exemplars per shortlisted archetype, nearest-Staples evidence, brand & recruitability (§8)."""
from __future__ import annotations

import json
import re
from functools import lru_cache

import numpy as np
import pandas as pd

from . import embed
from .cards import neutral_card, tier2_attrs
from .common import cfg, load, log, node_config, save
from .s4_archetypes import _stated
from .s5_vector import APPROVE
from .s6_gaps import M2_CANNIBAL

INFO = ["family_id", "title", "price", "url", "brand", "house_brand", "brand_on_staples", "colour_family",
        "material_class", "style_family", "dfi", "colours_observed"]


def mmr(scores: np.ndarray, E: np.ndarray, n: int, lam: float) -> list[int]:
    chosen, pool = [], list(range(len(scores)))
    while pool and len(chosen) < n:
        if not chosen:
            best = max(pool, key=lambda i: scores[i])
        else:
            best = max(pool, key=lambda i: lam * scores[i] - (1 - lam) * max(float(E[i] @ E[j]) for j in chosen))
        chosen.append(best)
        pool.remove(best)
    return chosen


def evidence(cand: pd.DataFrame, ft: pd.DataFrame) -> pd.DataFrame:
    c = cand.merge(ft[INFO], on="family_id", how="left")
    s = ft[["family_id", "title", "price", "url", "colour_family", "material_class", "style_family", "dfi"]].add_prefix("st_")
    return c.merge(s, left_on="nearest_staples", right_on="st_family_id", how="left")


def allowed(m: pd.DataFrame, tier: str, n: int) -> pd.DataFrame:
    """Products that are safe under the method(s) that recommended the archetype (§14.6):
    Vector-led -> Method 1 safe labels; Gap-led -> not a Method 2 attribute undercut/substitute (and not identical);
    Strong -> safe under both, falling back to either when fewer than n; Conditional -> safe under either."""
    m1 = m["label"].isin(APPROVE)
    m2 = ~m["m2_label"].isin(M2_CANNIBAL) & m["m2_label"].notna() & (m["label"] != "EXCLUDE")
    if tier == "Vector-led":
        return m[m1].assign(basis="Method 1")
    if tier == "Gap-led":
        return m[m2].assign(basis="Method 2")
    both = m[m1 & m2].assign(basis="both methods")
    if tier == "Strong" and len(both) >= n:
        return both
    return pd.concat([both, m[(m1 | m2) & ~(m1 & m2)].assign(basis=np.where(m1[(m1 | m2) & ~(m1 & m2)], "Method 1", "Method 2"))])


@lru_cache(maxsize=None)
def _title_matcher(nid: str, f: str):
    c = node_config(nid)
    spec = {**(c.get("tier2") or {}), **(c.get("tier3") or {}), **(c.get("vocab_overrides") or {})}.get(f)
    if not spec or not spec.get("values"):
        return None
    # the node's vocabulary, also matching plurals in titles ("Accent Chairs")
    wrap = lambda p: p if ("\\b" in p or p.startswith("(?")) else rf"\b(?:{p})(?:e?s)?\b"
    return {v: re.compile("|".join(wrap(str(p)) for p in pats), re.I) for v, pats in spec["values"].items()}


def allowed_values(nid: str, facet_dicts: list[dict]) -> dict:
    """Attribute -> values a pick allows (lead + folded variants); attributes left unstated by any variant are free."""
    out = {}
    for f in facet_dicts[0]:
        vals = {d.get(f) for d in facet_dicts}
        if any(v is None or v == "other" or not _stated(nid, f, v) for v in vals):
            continue
        out[f] = {x for v in vals for x in [v, *str(v).split(" & ")]}
    return out


def title_conflict(title: str, nid: str, allowed: dict) -> str:
    """The title names another value of one of the pick's attributes and none of its own -> that attribute."""
    for f, ok in allowed.items():
        mt = _title_matcher(nid, f)
        if mt is None:
            continue
        found = {v for v, rx in mt.items() if rx.search(str(title))}
        if found and not (found & ok):
            return f
    return ""


def run() -> dict:
    sk = cfg()["skus"]
    ft = load("family_table.parquet")
    cand = load("candidates.parquet").merge(load("m2_labels.parquet"), on="family_id", how="left")
    fa = load("final_archetypes.parquet")
    recs, pools = [], []
    fa["n_title_conflict"] = 0
    fx = fa.set_index("archetype_id")["facets"]
    used = {}                                       # node -> families already shown under a higher-ranked pick
    for k, a in fa[fa["shortlisted"]].sort_values(["node_id", "final_rank"]).iterrows():
        ids = [a["archetype_id"]] + [x for x in str(a.get("merged_ids") or "").split("|") if x]   # + folded variants
        m = allowed(cand[cand["archetype_id"].isin(ids)].assign(archetype_id=a["archetype_id"]), a["tier"],
                    sk["n_exemplars"])
        pools.append(m)
        # examples must not contradict the pick in their own title (Sai 2026-10-07, §14.11) and are shown once per node
        ok = allowed_values(a["node_id"], [json.loads(fx[i]) for i in ids])
        tc = m["family_id"].map(ft.set_index("family_id")["title"]).map(lambda t: title_conflict(t, a["node_id"], ok))
        fa.at[k, "n_title_conflict"] = int((tc != "").sum())
        seen = used.setdefault(a["node_id"], set())
        m = m[(tc == "").values & ~m["family_id"].isin(seen).values]
        if m.empty:
            continue
        rows = ft.set_index("family_id").loc[m["family_id"]].reset_index()
        E = embed.encode([neutral_card(r, tier2_attrs(a["node_id"])) for _, r in rows.iterrows()])
        cen = E.mean(axis=0)
        cen /= np.linalg.norm(cen)
        score = 0.5 * (1 - m["crs"].values / 100) + 0.3 * (E @ cen) + 0.2 * rows["dfi"].values
        pick = mmr(score, E, sk["n_exemplars"], sk["mmr_lambda"])
        sel = m.iloc[pick].assign(exemplar_rank=range(1, len(pick) + 1), exemplar_score=score[pick])
        recs.append(sel)
        seen.update(sel["family_id"])
    recs = evidence(pd.concat(recs, ignore_index=True), ft) if recs else pd.DataFrame()
    # STYLE-EXTENSION list: colour/material/style variants of existing Staples families
    se = cand[cand["label"] == "STYLE-EXTENSION"].sort_values(["node_id", "ad", "aas"], ascending=[True, False, False])
    se = se.groupby("node_id").head(sk["style_extension_n"])
    se = evidence(se, ft) if len(se) else pd.DataFrame()
    # vendor / seller view over the approvable products of shortlisted archetypes
    pool = (pd.concat(pools) if pools else cand.head(0)).drop_duplicates(["node_id", "family_id", "archetype_id"]).merge(
        ft[["family_id", "brand", "house_brand", "brand_on_staples"]], on="family_id")
    vend = pool.groupby(["node_id", "brand"]).agg(
        products=("family_id", "nunique"), archetypes=("archetype_id", "nunique"),
        house_brand=("house_brand", "first"), brand_on_staples=("brand_on_staples", "first")).reset_index()
    vend["recruit_path"] = np.where(vend["brand_on_staples"], "Quick win: already a Staples supplier",
                                    np.where(vend["house_brand"], "Competitor house brand: source the archetype, not the SKU",
                                             "Independent brand: recruit as a marketplace seller"))
    hhi = pool.groupby("archetype_id")["brand"].apply(lambda s: float(((s.value_counts() / len(s)) ** 2).sum()))
    fa["brand_hhi"] = fa["archetype_id"].map(hhi)
    save(fa, "final_archetypes.parquet")
    save(recs, "sku_recs.parquet")
    save(se, "style_extensions.parquet")
    save(vend.sort_values(["node_id", "products"], ascending=[True, False]), "vendor_view.parquet")
    log(f"S8: {len(recs)} exemplar SKUs, {len(se)} style-extension SKUs, {len(vend)} vendor rows")
    return {"exemplars": len(recs), "style_extensions": len(se)}
