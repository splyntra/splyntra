# SPDX-License-Identifier: Apache-2.0
"""Decorators for tracing agent components with minimal code changes.

Each decorator captures the call's input (args/kwargs) and output (return value)
into `splyntra.input` / `splyntra.output` span attributes so the collector can
fan them out to the security detectors. Secrets are stripped client-side by the
redaction processor before export (redaction-by-default); PII and injection
patterns flow to the detectors. Capture is bounded/truncated and never raises.
"""

from __future__ import annotations

import functools
import inspect
import json
import time
from typing import Any, Callable, Optional

from opentelemetry import trace
from opentelemetry.trace import StatusCode

_MAX_LEN = 4096


def _safe_str(value: Any, limit: int = 2048) -> str:
    """Serialize a value to a bounded string, never raising."""
    try:
        if isinstance(value, str):
            s = value
        elif isinstance(value, bytes):
            s = value.decode("utf-8", "replace")
        else:
            s = json.dumps(value, default=str)
    except Exception:  # noqa: BLE001 - capture must never break the host call
        s = str(value)
    return s[:limit]


def _set_input(span, args: tuple, kwargs: dict) -> None:
    parts = [_safe_str(a) for a in args]
    parts += [f"{k}={_safe_str(v)}" for k, v in kwargs.items()]
    if parts:
        span.set_attribute("splyntra.input", " ".join(parts)[:_MAX_LEN])


def _set_output(span, result: Any) -> None:
    if result is not None:
        span.set_attribute("splyntra.output", _safe_str(result, _MAX_LEN))


def _llm_tokens(span, result: Any) -> None:
    """Extract token usage from an LLM result dict, if present."""
    if isinstance(result, dict) and "usage" in result:
        usage = result["usage"]
        span.set_attribute("gen_ai.usage.prompt_tokens", usage.get("prompt_tokens", 0))
        span.set_attribute("gen_ai.usage.completion_tokens", usage.get("completion_tokens", 0))


def _make_decorator(
    span_name_for: Callable[[Callable], str],
    kind: trace.SpanKind,
    attrs_for: Callable[[str], dict],
    latency_attr: Optional[str] = None,
    on_result: Optional[Callable[[Any, Any], None]] = None,
):
    """Build a decorator that traces a function (sync or async), capturing I/O."""

    def decorator(func: Callable) -> Callable:
        span_name = span_name_for(func)
        attributes = attrs_for(span_name)

        def _finish(span, result, start):
            _set_output(span, result)
            if on_result:
                on_result(span, result)
            if latency_attr:
                span.set_attribute(latency_attr, (time.perf_counter() - start) * 1000)
            span.set_status(StatusCode.OK)

        if inspect.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs) -> Any:
                tracer = trace.get_tracer("splyntra")
                with tracer.start_as_current_span(span_name, kind=kind, attributes=attributes) as span:
                    _set_input(span, args, kwargs)
                    start = time.perf_counter()
                    try:
                        result = await func(*args, **kwargs)
                        _finish(span, result, start)
                        return result
                    except Exception as e:  # noqa: BLE001
                        span.set_status(StatusCode.ERROR, str(e))
                        span.record_exception(e)
                        raise

            return async_wrapper

        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            tracer = trace.get_tracer("splyntra")
            with tracer.start_as_current_span(span_name, kind=kind, attributes=attributes) as span:
                _set_input(span, args, kwargs)
                start = time.perf_counter()
                try:
                    result = func(*args, **kwargs)
                    _finish(span, result, start)
                    return result
                except Exception as e:  # noqa: BLE001
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    raise

        return wrapper

    return decorator


def trace_agent(name: Optional[str] = None, workflow: Optional[str] = None):
    """Trace an agent execution as a root span (sync or async).

    Usage:
        @trace_agent(name="support_agent", workflow="refund")
        def run_agent(query: str): ...
    """
    return _make_decorator(
        span_name_for=lambda func: name or func.__name__,
        kind=trace.SpanKind.INTERNAL,
        attrs_for=lambda sn: {
            "splyntra.span.type": "agent",
            "splyntra.agent.name": sn,
            "splyntra.workflow": workflow or "",
        },
    )


def trace_tool(name: Optional[str] = None):
    """Trace a tool call (sync or async).

    Usage:
        @trace_tool(name="crm.read")
        def read_customer(customer_id: str): ...
    """
    return _make_decorator(
        span_name_for=lambda func: name or func.__name__,
        kind=trace.SpanKind.INTERNAL,
        attrs_for=lambda sn: {"splyntra.span.type": "tool_call", "splyntra.tool.name": sn},
        latency_attr="splyntra.tool.duration_ms",
    )


def trace_llm(model: Optional[str] = None, provider: Optional[str] = None):
    """Trace an LLM call with token/cost tracking (sync or async).

    Return a dict with a 'usage' key for automatic token extraction.

    Usage:
        @trace_llm(model="gpt-4o", provider="openai")
        def call_llm(prompt: str) -> dict: ...
    """
    return _make_decorator(
        span_name_for=lambda func: f"llm.{model or func.__name__}",
        kind=trace.SpanKind.CLIENT,
        attrs_for=lambda sn: {
            "splyntra.span.type": "llm_call",
            "gen_ai.system": provider or "unknown",
            "gen_ai.request.model": model or "unknown",
        },
        latency_attr="gen_ai.latency_ms",
        on_result=_llm_tokens,
    )
