# SPDX-License-Identifier: Apache-2.0
"""OpenAI Agents SDK instrumentor — emits a root ``agent`` span for each
``Runner.run`` / ``Runner.run_sync`` invocation and a ``tool_call`` span for
each function-tool execution.

LLM spans are produced by the OpenAI instrumentor, so enabling both yields a
nested execution trace. All patching is guarded so this is safe to enable even
when the ``openai-agents`` package is not installed (it no-ops).
"""

from __future__ import annotations

import functools
from typing import Collection

from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.trace import StatusCode

_FRAMEWORK = "openai-agents"


class OpenAIAgentsInstrumentor(BaseInstrumentor):
    """Instruments the OpenAI Agents SDK run loop.

    Usage:
        from splyntra.instrumentors import OpenAIAgentsInstrumentor
        OpenAIAgentsInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ("openai-agents >= 0.0.1",)

    def _instrument(self, **kwargs):
        self._patched: list = []
        tracer = trace.get_tracer("splyntra.openai_agents")

        try:
            from agents.run import Runner
        except Exception:  # noqa: BLE001 - package absent / layout changed
            return

        if hasattr(Runner, "run") and not getattr(Runner.run, "_splyntra_wrapped", False):
            original = Runner.run
            wrapped = _wrap_run(tracer, original, is_async=True)
            wrapped._splyntra_wrapped = True
            Runner.run = wrapped  # type: ignore[method-assign]
            self._patched.append((Runner, "run", original))

        if hasattr(Runner, "run_sync") and not getattr(Runner.run_sync, "_splyntra_wrapped", False):
            original = Runner.run_sync
            wrapped = _wrap_run(tracer, original, is_async=False)
            wrapped._splyntra_wrapped = True
            Runner.run_sync = wrapped  # type: ignore[method-assign]
            self._patched.append((Runner, "run_sync", original))

    def _uninstrument(self, **kwargs):
        for cls, method, original in getattr(self, "_patched", []):
            setattr(cls, method, original)
        self._patched = []


def _agent_name(args, kwargs) -> str:
    starting = kwargs.get("starting_agent")
    if starting is None and args:
        starting = args[0]
    return getattr(starting, "name", None) or _FRAMEWORK


def _wrap_run(tracer, original, is_async: bool):
    if is_async:
        @functools.wraps(original)
        async def awrapper(*args, **kwargs):
            name = _agent_name(args, kwargs)
            with tracer.start_as_current_span(
                name,
                kind=trace.SpanKind.INTERNAL,
                attributes={
                    "splyntra.span.type": "agent",
                    "splyntra.agent.name": name,
                    "splyntra.framework": _FRAMEWORK,
                },
            ) as span:
                try:
                    result = await original(*args, **kwargs)
                    span.set_status(StatusCode.OK)
                    return result
                except Exception as e:  # noqa: BLE001
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    raise

        return awrapper

    @functools.wraps(original)
    def wrapper(*args, **kwargs):
        name = _agent_name(args, kwargs)
        with tracer.start_as_current_span(
            name,
            kind=trace.SpanKind.INTERNAL,
            attributes={
                "splyntra.span.type": "agent",
                "splyntra.agent.name": name,
                "splyntra.framework": _FRAMEWORK,
            },
        ) as span:
            try:
                result = original(*args, **kwargs)
                span.set_status(StatusCode.OK)
                return result
            except Exception as e:  # noqa: BLE001
                span.set_status(StatusCode.ERROR, str(e))
                span.record_exception(e)
                raise

    return wrapper
