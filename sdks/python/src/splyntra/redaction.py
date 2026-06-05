# SPDX-License-Identifier: Apache-2.0
"""Client-side redaction — strips high-confidence secrets from span attributes
before they leave the process.

Redaction-by-default is a core Splyntra guarantee (see the MVP redaction policy):
sensitive payloads should never travel to the collector in the clear. The
collector also redacts on ingest as defence-in-depth, but doing it in the SDK
means the raw secret never leaves the customer's process.

The pattern set mirrors the collector's hot-path redactor
(apps/collector/internal/redact/redact.go) so both layers agree.
"""

from __future__ import annotations

import re
from typing import List, Tuple

from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor

# (name, compiled pattern, replacement). Kept in sync with the Go redactor.
_PATTERNS: List[Tuple[str, "re.Pattern[str]", str]] = [
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}"), "[REDACTED:AWS_KEY]"),
    (
        "aws_secret_key",
        re.compile(r"(?i)aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}"),
        "[REDACTED:AWS_SECRET]",
    ),
    (
        "generic_api_key",
        re.compile(
            r"(?i)(api[_-]?key|apikey|secret[_-]?key)\s*[=:]\s*[\"']?[A-Za-z0-9\-._~]{20,}[\"']?"
        ),
        "[REDACTED:API_KEY]",
    ),
    ("bearer_token", re.compile(r"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*"), "[REDACTED:BEARER]"),
    (
        "jwt",
        re.compile(r"eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*"),
        "[REDACTED:JWT]",
    ),
]


def redact_string(value: str) -> str:
    """Apply all redaction patterns to a string, returning the redacted copy."""
    result = value
    for _, pattern, replacement in _PATTERNS:
        result = pattern.sub(replacement, result)
    return result


class RedactingSpanProcessor(SpanProcessor):
    """A span processor that redacts secrets from string attributes on span end.

    Registered *before* the batch/export processor so the shared span object is
    scrubbed prior to export. Only string attribute values are inspected; this
    is intentionally cheap and runs in the hot path.
    """

    def on_start(self, span, parent_context=None) -> None:  # noqa: D401 - no-op
        return None

    def on_end(self, span: ReadableSpan) -> None:
        attributes = getattr(span, "_attributes", None)
        if not attributes:
            return
        for key in list(attributes.keys()):
            value = attributes.get(key)
            if isinstance(value, str):
                redacted = redact_string(value)
                if redacted != value:
                    attributes[key] = redacted

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True
