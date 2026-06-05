# SPDX-License-Identifier: Apache-2.0
"""Unit tests for client-side redaction."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from splyntra.redaction import RedactingSpanProcessor, redact_string  # noqa: E402


def test_redacts_aws_key():
    out = redact_string("my key is AKIAIOSFODNN7EXAMPLE done")
    assert "AKIA" not in out
    assert "[REDACTED:AWS_KEY]" in out


def test_redacts_jwt():
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abc123def"
    out = redact_string(f"token={jwt}")
    assert "[REDACTED:JWT]" in out


def test_redacts_bearer_and_api_key():
    assert "[REDACTED:BEARER]" in redact_string("Authorization: Bearer abcDEF123.token")
    assert "[REDACTED:API_KEY]" in redact_string('api_key="abcdef0123456789abcdef"')


def test_no_false_positive_on_clean_text():
    clean = "The agent planned a refund for order 42."
    assert redact_string(clean) == clean


def test_processor_scrubs_attributes():
    class FakeSpan:
        def __init__(self, attrs):
            self._attributes = attrs

    span = FakeSpan({"splyntra.input": "key AKIAIOSFODNN7EXAMPLE", "n": 5})
    RedactingSpanProcessor().on_end(span)
    assert "AKIA" not in span._attributes["splyntra.input"]
    assert span._attributes["n"] == 5  # non-string left untouched
