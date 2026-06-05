# SPDX-License-Identifier: Apache-2.0
"""Governance helpers — call the collector's decision + ledger endpoints.

    from splyntra import authorize, log_action
    d = authorize("payments.refund", agent_id="support_agent", context={"amount": 80})
    if d["decision"] == "allow":
        ...  # proceed
    elif d["decision"] == "needs_approval":
        ...  # wait for a human

These call the collector (same endpoint/key as tracing).
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Optional


def _endpoint() -> str:
    return os.getenv("SPLYNTRA_ENDPOINT", "http://localhost:4318").rstrip("/")


def _key(explicit: Optional[str]) -> str:
    key = explicit or os.getenv("SPLYNTRA_API_KEY", "")
    if not key:
        raise ValueError("Splyntra: set SPLYNTRA_API_KEY or pass api_key=")
    return key


def _post(path: str, payload: dict, api_key: Optional[str]) -> dict:
    req = urllib.request.Request(
        f"{_endpoint()}{path}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {_key(api_key)}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def authorize(action: str, agent_id: str = "agent", resource: str = "", context: Optional[dict] = None, api_key: Optional[str] = None) -> dict:
    """Ask whether an agent may perform an action on a resource.

    ``resource`` scopes the decision (e.g. ``"payroll.read"``) so resource-level
    policies can match; omit it for action-only rules.

    Returns ``{"decision": "allow"|"deny"|"needs_approval", ...}``.
    """
    return _post(
        "/v1/authorize",
        {"agent_id": agent_id, "action": action, "resource": resource, "context": context or {}},
        api_key,
    )


def log_action(action: str, actor: str = "agent", resource: str = "", trace_id: str = "", metadata: Optional[dict] = None, api_key: Optional[str] = None) -> dict:
    """Append a consequential action to the immutable activity ledger."""
    return _post(
        "/v1/ledger",
        {"actor": actor, "action": action, "resource": resource, "trace_id": trace_id, "metadata": metadata or {}},
        api_key,
    )
