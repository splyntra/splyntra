# SPDX-License-Identifier: AGPL-3.0-only
"""Unit tests for evaluation scorers and the scoring runner (no DB/LLM needed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scorers import exact_match, rule_based, tool_call_success, latency, cost  # noqa: E402
from scorers.engine import score_items, is_regression  # noqa: E402


def test_exact_match():
    assert exact_match({"actual": "Yes", "expected": "yes"}) == 1.0
    assert exact_match({"actual": "no", "expected": "yes"}) == 0.0


def test_rule_based_substring_and_regex():
    assert rule_based({"actual": "the refund was issued", "expected": "refund"}) == 1.0
    assert rule_based({"actual": "order 12345", "expected": "/[0-9]{5}/"}) == 1.0
    assert rule_based({"actual": "nope", "expected": "refund"}) == 0.0


def test_tool_call_success():
    assert tool_call_success({"expected_tool_calls": ["crm.read", "pay.refund"], "tool_calls": ["crm.read", "pay.refund"]}) == 1.0
    assert tool_call_success({"expected_tool_calls": ["a", "b"], "tool_calls": ["a"]}) == 0.5
    assert tool_call_success({"expected_tool_calls": [], "tool_calls": []}) == 1.0


def test_latency_and_cost_thresholds():
    assert latency({"latency_ms": 100}) == 1.0
    assert latency({"latency_ms": 10_000_000}) == 0.0
    assert cost({"cost_usd": 0.001}) == 1.0
    assert cost({"cost_usd": 100}) == 0.0


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
