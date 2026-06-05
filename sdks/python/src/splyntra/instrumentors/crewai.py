# SPDX-License-Identifier: Apache-2.0
"""CrewAI instrumentor — emits a root ``agent`` span for each crew kickoff, a
``step`` span per task/agent execution, and ``tool_call`` spans for tool usage.

Combined with the OpenAI instrumentor (which produces ``llm_call`` spans), this
yields a fully nested execution trace for CrewAI crews with no per-call code
changes. All patching is guarded so importing/enabling the instrumentor is safe
even when CrewAI is not installed (it simply no-ops).
"""

from __future__ import annotations

import functools
from typing import Collection

from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.trace import StatusCode

_FRAMEWORK = "crewai"


class CrewAIInstrumentor(BaseInstrumentor):
    """Instruments CrewAI crew/task/tool execution.

    Usage:
        from splyntra.instrumentors import CrewAIInstrumentor
        CrewAIInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ("crewai >= 0.30.0",)

    def _instrument(self, **kwargs):
        self._patched: list = []
        tracer = trace.get_tracer("splyntra.crewai")

        self._patch(tracer, "crewai", "Crew", ("kickoff", "kickoff_async"), "agent", _crew_name)
        self._patch(tracer, "crewai", "Task", ("execute_sync", "execute_async", "execute"), "step", _task_name)
        self._patch(tracer, "crewai.tools", "BaseTool", ("run", "_run"), "tool_call", _tool_name)

    def _patch(self, tracer, module_path, cls_name, methods, span_type, namer):
        try:
            module = __import__(module_path, fromlist=[cls_name])
            cls = getattr(module, cls_name, None)
        except Exception:  # noqa: BLE001 - CrewAI not installed / layout changed
            return
        if cls is None:
            return
        for method in methods:
            original = getattr(cls, method, None)
            if original is None or getattr(original, "_splyntra_wrapped", False):
                continue
            wrapped = _wrap(tracer, original, span_type, namer, is_async="async" in method)
            wrapped._splyntra_wrapped = True
            setattr(cls, method, wrapped)
            self._patched.append((cls, method, original))

    def _uninstrument(self, **kwargs):
        for cls, method, original in getattr(self, "_patched", []):
            setattr(cls, method, original)
        self._patched = []


def _crew_name(instance) -> str:
    return getattr(instance, "name", None) or "crew"


def _task_name(instance) -> str:
    desc = getattr(instance, "description", None)
    if desc:
        return desc[:60]
    return getattr(instance, "name", None) or "task"


def _tool_name(instance) -> str:
    return getattr(instance, "name", None) or instance.__class__.__name__ or "tool"


def _attrs(span_type: str, name: str) -> dict:
    base = {"splyntra.span.type": span_type, "splyntra.framework": _FRAMEWORK}
    if span_type == "agent":
        base["splyntra.agent.name"] = name
    elif span_type == "tool_call":
        base["splyntra.tool.name"] = name
    return base


def _wrap(tracer, original, span_type: str, namer, is_async: bool):
    if is_async:
        @functools.wraps(original)
        async def awrapper(self, *args, **kwargs):
            with tracer.start_as_current_span(
                namer(self), kind=trace.SpanKind.INTERNAL, attributes=_attrs(span_type, namer(self))
            ) as span:
                try:
                    result = await original(self, *args, **kwargs)
                    span.set_status(StatusCode.OK)
                    return result
                except Exception as e:  # noqa: BLE001
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    raise

        return awrapper

    @functools.wraps(original)
    def wrapper(self, *args, **kwargs):
        with tracer.start_as_current_span(
            namer(self), kind=trace.SpanKind.INTERNAL, attributes=_attrs(span_type, namer(self))
        ) as span:
            try:
                result = original(self, *args, **kwargs)
                span.set_status(StatusCode.OK)
                return result
            except Exception as e:  # noqa: BLE001
                span.set_status(StatusCode.ERROR, str(e))
                span.record_exception(e)
                raise

    return wrapper
