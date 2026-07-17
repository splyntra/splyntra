# SPDX-License-Identifier: FSL-1.1-ALv2
"""Evaluation scorers.

A scorer takes an item ``{input, expected, actual, tool_calls?, latency_ms?,
cost_usd?}`` and returns a float in [0, 1]. Higher is better. Aggregates are the
mean across items.
"""

from __future__ import annotations

import os
import re
from typing import Callable, Dict

Item = Dict[str, object]


def _s(v) -> str:
    return "" if v is None else str(v)


def exact_match(item: Item) -> float:
    """1.0 iff actual equals expected (trimmed, case-insensitive)."""
    return 1.0 if _s(item.get("actual")).strip().lower() == _s(item.get("expected")).strip().lower() else 0.0


def rule_based(item: Item) -> float:
    """1.0 if expected is contained in actual (substring or regex).

    If ``expected`` is wrapped in /.../ it is treated as a regex.
    """
    expected = _s(item.get("expected")).strip()
    actual = _s(item.get("actual"))
    if not expected:
        return 1.0
    if len(expected) >= 2 and expected.startswith("/") and expected.endswith("/"):
        try:
            return 1.0 if re.search(expected[1:-1], actual) else 0.0
        except re.error:
            return 0.0
    return 1.0 if expected.lower() in actual.lower() else 0.0


def tool_call_success(item: Item) -> float:
    """Fraction of expected tool calls present in the actual tool_calls list."""
    expected = item.get("expected_tool_calls") or []
    actual = item.get("tool_calls") or []
    if not isinstance(expected, list) or not expected:
        return 1.0
    actual_set = {str(a) for a in actual} if isinstance(actual, list) else set()
    hits = sum(1 for e in expected if str(e) in actual_set)
    return hits / len(expected)


def _tokens(v) -> set:
    return set(_s(v).strip().lower().split())


def precision_token_overlap(item: Item) -> float:
    """Token precision: fraction of the actual output's tokens that appear in the
    expected output. Empty actual → 1.0 (vacuously precise)."""
    expected, actual = _tokens(item.get("expected")), _tokens(item.get("actual"))
    if not actual:
        return 1.0
    return len(expected & actual) / len(actual)


def recall_token_overlap(item: Item) -> float:
    """Token recall: fraction of the expected output's tokens present in the
    actual output. Empty expected → 1.0 (nothing required)."""
    expected, actual = _tokens(item.get("expected")), _tokens(item.get("actual"))
    if not expected:
        return 1.0
    return len(expected & actual) / len(expected)


def tool_call_precision(item: Item) -> float:
    """Precision of tool calls: fraction of the actual tool calls that were
    expected (complements tool_call_success, which is recall). Empty actual → 1.0."""
    expected = item.get("expected_tool_calls") or []
    actual = item.get("tool_calls") or []
    if not isinstance(actual, list) or not actual:
        return 1.0
    expected_set = {str(e) for e in expected} if isinstance(expected, list) else set()
    hits = sum(1 for a in actual if str(a) in expected_set)
    return hits / len(actual)


def groundedness(item: Item) -> float:
    """Deterministic hallucination proxy: fraction of the actual answer's tokens
    that are supported by the provided ``context`` (retrieved documents / source
    material). Low groundedness ⇒ likely hallucination. Stopwords are ignored so
    filler words don't inflate the score.

    Requires an item ``context`` field (string, or list joined to a string). With
    no context, returns 1.0 (nothing to contradict — use the LLM ``faithfulness``
    judge from scorers-pro for context-free faithfulness).
    """
    ctx_raw = item.get("context")
    if isinstance(ctx_raw, (list, tuple)):
        ctx_raw = " ".join(_s(c) for c in ctx_raw)
    context = _tokens(ctx_raw) - _STOPWORDS
    actual = _tokens(item.get("actual")) - _STOPWORDS
    if not context or not actual:
        return 1.0
    return len(actual & context) / len(actual)


