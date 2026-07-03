# SPDX-License-Identifier: Apache-2.0
"""Anthropic (Claude) instrumentor - auto-patches the anthropic library to emit
OTel spans for Messages API calls (client.messages.create).

Anthropic's usage shape is input_tokens / output_tokens (not prompt/completion);
we map them onto the same gen_ai.usage.prompt_tokens / completion_tokens span
attributes the collector already reads, so cost/token analytics work unchanged.
"""

from __future__ import annotations

import time
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode


class AnthropicInstrumentor(BaseInstrumentor):
    """Instruments the Anthropic Python SDK to emit spans for Messages calls.

    Supports sync, async, and streaming (stream=True) calls.

    Usage:
        from splyntra.instrumentors import AnthropicInstrumentor
        AnthropicInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ("anthropic >= 0.39.0",)

    def _instrument(self, **kwargs):
        import anthropic

        tracer = trace.get_tracer("splyntra.anthropic")

        # ─── Sync messages ───────────────────────────────────────────────
        original_create = anthropic.resources.messages.Messages.create

        def patched_create(self_client, *args, **kwargs):
            model = kwargs.get("model", "unknown")
            is_stream = kwargs.get("stream", False)
            # Inline guardrail pre-flight: may raise SplyntraBlocked before the call.
            from .. import guard as _guard
            _guard.enforce(_guard.extract_text(kwargs), "input")
            span = tracer.start_span(
                f"anthropic.messages.{model}",
                kind=trace.SpanKind.CLIENT,
                attributes={
                    "splyntra.span.type": "llm_call",
                    "gen_ai.system": "anthropic",
                    "gen_ai.request.model": model,
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

        # ─── Async messages ──────────────────────────────────────────────
        original_async_create = anthropic.resources.messages.AsyncMessages.create

        async def patched_async_create(self_client, *args, **kwargs):
            model = kwargs.get("model", "unknown")
            is_stream = kwargs.get("stream", False)
            # Inline guardrail pre-flight (run the blocking check off the event loop).
            import asyncio
            from .. import guard as _guard
            await asyncio.get_event_loop().run_in_executor(None, _guard.enforce, _guard.extract_text(kwargs), "input")
            span = tracer.start_span(
                f"anthropic.messages.{model}",
                kind=trace.SpanKind.CLIENT,
                attributes={
                    "splyntra.span.type": "llm_call",
                    "gen_ai.system": "anthropic",
                    "gen_ai.request.model": model,
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

        anthropic.resources.messages.Messages.create = patched_create
        anthropic.resources.messages.AsyncMessages.create = patched_async_create
        self._original_create = original_create
        self._original_async_create = original_async_create

    def _uninstrument(self, **kwargs):
        import anthropic

        if hasattr(self, "_original_create"):
            anthropic.resources.messages.Messages.create = self._original_create
        if hasattr(self, "_original_async_create"):
            anthropic.resources.messages.AsyncMessages.create = self._original_async_create


def _record_usage(span, result, start: float, model: str):
    """Record token usage and latency from a non-streaming Message response."""
    latency_ms = (time.time() - start) * 1000
    span.set_attribute("gen_ai.latency_ms", latency_ms)

    usage = getattr(result, "usage", None)
    if usage:
        # Anthropic: input_tokens / output_tokens -> map to the collector's
        # prompt/completion attribute names.
        prompt = getattr(usage, "input_tokens", 0) or 0
        completion = getattr(usage, "output_tokens", 0) or 0
        span.set_attribute("gen_ai.usage.prompt_tokens", prompt)
        span.set_attribute("gen_ai.usage.completion_tokens", completion)
        span.set_attribute("gen_ai.usage.total_tokens", prompt + completion)

    if hasattr(result, "model"):
        span.set_attribute("gen_ai.response.model", result.model)


def _wrap_stream(stream, span, start: float, model: str):
    """Wrap a sync streaming response to record usage when complete.

    Anthropic streams emit input_tokens on message_start and output_tokens on
    message_delta; accumulate whatever the chunks carry.
    """
    prompt_tokens = 0
    completion_tokens = 0
    response_model = model

    try:
        for chunk in stream:
            p, c, m = _read_chunk_usage(chunk, prompt_tokens, completion_tokens, response_model)
            prompt_tokens, completion_tokens, response_model = p, c, m
            yield chunk
    except Exception as e:
        span.set_status(StatusCode.ERROR, str(e))
        span.record_exception(e)
        span.end()
        raise
    else:
        _finish_stream_span(span, start, response_model, prompt_tokens, completion_tokens)


async def _wrap_async_stream(stream, span, start: float, model: str):
    """Wrap an async streaming response to record usage when complete."""
    prompt_tokens = 0
    completion_tokens = 0
    response_model = model

    try:
        async for chunk in stream:
            p, c, m = _read_chunk_usage(chunk, prompt_tokens, completion_tokens, response_model)
            prompt_tokens, completion_tokens, response_model = p, c, m
            yield chunk
    except Exception as e:
        span.set_status(StatusCode.ERROR, str(e))
        span.record_exception(e)
        span.end()
        raise
    else:
        _finish_stream_span(span, start, response_model, prompt_tokens, completion_tokens)


def _read_chunk_usage(chunk, prompt_tokens, completion_tokens, response_model):
    """Pull token/model info out of a streaming event, tolerating shapes."""
    # message_start carries message.usage.input_tokens; message_delta carries
    # usage.output_tokens.
    msg = getattr(chunk, "message", None)
    if msg is not None:
        u = getattr(msg, "usage", None)
        if u is not None and getattr(u, "input_tokens", None):
            prompt_tokens = u.input_tokens
        if getattr(msg, "model", None):
            response_model = msg.model
    u = getattr(chunk, "usage", None)
    if u is not None and getattr(u, "output_tokens", None):
        completion_tokens = u.output_tokens
    return prompt_tokens, completion_tokens, response_model


def _finish_stream_span(span, start, response_model, prompt_tokens, completion_tokens):
    latency_ms = (time.time() - start) * 1000
    span.set_attribute("gen_ai.latency_ms", latency_ms)
    span.set_attribute("gen_ai.response.model", response_model)
    if prompt_tokens:
        span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
    if completion_tokens:
        span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
    if prompt_tokens or completion_tokens:
        span.set_attribute("gen_ai.usage.total_tokens", prompt_tokens + completion_tokens)
    span.set_status(StatusCode.OK)
    span.end()
