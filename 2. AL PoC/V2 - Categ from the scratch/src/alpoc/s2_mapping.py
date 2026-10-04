"""S2 Competitor mapping + node table (methodology §5.4, §14). Replaces the Phase-1 S2 (pseudo-L5 nodes) and S3.

Every competitor listing page now points to at most one Staples focus node, so mapping is:
  1. page prior: longest matching page-path prefix in the crosswalk -> candidate node, or [] (backlog);
  2. product-level scope check: similarity-weighted k-NN over ALL Staples families (every node) ->
     mapped when the predicted node is the page's candidate AND the product is close enough to it;
     otherwise NONE (mis-shelved or out of scope) -> backlog.
The NONE threshold is Youden's J between known in-scope and known out-of-scope products, floored so it never
rejects more than (1 - min_in_scope_recall) of the known in-scope products. LLM adjudication of close calls is
the planned third stage (needs an API key); low-confidence rows are flagged instead.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import embed
from .common import cfg, load, load_yaml, log, node_config, retailers, save, save_json


def mapping_card(r) -> str:
    words = " ".join(str(r["desc"]).split()[: cfg()["extraction"]["desc_words_in_card"]])
    return f"{r['title_clean']}. {words}".strip()


def prefix_candidates(page: str, crosswalk: dict):
    """Longest crosswalk prefix of the page path -> list of Staples leaf names; None when no prefix matches."""
    best = None
    for pre, leaves in crosswalk.items():
        if page == pre or page.startswith(pre + " > "):
            if best is None or len(pre) > len(best[0]):
                best = (pre, leaves or [])
    return None if best is None else best[1]


def page_candidates(comp: pd.DataFrame, st: pd.DataFrame, crosswalks: dict, model: str) -> tuple[dict, list]:
    """(retailer, page) -> tuple of candidate node ids. Pages with no crosswalk prefix get automatic candidates."""
    lookup = st.drop_duplicates("leaf").set_index("leaf")["node_id"].to_dict()
    node_ids = sorted(st["node_id"].unique())
    out, auto = {}, []
    for ret, g in comp.groupby("retailer"):
        pages = sorted({p for ps in g["pages"] for p in ps.split("|") if p})
        missing = []
        for p in pages:
            leaves = prefix_candidates(p, crosswalks.get(ret, {}))
            if leaves is None:
                missing.append(p)
            else:
                out[(ret, p)] = tuple(sorted({lookup[l] for l in leaves if l in lookup}))
        if missing:
            ne = embed.encode(node_ids, model)
            pe = embed.encode(missing, model)
            for p, v in zip(missing, pe):
                out[(ret, p)] = tuple(sorted(node_ids[i] for i in np.argsort(-(ne @ v))[: cfg()["mapping"]["auto_candidates"]]))
                auto.append(f"{ret}: {p}")
    return out, auto


def knn_predict(W: np.ndarray, S: np.ndarray, s_node: np.ndarray, k: int, top: int, chunk: int = 2000):
    """Similarity-weighted k-NN over every Staples family -> (pred node, prob, margin, affinity to pred node)."""
    node_masks = {n: s_node == n for n in np.unique(s_node)}
    res = []
    for start in range(0, len(W), chunk):
        sims = W[start:start + chunk] @ S.T
        kk = min(k, sims.shape[1])
        nn = np.argpartition(-sims, kk - 1, axis=1)[:, :kk]
        for r in range(len(sims)):
            votes: dict = {}
            for j in nn[r]:
                votes[s_node[j]] = votes.get(s_node[j], 0.0) + max(float(sims[r, j]), 0.0)
            tot = sum(votes.values()) or 1.0
            probs = sorted(((v / tot, n) for n, v in votes.items()), reverse=True)
            p1, pred = probs[0]
            p2 = probs[1][0] if len(probs) > 1 else 0.0
            ls = sims[r, node_masks[pred]]
            res.append((pred, float(p1), float(p1 - p2), float(np.sort(ls)[-min(top, len(ls)):].mean())))
    return res


def knn_leaf_accuracy(S: np.ndarray, s_node: np.ndarray, k: int) -> float:
    sims = S @ S.T
    np.fill_diagonal(sims, -1)
    nn = np.argpartition(-sims, k - 1, axis=1)[:, :k]
    correct = 0
    for i in range(len(S)):
        votes: dict = {}
        for j in nn[i]:
            votes[s_node[j]] = votes.get(s_node[j], 0) + sims[i, j]
        correct += max(votes, key=votes.get) == s_node[i]
    return correct / len(S)


def none_threshold(pos: np.ndarray, neg: np.ndarray, min_recall: float) -> tuple[float, str]:
    if len(pos) < 30:
        return float("-inf"), "too few known in-scope products: no distance check"
    floor = float(np.quantile(pos, 1 - min_recall))          # keeps >= min_recall of the in-scope products
    if len(neg) < 30:
        return floor, f"recall floor ({min_recall:.0%}); too few known out-of-scope products for Youden"
    grid = np.quantile(np.concatenate([pos, neg]), np.linspace(0.01, 0.99, 197))
    j = [(np.mean(pos >= g) + np.mean(neg < g) - 1, g) for g in grid]
    youden = float(max(j)[1])
    if youden <= floor:
        return youden, "youden (cross-source)"
    return floor, f"recall floor ({min_recall:.0%}); Youden cut {youden:.3f} would reject more in-scope products"


def run() -> dict:
    c = cfg()["mapping"]
    fam = load("families.parquet")
    st = fam[fam["retailer"] == "staples"].reset_index(drop=True)
    comp = fam[fam["retailer"] != "staples"].reset_index(drop=True)
    comp_names = sorted(comp["retailer"].unique())
    crosswalks = {n: (load_yaml(retailers()[n]["crosswalk"]).get("pages") or {}) for n in comp_names}

    default_model = cfg()["encoder"]["default"]
    page_cands, auto_pages = page_candidates(comp, st, crosswalks, default_model)
    comp["cands"] = [tuple(sorted({n for p in ps.split("|") for n in page_cands.get((r, p), ())}))
                     for r, ps in zip(comp["retailer"], comp["pages"])]

    # --- encoder bake-off on the mapping task (Staples LOO node accuracy + NONE balanced accuracy)
    models = cfg()["encoder"]["candidates"] if cfg()["encoder"]["bakeoff"] else [default_model]
    s_cards = [mapping_card(r) for _, r in st.iterrows()]
    c_cards = [mapping_card(r) for _, r in comp.iterrows()]
    s_node = st["node_id"].values
    single = comp["cands"].map(len).eq(1).values
    negatives = comp["cands"].map(len).eq(0).values
    bake = []
    for mdl in models:
        S = embed.encode(s_cards, mdl)
        Wv = embed.encode(c_cards, mdl)
        res = knn_predict(Wv, S, s_node, c["k"], c["affinity_top"])
        pred = np.array([r[0] for r in res], dtype=object)
        aff = np.array([r[3] for r in res])
        cand1 = np.array([cs[0] if len(cs) == 1 else None for cs in comp["cands"]], dtype=object)
        pos = aff[single & (pred == cand1)]                  # known in scope and placed on its page's node
        neg = aff[negatives]                                  # known out of scope (page has no focus node)
        tau, tau_src = none_threshold(pos, neg, c["min_in_scope_recall"])
        in_scope_kept = float(np.mean((pred[single] == cand1[single]) & (aff[single] >= tau))) if single.any() else np.nan
        reject_out = float(np.mean(neg < tau)) if len(neg) else np.nan
        loo = knn_leaf_accuracy(S, s_node, c["k"])
        bake.append({"model": mdl, "tau_none": tau, "tau_source": tau_src, "in_scope_recall": in_scope_kept,
                     "out_scope_rejection": reject_out, "none_balanced_acc": np.nanmean([in_scope_kept, reject_out]),
                     "n_pos": int(single.sum()), "n_neg": int(negatives.sum()), "staples_loo_knn": loo})
        log(f"S2 bake-off {mdl}: tau={tau:.3f} ({tau_src}) in-scope kept={in_scope_kept:.3f} "
            f"out-of-scope rejected={reject_out:.3f} staples-LOO={loo:.3f}")
    best = max(bake, key=lambda b: (b["none_balanced_acc"] + b["staples_loo_knn"]) / 2)
    model = best["model"]
    embed.set_active_model(model)
    save_json({"model": model, "bakeoff": bake}, "encoder.json")

    # --- map every competitor family with the chosen encoder
    S = embed.encode(s_cards, model)
    Wv = embed.encode(c_cards, model)
    res = knn_predict(Wv, S, s_node, c["k"], c["affinity_top"])
    tau = best["tau_none"]
    comp["pred_node"] = [r[0] for r in res]
    comp["prob"] = [r[1] for r in res]
    comp["margin"] = [r[2] for r in res]
    comp["affinity"] = [r[3] for r in res]
    in_cands = np.array([p in cs for p, cs in zip(comp["pred_node"], comp["cands"])])
    comp["status"] = np.select(
        [comp["cands"].map(len).eq(0).values, ~in_cands, comp["affinity"].values < tau],
        ["none_page", "none_misshelved", "none_far"], default="mapped")
    comp["node_id"] = np.where(comp["status"] == "mapped", comp["pred_node"], None)
    comp["low_conf"] = (comp["status"] == "mapped") & (comp["prob"] < c["low_conf_prob"])

    # --- node table: one node per Staples focus leaf, with its competitor (Primary 1 first, if it has data)
    focus = {n["path"]: n for n in (load_yaml("nodes.yaml").get("focus_nodes") or [])}
    mapped = comp[comp["status"] == "mapped"]
    rows, keep = [], []
    for nid, g in st.groupby("node_id"):
        f = focus.get(nid, {})
        counts = mapped[mapped["node_id"] == nid]["retailer"].value_counts()
        chosen = next((r for r in f.get("competitors", []) if counts.get(r, 0) > 0), None)
        if chosen is None and len(counts) and not f:
            chosen = counts.index[0]
        n_s, n_c = len(g), int(counts.get(chosen, 0)) if chosen else 0
        if chosen:
            keep += list(mapped[(mapped["node_id"] == nid) & (mapped["retailer"] == chosen)]["family_id"])
        status = ("staples_only" if n_c == 0 else
                  "scored" if min(n_s, n_c) >= cfg()["nodes"]["min_families_scored"] else "thin")
        rows.append({"node_id": nid, "leaf": g["leaf"].iloc[0], "l2_key": g["l2_key"].iloc[0],
                     "competitor": chosen or "", "competitors_planned": "|".join(f.get("competitors", [])),
                     "segment": f.get("segment", ""), "rank": f.get("rank", 99),
                     "n_staples": n_s, "n_competitor": n_c, "status": status,
                     "node_config": bool(node_config(nid)),
                     "node_config_reviewed": bool(node_config(nid).get("reviewed_by"))})
    nodes = pd.DataFrame(rows).sort_values("rank").reset_index(drop=True)
    # families mapped to a node whose chosen competitor is another retailer are kept out of the analysis
    comp.loc[(comp["status"] == "mapped") & ~comp["family_id"].isin(keep), "status"] = "mapped_other_competitor"
    comp["nearest_staples_node"] = comp["pred_node"]
    comp["cands"] = comp["cands"].map(lambda t: "|".join(t))
    cols = ["family_id", "retailer", "pages", "cands", "pred_node", "node_id", "prob", "margin", "affinity",
            "status", "low_conf", "nearest_staples_node"]
    save(comp[cols], "mapping.parquet")
    save(nodes, "nodes.parquet")
    qa = {
        "encoder": model, "bakeoff": bake, "tau_none": tau, "tau_source": best["tau_source"],
        "auto_candidate_pages": auto_pages,
        "status_counts": {r: g["status"].value_counts().to_dict() for r, g in comp.groupby("retailer")},
        "low_conf_share_of_mapped": float(comp.loc[comp["status"] == "mapped", "low_conf"].mean()),
        "in_scope_recall": best["in_scope_recall"], "out_scope_rejection": best["out_scope_rejection"],
        "none_balanced_acc": best["none_balanced_acc"], "n_pos": best["n_pos"], "n_neg": best["n_neg"],
        "staples_loo_knn": best["staples_loo_knn"],
        "page_candidates": {f"{r}: {p}": list(v) for (r, p), v in page_cands.items()},
    }
    save_json(qa, "qa_mapping.json")
    log(f"S2 mapping: {qa['status_counts']}; nodes: {nodes['status'].value_counts().to_dict()}")
    return qa
