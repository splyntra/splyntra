# SPDX-License-Identifier: Apache-2.0
"""Inline guardrail — a synchronous pre-flight check that can block a prompt
before it reaches the model provider.

The instrumentors call :func:`enforce` just before the provider call. It posts the
prompt text to the collector's ``/v1/guard`` endpoint, which returns
``{"action": "allow"|"redact"|"block", "reasons": [...]}``. Enforcement depends on
the configured mode (set from ``Splyntra(guard=...)``):

- ``off``     — no guard calls (default).
- ``monitor`` — call the guard and log the verdict, but never alter or block.
- ``block``   — raise :class:`SplyntraBlocked` on a ``block`` or ``redact`` verdict
                (flagged content — an injection attempt or a secret — is never sent
                to the provider).

``fail_open`` (default ``True``) means a guard error/timeout lets the call proceed;
set it ``False`` to fail closed (block on guard unavailability in ``block`` mode).
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger("splyntra.guard")


class SplyntraBlocked(Exception):
    """Raised when the inline guardrail blocks a call in ``block`` mode."""

    def __init__(self, reasons: list[str]):
        self.reasons = reasons
        super().__init__("Splyntra guard blocked the request: " + ", ".join(reasons or ["policy"]))


_cfg: dict[str, Any] = {"mode": "off", "fail_open": True, "endpoint": None, "api_key": None}


def configure(mode: str = "off", fail_open: bool = True, endpoint: str | None = None, api_key: str | None = None) -> None:
    """Configure the guard. Called by :class:`splyntra.Splyntra` at init."""
    _cfg.update(
        mode=mode or "off",
        fail_open=fail_open,
        endpoint=(endpoint or os.getenv("SPLYNTRA_ENDPOINT", "http://localhost:4318")).rstrip("/"),
        api_key=api_key or os.getenv("SPLYNTRA_API_KEY", ""),
    )


def _check(content: str, direction: str) -> dict:
    payload = json.dumps({"content": content, "direction": direction}).encode("utf-8")
    req = urllib.request.Request(
        f"{_cfg['endpoint']}/v1/guard",
        data=payload,
        method="POST",
        headers={"Authorization": f"Bearer {_cfg['api_key']}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def enforce(content: str, direction: str = "input") -> str:
    """Guard ``content``. Returns it unchanged when allowed; raises
    :class:`SplyntraBlocked` in ``block`` mode on a block/redact verdict."""
    mode = _cfg["mode"]
    if mode == "off" or not content:
        return content

    try:
        decision = _check(content, direction)
    except Exception as e:  # network/timeout/etc.
        if _cfg["fail_open"]:
            logger.warning("guard check failed, proceeding (fail-open): %s", e)
            return content
        raise SplyntraBlocked([f"guard_unavailable: {e}"])

    action = decision.get("action", "allow")
    reasons = decision.get("reasons", []) or []
    if action == "allow":
        return content
    if mode == "monitor":
        logger.warning("guard verdict (monitor, not enforced): action=%s reasons=%s", action, reasons)
        return content
    # block mode: never forward flagged content (injection or secret) upstream.
    raise SplyntraBlocked(reasons)


def extract_text(kwargs: dict) -> str:
    """Best-effort extraction of prompt text from an OpenAI/Anthropic/Ollama-style
    request (``system`` + ``messages[].content``, including content-block lists)."""
    parts: list[str] = []
    system = kwargs.get("system")
    if isinstance(system, str):
        parts.append(system)
    prompt = kwargs.get("prompt")
    if isinstance(prompt, str):
        parts.append(prompt)
    for m in kwargs.get("messages", []) or []:
        content = m.get("content") if isinstance(m, dict) else None
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])
    return "\n".join(parts)
