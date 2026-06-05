# SPDX-License-Identifier: Apache-2.0
"""Splyntra CLI — primarily the evaluation CI gate.

    splyntra eval push  --name support-qa --file dataset.jsonl
    splyntra eval run   --dataset <id> --file results.jsonl --gate

`run --gate` exits 1 when the run is a regression, so it can block a CI release.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import List

from splyntra import eval as ev


def _read_jsonl(path: str) -> List[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="splyntra")
    sub = parser.add_subparsers(dest="group", required=True)

    eval_p = sub.add_parser("eval", help="evaluation commands")
    eval_sub = eval_p.add_subparsers(dest="cmd", required=True)

    push = eval_sub.add_parser("push", help="create/version a dataset from a JSONL file")
    push.add_argument("--name", required=True)
    push.add_argument("--file", required=True, help="JSONL of {input, expected_output, ...}")
    push.add_argument("--description", default="")

    run = eval_sub.add_parser("run", help="score results against a dataset")
    run.add_argument("--dataset", required=True, help="dataset id")
    run.add_argument("--file", required=True, help="JSONL of {input, expected, actual, ...}")
    run.add_argument("--scorers", default="", help="comma-separated (default: exact_match,rule_based)")
    run.add_argument("--gate", action="store_true", help="exit non-zero on regression")
    run.add_argument("--set-baseline", action="store_true", help="store this run as the dataset baseline")

    args = parser.parse_args(argv)

    if args.cmd == "push":
        res = ev.push_dataset(args.name, _read_jsonl(args.file), description=args.description)
        print(json.dumps(res, indent=2))
        return 0

    if args.cmd == "run":
        scorers = [s for s in args.scorers.split(",") if s] or None
        res = ev.run(
            args.dataset,
            results=_read_jsonl(args.file),
            scorers=scorers,
            gate=args.gate,
            set_baseline=args.set_baseline,
        )
        print(json.dumps(res, indent=2))
        if args.gate and not res.get("passed", True):
            print("✗ evaluation gate FAILED (regression vs baseline)", file=sys.stderr)
            return 1
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