_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "to",
    "of", "in", "on", "for", "with", "as", "at", "by", "it", "this", "that", "i",
    "you", "he", "she", "they", "we", "not", "no", "yes", "do", "does", "did",
}


def latency(item: Item) -> float:
    """1.0 if under the threshold (default 5000ms), linearly degrading to 0 at 4x."""
    ms = float(item.get("latency_ms") or 0)
    threshold = float(os.getenv("EVAL_LATENCY_THRESHOLD_MS", "5000"))
    if ms <= threshold:
        return 1.0
    return max(0.0, 1.0 - (ms - threshold) / (3 * threshold))


def cost(item: Item) -> float:
    """1.0 if under the per-run cost threshold (default $0.05), degrading to 0 at 4x."""
    usd = float(item.get("cost_usd") or 0)
    threshold = float(os.getenv("EVAL_COST_THRESHOLD_USD", "0.05"))
    if usd <= threshold:
        return 1.0
    return max(0.0, 1.0 - (usd - threshold) / (3 * threshold))


# Registry of deterministic scorers (no external calls).
SCORERS: Dict[str, Callable[[Item], float]] = {
    "exact_match": exact_match,
    "rule_based": rule_based,
    "tool_call_success": tool_call_success,
    "tool_call_precision": tool_call_precision,
    "precision_token_overlap": precision_token_overlap,
    "recall_token_overlap": recall_token_overlap,
    "groundedness": groundedness,
    "latency": latency,
    "cost": cost,
}

# Plugin scorers contributed by separately-installed packages (e.g. the
# commercial scorers-pro, which provides ``llm_as_judge``). A plugin scorer
# returns a float in [0, 1] or None to skip an item (e.g. when unconfigured).
# Open builds run with deterministic scorers only; installing a plugin package
# lights up its scorers with no code change here.
PluginScorer = Callable[[Item], object]
PLUGIN_SCORERS: Dict[str, PluginScorer] = {}


def register_scorer(name: str, fn: PluginScorer) -> None:
    """Register a scorer by name. Intended for plugin packages."""
    PLUGIN_SCORERS[name] = fn


def _load_plugin_scorers() -> None:
    """Discover scorers advertised under the ``splyntra.scorers`` entry-point
    group. Each entry point's name is the scorer name; its value loads to the
    scorer callable. Failures are ignored so a bad plugin can't break scoring.
    """
    try:
        from importlib.metadata import entry_points
    except ImportError:  # pragma: no cover - py<3.8
        return
    try:
        eps = entry_points()
        group = (
            eps.select(group="splyntra.scorers")
            if hasattr(eps, "select")
            else eps.get("splyntra.scorers", [])  # type: ignore[attr-defined]
        )
        for ep in group:
            try:
                register_scorer(ep.name, ep.load())
            except Exception:  # noqa: BLE001 - one bad plugin must not break others
                continue
    except Exception:  # noqa: BLE001
        return


_load_plugin_scorers()


# Scorers that need an item `context` field (RAG groundedness / faithfulness).
CONTEXT_SCORERS = {"groundedness", "faithfulness"}


def scorer_catalog() -> list:
    """Metadata for every available scorer (deterministic + loaded plugins), for
    the dashboard's scorer picker: name, one-line description, kind, and whether
    the scorer needs a `context` field."""
    def _desc(fn) -> str:
        return ((fn.__doc__ or "").strip().split("\n")[0]) or ""

    out = []
    for name, fn in sorted(SCORERS.items()):
        out.append({"name": name, "description": _desc(fn), "kind": "deterministic", "needs_context": name in CONTEXT_SCORERS})
    for name, fn in sorted(PLUGIN_SCORERS.items()):
        out.append({"name": name, "description": _desc(fn) or "Commercial LLM-based scorer", "kind": "plugin", "needs_context": name in CONTEXT_SCORERS})
    return out
