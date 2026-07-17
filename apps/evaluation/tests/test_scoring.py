# SPDX-License-Identifier: FSL-1.1-ALv2
"""Unit tests for evaluation scorers and the scoring runner (no DB/LLM needed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scorers import (  # noqa: E402
    exact_match,
    rule_based,
    tool_call_success,
    tool_call_precision,
    precision_token_overlap,
    recall_token_overlap,
    groundedness,
    latency,
    cost,
)
from scorers.engine import score_items, is_regression  # noqa: E402


def test_exact_match():
    assert exact_match({"actual": "Yes", "expected": "yes"}) == 1.0
    assert exact_match({"actual": "no", "expected": "yes"}) == 0.0


def test_rule_based_substring_and_regex():
    assert rule_based({"actual": "the refund was issued", "expected": "refund"}) == 1.0
    assert rule_based({"actual": "order 12345", "expected": "/[0-9]{5}/"}) == 1.0
    assert rule_based({"actual": "nope", "expected": "refund"}) == 0.0


def test_groundedness_hallucination_proxy():
    # Fully supported by context → grounded.
    grounded = groundedness({"actual": "Paris is the capital", "context": "Paris is the capital of France"})
    assert grounded == 1.0
    # A fabricated claim not in the context → low groundedness (hallucination).
    hallucinated = groundedness({"actual": "Berlin Tokyo Sydney", "context": "Paris is the capital of France"})
    assert hallucinated < 0.5
    # No context → nothing to contradict → 1.0 (use the LLM faithfulness judge instead).
    assert groundedness({"actual": "anything", "context": ""}) == 1.0
    # Context as a list is joined.
    assert groundedness({"actual": "cats purr", "context": ["cats purr", "dogs bark"]}) == 1.0


def test_tool_call_success():
    assert tool_call_success({"expected_tool_calls": ["crm.read", "pay.refund"], "tool_calls": ["crm.read", "pay.refund"]}) == 1.0
    assert tool_call_success({"expected_tool_calls": ["a", "b"], "tool_calls": ["a"]}) == 0.5
    assert tool_call_success({"expected_tool_calls": [], "tool_calls": []}) == 1.0


def test_latency_and_cost_thresholds():
    assert latency({"latency_ms": 100}) == 1.0
    assert latency({"latency_ms": 10_000_000}) == 0.0
    assert cost({"cost_usd": 0.001}) == 1.0
    assert cost({"cost_usd": 100}) == 0.0


def test_precision_recall_token_overlap():
    # expected "the quick brown fox" (4 tokens); actual "quick brown" (2 tokens, both in expected)
    item = {"expected": "the quick brown fox", "actual": "quick brown"}
    assert precision_token_overlap(item) == 1.0          # 2/2 actual tokens are expected
    assert recall_token_overlap(item) == 0.5             # 2/4 expected tokens present
    # partial precision: one of two actual tokens is expected
    p = {"expected": "alpha", "actual": "alpha zzz"}
    assert precision_token_overlap(p) == 0.5
    # empty edge cases → 1.0
    assert precision_token_overlap({"expected": "x", "actual": ""}) == 1.0
    assert recall_token_overlap({"expected": "", "actual": "x"}) == 1.0


def test_tool_call_precision():
    assert tool_call_precision({"expected_tool_calls": ["a", "b"], "tool_calls": ["a"]}) == 1.0   # all actual expected
    assert tool_call_precision({"expected_tool_calls": ["a"], "tool_calls": ["a", "b"]}) == 0.5   # b unexpected
    assert tool_call_precision({"expected_tool_calls": ["a"], "tool_calls": []}) == 1.0           # no calls → precise


def test_score_items_aggregate():
    items = [
        {"input": "q1", "expected": "yes", "actual": "yes"},
        {"input": "q2", "expected": "no", "actual": "maybe"},
    ]
    out = score_items(items, ["exact_match"])
    assert out["per_scorer"]["exact_match"] == 0.5
    assert out["score"] == 0.5
    assert len(out["results"]) == 2
    assert out["results"][0]["passed"] is True
    assert out["results"][1]["passed"] is False


def test_regression_detection():
    assert is_regression(0.80, 0.90) is True   # 10% drop > 5% delta
    assert is_regression(0.88, 0.90) is False  # within delta
    assert is_regression(0.50, None) is False  # no baseline → never a regression
