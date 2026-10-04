"""S8 SKU stage (Phase-1 S10): exemplars per shortlisted archetype, nearest-Staples evidence, brand & recruitability (§8)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import embed
from .cards import neutral_card, tier2_attrs
from .common import cfg, load, log, save
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


def run() -> dict:
    sk = cfg()["skus"]
    ft = load("family_table.parquet")
    cand = load("candidates.parquet").merge(load("m2_labels.parquet"), on="family_id", how="left")
    fa = load("final_archetypes.parquet")
    recs, pools = [], []
    for _, a in fa[fa["shortlisted"]].iterrows():
        m = allowed(cand[cand["archetype_id"] == a["archetype_id"]], a["tier"], sk["n_exemplars"])
        pools.append(m)
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
