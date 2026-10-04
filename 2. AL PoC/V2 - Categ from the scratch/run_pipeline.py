"""Run the Staples AL PoC pipeline end to end, or from a given stage.

    python run_pipeline.py              # all stages
    python run_pipeline.py --from s4    # re-run from archetypes onward (earlier outputs are reused)
    python run_pipeline.py --only s9    # rebuild the report only

Small nodes (Sai, 2026-10-03): when a run includes S4-S7, nodes that end with fewer than gates.final.min_per_node
recommendations passing a method gate are re-run once through S4-S7 with a smaller archetype support bar
(archetypes.small_node). The list is kept in data/interim/relaxed_nodes.json.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from alpoc import (s0_ingest, s1_families, s2_mapping, s3_attributes, s4_archetypes, s5_vector,  # noqa: E402
                   s6_gaps, s7_integrate, s8_skus, s9_report)
from alpoc.common import cfg, load, log  # noqa: E402

STAGES = [
    ("s0", "ingest & clean", s0_ingest.run),
    ("s1", "families & nodes", s1_families.run),
    ("s2", "competitor mapping (page prior + scope check)", s2_mapping.run),
    ("s3", "attribute extraction + validation", s3_attributes.run),
    ("s4", "archetypes (4-6 attributes)", s4_archetypes.run),
    ("s5", "method 1: vector view (VOS)", s5_vector.run),
    ("s6", "method 2: attribute gaps (TG) + price view", s6_gaps.run),
    ("s7", "integration: gate + fused re-rank", s7_integrate.run),
    ("s8", "SKU exemplars & sellers", s8_skus.run),
    ("s9", "figures + HTML report", s9_report.run),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="s0")
    ap.add_argument("--to", dest="end", default=None)
    ap.add_argument("--only", default=None)
    a = ap.parse_args()
    keys = [k for k, _, _ in STAGES]
    end = keys.index(a.end) + 1 if a.end else len(keys)
    todo = [a.only] if a.only else keys[keys.index(a.start):end]
    if "s4" in todo:
        s4_archetypes.write_relaxed_nodes([])           # first pass: standard support bar everywhere
    for k, name, fn in STAGES:
        if k in todo:
            log(f"=== {k}: {name}")
            fn()
        if k == "s7" and all(x in todo for x in ("s4", "s5", "s6", "s7")):
            short = short_nodes()
            if short:
                log(f"small-node pass: {len(short)} node(s) below the minimum -> S4-S7 again with a smaller "
                    f"support bar: {[n.split(' > ')[-1] for n in short]}")
                s4_archetypes.write_relaxed_nodes(short)
                for k2, name2, fn2 in STAGES[4:8]:
                    log(f"=== {k2} (small-node pass): {name2}")
                    fn2()
    log("done")


def short_nodes() -> list[str]:
    """Scored nodes with fewer than gates.final.min_per_node recommendations that passed a method gate."""
    fa = load("final_archetypes.parquet")
    nodes = load("nodes.parquet")
    scored = nodes.loc[nodes["status"] == "scored", "node_id"]
    passed = fa[fa["shortlisted"] & (fa["tier"] != "Conditional")].groupby("node_id").size()
    need = cfg()["gates"]["final"]["min_per_node"]
    return [n for n in scored if passed.get(n, 0) < need]


if __name__ == "__main__":
    main()
