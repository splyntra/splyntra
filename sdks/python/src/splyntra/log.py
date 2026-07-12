# SPDX-License-Identifier: Apache-2.0
"""Structured, trace-correlated logging for Splyntra.

Emits OTLP LogRecords to the collector's ``/v1/logs``. When called inside an
active span, the log is auto-correlated (trace_id/span_id) so it lines up with
the trace waterfall in the dashboard. Bodies are redacted client-side
(defense-in-depth; the collector redacts again). No-op until ``Splyntra(...)`` is
initialized (the client wires the OTel LoggerProvider + exporter).

Usage::

    from splyntra import log
    log.info("charging card", attrs={"amount": 42})
    log.warning("rate limited", attrs={"server": "stripe"})
"""

from __future__ import annotations

import time
from typing import Any, Mapping, Optional

from opentelemetry import trace
from opentelemetry._logs import SeverityNumber, get_logger_provider

from splyntra.redaction import redact_string

__all__ = ["debug", "info", "warn", "warning", "error", "fatal"]

_redact = True
_ready = False

_SEVERITY = {
    "debug": SeverityNumber.DEBUG,
    "info": SeverityNumber.INFO,
    "warn": SeverityNumber.WARN,
    "error": SeverityNumber.ERROR,
    "fatal": SeverityNumber.FATAL,
}


def _configure(redact: bool = True) -> None:
    """Called by the Splyntra client once the LoggerProvider is set up."""
    global _redact, _ready
    _redact = redact
    _ready = True


def _emit(level: str, message: str, attrs: Optional[Mapping[str, Any]] = None) -> None:
    if not _ready:
        return  # no-op until Splyntra() configures the pipeline
    try:
        from opentelemetry.sdk._logs import LogRecord

        body = redact_string(message) if _redact else message
        ctx = trace.get_current_span().get_span_context()
        correlated = bool(ctx and ctx.is_valid)
        record = LogRecord(
            timestamp=time.time_ns(),
            observed_timestamp=time.time_ns(),
            trace_id=ctx.trace_id if correlated else 0,
            span_id=ctx.span_id if correlated else 0,
            trace_flags=ctx.trace_flags if correlated else None,
            severity_text=level.upper(),
            severity_number=_SEVERITY.get(level, SeverityNumber.INFO),
            body=body,
            attributes={k: str(v) for k, v in (attrs or {}).items()},
        )
        get_logger_provider().get_logger("splyntra").emit(record)
    except Exception:  # noqa: BLE001 — logging must never break the caller
        pass


def debug(message: str, attrs: Optional[Mapping[str, Any]] = None) -> None:
    _emit("debug", message, attrs)


def info(message: str, attrs: Optional[Mapping[str, Any]] = None) -> None:
    _emit("info", message, attrs)


def warn(message: str, attrs: Optional[Mapping[str, Any]] = None) -> None:
    _emit("warn", message, attrs)


warning = warn  # alias for stdlib-logging parity


def error(message: str, attrs: Optional[Mapping[str, Any]] = None) -> None:
    _emit("error", message, attrs)


def fatal(message: str, attrs: Optional[Mapping[str, Any]] = None) -> None:
    _emit("fatal", message, attrs)
