# SPDX-License-Identifier: Apache-2.0
"""LangGraph instrumentor — emits a root ``agent`` span for each graph run and
a nested ``step`` span for each node execution.

Combined with the OpenAI instrumentor (which produces ``llm_call`` spans), this
yields a fully nested execution trace for LangGraph agents with no per-call
code changes. All patching is guarded so importing/enabling the instrumentor is
safe even when LangGraph is not installed (it simply no-ops).
"""

from __future__ import annotations

import functools
from typing import Collection

from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.trace import StatusCode

_FRAMEWORK = "langgraph"


class LangGraphInstrumentor(BaseInstrumentor):
    """Instruments LangGraph's compiled-graph execution.

    Usage:
        from splyntra.instrumentors import LangGraphInstrumentor
        LangGraphInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ("langgraph >= 0.1.0",)

    def _instrument(self, **kwargs):
        self._patched: list = []
        tracer = trace.get_tracer("splyntra.langgraph")

        self._patch_graph(tracer)
        self._patch_nodes(tracer)

    def _patch_graph(self, tracer):
        try:
            from langgraph.pregel import Pregel
        except Exception:  # noqa: BLE001 - LangGraph not installed / moved
            return

        for method in ("invoke", "ainvoke"):
            original = getattr(Pregel, method, None)
            if original is None or getattr(original, "_splyntra_wrapped", False):
                continue
            wrapped = _wrap_agent(tracer, original, is_async=method.startswith("a"))
            wrapped._splyntra_wrapped = True
            setattr(Pregel, method, wrapped)
            self._patched.append((Pregel, method, original))

    def _patch_nodes(self, tracer):
        # Node functions are wrapped by LangGraph in RunnableCallable; patching
        # it surfaces a step span per node. Best-effort across versions.
        try:
            from langgraph.utils.runnable import RunnableCallable
        except Exception:  # noqa: BLE001
            return

        for method in ("invoke", "ainvoke"):
            original = getattr(RunnableCallable, method, None)
            if original is None or getattr(original, "_splyntra_wrapped", False):
                continue
            wrapped = _wrap_node(tracer, original, is_async=method.startswith("a"))
            wrapped._splyntra_wrapped = True
            setattr(RunnableCallable, method, wrapped)
            self._patched.append((RunnableCallable, method, original))

    def _uninstrument(self, **kwargs):
        for cls, method, original in getattr(self, "_patched", []):
            setattr(cls, method, original)
        self._patched = []


def _graph_name(instance) -> str:
    return getattr(instance, "name", None) or instance.__class__.__name__ or _FRAMEWORK


def _node_name(instance) -> str:
    return getattr(instance, "name", None) or "node"


def _wrap_agent(tracer, original, is_async: bool):
    if is_async:
        @functools.wraps(original)
        async def awrapper(self, *args, **kwargs):
            with tracer.start_as_current_span(
                _graph_name(self),
                kind=trace.SpanKind.INTERNAL,
                attributes={
                    "splyntra.span.type": "agent",
                    "splyntra.agent.name": _graph_name(self),
                    "splyntra.framework": _FRAMEWORK,
                },
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
            _graph_name(self),
            kind=trace.SpanKind.INTERNAL,
            attributes={
                "splyntra.span.type": "agent",
                "splyntra.agent.name": _graph_name(self),
                "splyntra.framework": _FRAMEWORK,
            },
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


def _wrap_node(tracer, original, is_async: bool):
    if is_async:
        @functools.wraps(original)
        async def awrapper(self, *args, **kwargs):
            with tracer.start_as_current_span(
                _node_name(self),
                kind=trace.SpanKind.INTERNAL,
                attributes={"splyntra.span.type": "step", "splyntra.node.name": _node_name(self)},
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
            _node_name(self),
            kind=trace.SpanKind.INTERNAL,
            attributes={"splyntra.span.type": "step", "splyntra.node.name": _node_name(self)},
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
