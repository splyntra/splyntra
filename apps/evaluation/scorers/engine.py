# SPDX-License-Identifier: AGPL-3.0-only
"""Scoring engine: apply selected scorers to evaluation items and aggregate."""

from __future__ import annotations

from statistics import mean
from typing import Dict, List

from . import SCORERS, PLUGIN_SCORERS

# Default scorers when the caller doesn't specify any.
DEFAULT_SCORERS = ["exact_match", "rule_based"]

# Relative drop vs baseline that counts as a regression (5%).
REGRESSION_DELTA = 0.05


def score_items(items: List[dict], scorers: List[str]) -> Dict:
    """Score every item with the requested scorers.

    Deterministic scorers are built in; plugin scorers (e.g. ``llm_as_judge``)
    are available only when their package is installed and may return None to
    skip an item (so a scorer with no produced values is omitted from the
    aggregate rather than counted as zero).

    Returns {"per_scorer": {name: avg}, "score": overall_avg, "results": [...]}.
    """
    selected = scorers or DEFAULT_SCORERS
    deterministic = [s for s in selected if s in SCORERS]
    plugins = [s for s in selected if s in PLUGIN_SCORERS]

    results = []
    per_scorer_acc: Dict[str, List[float]] = {s: [] for s in deterministic}

    for idx, item in enumerate(items):
        item_scores: Dict[str, float] = {}
        for name in deterministic:
            val = SCORERS[name](item)
            item_scores[name] = val
            per_scorer_acc[name].append(val)
        for name in plugins:
            val = PLUGIN_SCORERS[name](item)
            if val is not None:
                fval = float(val)
                item_scores[name] = fval
                per_scorer_acc.setdefault(name, []).append(fval)
        item_avg = mean(item_scores.values()) if item_scores else 0.0
        results.append(
            {
                "idx": idx,
                "input": str(item.get("input", ""))[:2000],
                "expected": str(item.get("expected", ""))[:2000],
                "actual": str(item.get("actual", ""))[:2000],
                "passed": item_avg >= 0.5,
                "scores": item_scores,
            }
        )

    # Only include scorers that produced at least one value.
    per_scorer = {name: mean(vals) for name, vals in per_scorer_acc.items() if vals}
    overall = mean(per_scorer.values()) if per_scorer else 0.0
    return {"per_scorer": per_scorer, "score": overall, "results": results}


def is_regression(score: float, baseline: float | None) -> bool:
    """A regression is a score that drops more than REGRESSION_DELTA below baseline."""
    if baseline is None:
        return False
    return score < baseline - REGRESSION_DELTA
