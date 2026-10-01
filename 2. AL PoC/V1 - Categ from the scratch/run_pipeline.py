"""Run the Staples AL PoC pipeline end to end, or from a given stage.

    python run_pipeline.py              # all stages
    python run_pipeline.py --from s4    # re-run from archetypes onward (earlier outputs are reused)
    python run_pipeline.py --only s9    # rebuild the report only
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from alpoc import (s0_ingest, s1_families, s2_mapping, s3_attributes, s4_archetypes, s5_vector,  # noqa: E402
                   s6_gaps, s7_integrate, s8_skus, s9_report)
from alpoc.common import log  # noqa: E402

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
    for k, name, fn in STAGES:
        if k in todo:
            log(f"=== {k}: {name}")
            fn()
    log("done")


if __name__ == "__main__":
    main()
