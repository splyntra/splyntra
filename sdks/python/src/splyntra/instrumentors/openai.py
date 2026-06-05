# SPDX-License-Identifier: Apache-2.0
"""OpenAI instrumentor - auto-patches the openai library to emit OTel spans."""

from __future__ import annotations

import time
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode


class OpenAIInstrumentor(BaseInstrumentor):
    """Instruments the OpenAI Python SDK to emit spans for chat completions.

    Supports sync, async, and streaming calls.

    Usage:
        from splyntra.instrumentors import OpenAIInstrumentor
        OpenAIInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ("openai >= 1.0.0",)

    def _instrument(self, **kwargs):
        import openai

        tracer = trace.get_tracer("splyntra.openai")

        # ─── Sync completions ────────────────────────────────────────────
        original_create = openai.resources.chat.completions.Completions.create

        def patched_create(self_client, *args, **kwargs):
            model = kwargs.get("model", "unknown")
            is_stream = kwargs.get("stream", False)
            span = tracer.start_span(
                f"openai.chat.{model}",
                kind=trace.SpanKind.CLIENT,
                attributes={
                    "splyntra.span.type": "llm_call",
                    "gen_ai.system": "openai",
                    "gen_ai.request.model": model,
                    "gen_ai.request.temperature": kwargs.get("temperature", 1.0),
                    "gen_ai.request.max_tokens": kwargs.get("max_tokens", 0),
                    "gen_ai.request.stream": is_stream,
                },
            )
            start = time.time()

            try:
                result = original_create(self_client, *args, **kwargs)

                if is_stream:
                    return _wrap_stream(result, span, start, model)

                _record_usage(span, result, start, model)
                span.set_status(StatusCode.OK)
                span.end()
                return result
            except Exception as e:
                span.set_status(StatusCode.ERROR, str(e))
                span.record_exception(e)
                span.end()
                raise

        # ─── Async completions ───────────────────────────────────────────
        original_async_create = openai.resources.chat.completions.AsyncCompletions.create

        async def patched_async_create(self_client, *args, **kwargs):
            model = kwargs.get("model", "unknown")
            is_stream = kwargs.get("stream", False)
            span = tracer.start_span(
                f"openai.chat.{model}",
                kind=trace.SpanKind.CLIENT,
                attributes={
                    "splyntra.span.type": "llm_call",
                    "gen_ai.system": "openai",
                    "gen_ai.request.model": model,
                    "gen_ai.request.temperature": kwargs.get("temperature", 1.0),
                    "gen_ai.request.max_tokens": kwargs.get("max_tokens", 0),
                    "gen_ai.request.stream": is_stream,
                },
            )
            start = time.time()

            try:
                result = await original_async_create(self_client, *args, **kwargs)

                if is_stream:
                    return _wrap_async_stream(result, span, start, model)

                _record_usage(span, result, start, model)
                span.set_status(StatusCode.OK)
                span.end()
                return result
            except Exception as e:
                span.set_status(StatusCode.ERROR, str(e))
                span.record_exception(e)
                span.end()
                raise

        openai.resources.chat.completions.Completions.create = patched_create
        openai.resources.chat.completions.AsyncCompletions.create = patched_async_create
        self._original_create = original_create
        self._original_async_create = original_async_create

    def _uninstrument(self, **kwargs):
        import openai

        if hasattr(self, "_original_create"):
            openai.resources.chat.completions.Completions.create = self._original_create
        if hasattr(self, "_original_async_create"):
            openai.resources.chat.completions.AsyncCompletions.create = self._original_async_create


def _record_usage(span, result, start: float, model: str):
    """Record token usage and latency from a non-streaming response."""
    latency_ms = (time.time() - start) * 1000
    span.set_attribute("gen_ai.latency_ms", latency_ms)

    if hasattr(result, "usage") and result.usage:
        span.set_attribute("gen_ai.usage.prompt_tokens", result.usage.prompt_tokens)
        span.set_attribute("gen_ai.usage.completion_tokens", result.usage.completion_tokens)
        span.set_attribute("gen_ai.usage.total_tokens", result.usage.total_tokens)

    if hasattr(result, "model"):
        span.set_attribute("gen_ai.response.model", result.model)


def _wrap_stream(stream, span, start: float, model: str):
    """Wrap a sync streaming response to record usage when complete."""
    completion_tokens = 0
    prompt_tokens = 0
    response_model = model

    try:
        for chunk in stream:
            completion_tokens += 1  # Approximate: count chunks
            if hasattr(chunk, "model") and chunk.model:
                response_model = chunk.model
            # If final chunk has usage info (stream_options include_usage)
            if hasattr(chunk, "usage") and chunk.usage:
                prompt_tokens = chunk.usage.prompt_tokens
                completion_tokens = chunk.usage.completion_tokens
            yield chunk
    except Exception as e:
        span.set_status(StatusCode.ERROR, str(e))
        span.record_exception(e)
        span.end()
        raise
    else:
        latency_ms = (time.time() - start) * 1000
        span.set_attribute("gen_ai.latency_ms", latency_ms)
        span.set_attribute("gen_ai.response.model", response_model)
        if prompt_tokens:
            span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
        if completion_tokens:
            span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
        span.set_status(StatusCode.OK)
        span.end()


async def _wrap_async_stream(stream, span, start: float, model: str):
    """Wrap an async streaming response to record usage when complete."""
    completion_tokens = 0
    prompt_tokens = 0
    response_model = model

    try:
        async for chunk in stream:
            completion_tokens += 1
            if hasattr(chunk, "model") and chunk.model:
                response_model = chunk.model
            if hasattr(chunk, "usage") and chunk.usage:
                prompt_tokens = chunk.usage.prompt_tokens
                completion_tokens = chunk.usage.completion_tokens
            yield chunk
    except Exception as e:
        span.set_status(StatusCode.ERROR, str(e))
        span.record_exception(e)
        span.end()
        raise
    else:
        latency_ms = (time.time() - start) * 1000
        span.set_attribute("gen_ai.latency_ms", latency_ms)
        span.set_attribute("gen_ai.response.model", response_model)
        if prompt_tokens:
            span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
        if completion_tokens:
            span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
        span.set_status(StatusCode.OK)
        span.end()
