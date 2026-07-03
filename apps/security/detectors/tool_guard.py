# SPDX-License-Identifier: AGPL-3.0-only
"""Dangerous tool-call detector — the agent-native security check.

Generic DLP/secret scanners look at text; agents act through *tools* (including
MCP `tools/call`). This detector inspects ``tool_call`` spans — the tool name and
its serialized arguments — for high-risk operations: shell execution, file
deletion, destructive SQL, outbound network egress, and credential/secret-store
access. Ships as BETA (informs; the inline guardrail can enforce separately).
"""

from __future__ import annotations

import re

from .models import Detection

# (compiled pattern, category, severity, description). Matched against a haystack
# of "<tool_name>\n<arguments>" so either the tool's identity or its args can trip.
_RULES = [
    (r"(?i)\b(rm\s+-rf|rmtree|unlink|shutil\.rmtree|deltree|del\s+/[sq])", "file_deletion", "CRITICAL", "Recursive/forced file deletion"),
    (r"(?i)\b(os\.system|subprocess\.|exec\(|eval\(|child_process|spawn\(|/bin/sh|/bin/bash|\bsh\s+-c)", "shell_execution", "CRITICAL", "Arbitrary shell/command execution"),
    (r"(?i)\b(drop\s+table|truncate\s+table|delete\s+from|drop\s+database|alter\s+table\s+\w+\s+drop)", "sql_destructive", "HIGH", "Destructive SQL statement"),
    (r"(?i)(/etc/passwd|/etc/shadow|\.ssh/id_|\.aws/credentials|AKIA[0-9A-Z]{16}|BEGIN\s+(RSA|OPENSSH|EC)\s+PRIVATE\s+KEY)", "credential_access", "CRITICAL", "Access to credentials or secret material"),
    (r"(?i)\b(curl\s+http|wget\s+http|requests\.(post|put)|fetch\(|http\.client|urllib\.request)", "network_egress", "MEDIUM", "Outbound network request from a tool"),
]

_DANGEROUS_TOOL_NAMES = re.compile(
    r"(?i)\b(shell|exec|command|bash|terminal|run_code|python_repl|delete|drop|remove|sudo|eval)\b"
)


class DangerousToolCallDetector:
    """Flags risky operations in tool calls. Non-blocking (BETA)."""

    def __init__(self):
        self._rules = [(re.compile(p), cat, sev, desc) for p, cat, sev, desc in _RULES]

    def scan(self, span_type: str, tool_name: str, content: str) -> list[Detection]:
        # Meaningful for tool invocations and database calls (dangerous SQL).
        if span_type not in ("tool_call", "db"):
            return []

        haystack = f"{tool_name or ''}\n{content or ''}"
        detections: list[Detection] = []
        seen: set[str] = set()

        for regex, category, severity, description in self._rules:
            m = regex.search(haystack)
            if m and category not in seen:
                seen.add(category)
                detections.append(
                    Detection(
                        detector="tool_guard",
                        category=category,
                        severity=severity,
                        confidence=0.7,
                        description=f"{description} in tool '{tool_name or 'unknown'}'",
                        start=m.start(),
                        end=m.end(),
                        beta=True,
                    )
                )

        # A dangerous-sounding tool name alone is a weaker, low-severity signal.
        if not detections and tool_name and _DANGEROUS_TOOL_NAMES.search(tool_name):
            detections.append(
                Detection(
                    detector="tool_guard",
                    category="risky_tool",
                    severity="LOW",
                    confidence=0.5,
                    description=f"Tool '{tool_name}' can perform privileged operations",
                    beta=True,
                )
            )

        return detections
