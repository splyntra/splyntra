# SPDX-License-Identifier: Apache-2.0
"""Ollama instrumentor - auto-patches the ollama library to emit OTel spans for
local-model chat/generate calls (sync, async, and streaming).

Covers both usage styles: the module-level convenience functions
(`ollama.chat(...)`) and the client classes (`ollama.Client().chat(...)`,
`ollama.AsyncClient().chat(...)`). Ollama reports usage as prompt_eval_count /
eval_count; we map them onto the same gen_ai.usage.prompt_tokens /
completion_tokens attributes the collector already reads.
"""

from __future__ import annotations

import time
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode

_OPS = ("chat", "generate")


def _get(obj, key, default=None):
    """Read a field from an Ollama response that may be a dict or an object."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


class OllamaInstrumentor(BaseInstrumentor):
    """Instruments the Ollama Python SDK to emit spans for chat/generate calls.

    Usage:
        from splyntra.instrumentors import OllamaInstrumentor
        OllamaInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ("ollama >= 0.1.0",)

    def _instrument(self, **kwargs):
        import ollama

        tracer = trace.get_tracer("splyntra.ollama")
        self._originals = {}

        def make_sync(orig, op):
            def wrapper(*args, **kwargs):
                span = _start_span(tracer, op, kwargs)
                start = time.time()
                try:
                    result = orig(*args, **kwargs)
                    if kwargs.get("stream", False):
                        return _wrap_stream(result, span, start)
                    _record_usage(span, result, start)
                    span.set_status(StatusCode.OK)
                    span.end()
                    return result
                except Exception as e:
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    span.end()
                    raise

            return wrapper

        def make_async(orig, op):
            async def wrapper(*args, **kwargs):
                span = _start_span(tracer, op, kwargs)
                start = time.time()
                try:
                    result = await orig(*args, **kwargs)
                    if kwargs.get("stream", False):
                        return _wrap_async_stream(result, span, start)
                    _record_usage(span, result, start)
                    span.set_status(StatusCode.OK)
                    span.end()
                    return result
                except Exception as e:
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    span.end()
                    raise

            return wrapper

        # Client classes (covers ollama.Client().chat() / AsyncClient().chat()).
        for cls_name, factory in (("Client", make_sync), ("AsyncClient", make_async)):
            cls = getattr(ollama, cls_name, None)
            if cls is None:
                continue
            for op in _OPS:
                orig = getattr(cls, op, None)
                if orig is None or getattr(orig, "__splyntra_wrapped", False):
                    continue
                wrapped = factory(orig, op)
                wrapped.__splyntra_wrapped = True
                self._originals[(cls_name, op)] = orig
                setattr(cls, op, wrapped)

        # Module-level convenience functions (bound to a default client; their
        # underlying function was captured at import, so they don't route through
        # the patched class methods above — no double counting).
        for op in _OPS:
            orig = getattr(ollama, op, None)
            if orig is None or getattr(orig, "__splyntra_wrapped", False):
                continue
            wrapped = make_sync(orig, op)
            wrapped.__splyntra_wrapped = True
            self._originals[("module", op)] = orig
            setattr(ollama, op, wrapped)

    def _uninstrument(self, **kwargs):
        import ollama

        for (scope, op), orig in getattr(self, "_originals", {}).items():
            target = ollama if scope == "module" else getattr(ollama, scope, None)
            if target is not None:
                setattr(target, op, orig)
        self._originals = {}


def _start_span(tracer, op: str, kwargs: dict):
    model = kwargs.get("model", "unknown")
    return tracer.start_span(
        f"ollama.{op}.{model}",
        kind=trace.SpanKind.CLIENT,
        attributes={
            "splyntra.span.type": "llm_call",
            "gen_ai.system": "ollama",
            "gen_ai.request.model": model,
            "gen_ai.request.stream": kwargs.get("stream", False),
        },
    )


def _record_usage(span, result, start: float):
    """Record token usage and latency from a non-streaming response."""
    span.set_attribute("gen_ai.latency_ms", (time.time() - start) * 1000)
    prompt = _get(result, "prompt_eval_count") or 0
    completion = _get(result, "eval_count") or 0
    if prompt:
        span.set_attribute("gen_ai.usage.prompt_tokens", prompt)
    if completion:
        span.set_attribute("gen_ai.usage.completion_tokens", completion)
    if prompt or completion:
        span.set_attribute("gen_ai.usage.total_tokens", prompt + completion)
    rm = _get(result, "model")
    if rm:
        span.set_attribute("gen_ai.response.model", rm)


def _finish_stream_span(span, start: float, prompt: int, completion: int, rm):
    span.set_attribute("gen_ai.latency_ms", (time.time() - start) * 1000)
    if rm:
        span.set_attribute("gen_ai.response.model", rm)
    if prompt:
        span.set_attribute("gen_ai.usage.prompt_tokens", prompt)
    if completion:
        span.set_attribute("gen_ai.usage.completion_tokens", completion)
    if prompt or completion:
        span.set_attribute("gen_ai.usage.total_tokens", prompt + completion)
    span.set_status(StatusCode.OK)
    span.end()


def _wrap_stream(stream, span, start: float):
    """Wrap a sync stream; the final chunk (done=True) carries token counts."""
    prompt = completion = 0
    rm = None
    try:
        for chunk in stream:
            prompt = _get(chunk, "prompt_eval_count") or prompt
            completion = _get(chunk, "eval_count") or completion
            rm = _get(chunk, "model") or rm
            yield chunk
    except Exception as e:
        span.set_status(StatusCode.ERROR, str(e))
        span.record_exception(e)
        span.end()
        raise
    else:
        _finish_stream_span(span, start, prompt, completion, rm)


async def _wrap_async_stream(stream, span, start: float):
    """Wrap an async stream; the final chunk (done=True) carries token counts."""
    prompt = completion = 0
    rm = None
    try:
        async for chunk in stream:
            prompt = _get(chunk, "prompt_eval_count") or prompt
            completion = _get(chunk, "eval_count") or completion
            rm = _get(chunk, "model") or rm
            yield chunk
    except Exception as e:
        span.set_status(StatusCode.ERROR, str(e))
        span.record_exception(e)
        span.end()
        raise
    else:
        _finish_stream_span(span, start, prompt, completion, rm)
