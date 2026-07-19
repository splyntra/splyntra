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


class FakeSpan:
    def __init__(self, attrs):
        self._attributes = attrs


def test_processor_scrubs_attributes():
    span = FakeSpan({"splyntra.input": "key AKIAIOSFODNN7EXAMPLE", "n": 5})
    RedactingSpanProcessor().on_end(span)
    assert "AKIA" not in span._attributes["splyntra.input"]
    assert span._attributes["n"] == 5  # non-string left untouched


def test_processor_scrubs_list_valued_attributes():
    # OTel allows sequence-valued attributes; secrets inside a list must be
    # redacted too (P0.8).
    span = FakeSpan({"messages": ["hello", "key AKIAIOSFODNN7EXAMPLE", "bye"]})
    RedactingSpanProcessor().on_end(span)
    msgs = span._attributes["messages"]
    assert msgs[0] == "hello" and msgs[2] == "bye"
    assert "AKIA" not in msgs[1] and "[REDACTED:AWS_KEY]" in msgs[1]


def test_processor_warns_and_skips_when_attributes_absent(caplog):
    # A span whose `_attributes` holder is missing (OTel-internal change) must
    # warn rather than silently no-op (P0.9).
    import splyntra.redaction as red

    red._warned_missing_attrs = False

    class NoAttrsSpan:
        pass

    with caplog.at_level("WARNING"):
        RedactingSpanProcessor().on_end(NoAttrsSpan())
    assert any("redaction is not running" in r.message for r in caplog.records)
