# SPDX-License-Identifier: Apache-2.0
"""Evaluation helpers + CI gate.

Push labeled datasets and run evaluations against the Splyntra evaluation
service. Designed for CI: your pipeline runs the agent over a dataset, collects
``(input, actual_output)`` pairs, and calls :func:`run` with ``gate=True`` —
which exits non-zero (via the CLI) when the score regresses below baseline.

    from splyntra import eval as ev
    ev.push_dataset("support-qa", [{"input": "...", "expected_output": "..."}])
    res = ev.run(dataset_id, results=[{"input": "...", "actual": "..."}], gate=True)
    print(res["score"], res["passed"])
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import List, Optional


def _endpoint() -> str:
    return os.getenv("SPLYNTRA_EVAL_ENDPOINT", "http://localhost:8002").rstrip("/")


def _api_key(explicit: Optional[str]) -> str:
    key = explicit or os.getenv("SPLYNTRA_API_KEY", "")
    if not key:
        raise ValueError("Splyntra: set SPLYNTRA_API_KEY or pass api_key=")
    return key


def _post(path: str, payload: dict, api_key: Optional[str]) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{_endpoint()}{path}",
        data=data,
        method="POST",
        headers={"Authorization": f"Bearer {_api_key(api_key)}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"eval request failed ({e.code}): {e.read().decode('utf-8', 'ignore')}") from e


def push_dataset(name: str, items: List[dict], description: str = "", api_key: Optional[str] = None) -> dict:
    """Create/version a dataset. ``items`` are ``{input, expected_output, expected_tool_calls?}``."""
    return _post("/v1/datasets", {"name": name, "description": description, "items": items}, api_key)


def run(
    dataset_id: str,
    results: List[dict],
    scorers: Optional[List[str]] = None,
    gate: bool = True,
    set_baseline: bool = False,
    api_key: Optional[str] = None,
) -> dict:
    """Score caller-produced results against a dataset; returns the run summary."""
    return _post(
        "/v1/evaluations/run",
        {
            "dataset_id": dataset_id,
            "scorers": scorers or [],
            "results": results,
            "gate": gate,
            "set_baseline": set_baseline,
        },
        api_key,
    )
