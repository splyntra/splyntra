# SPDX-License-Identifier: Apache-2.0
"""Pydantic AI instrumentor — wraps Agent.run / run_sync to emit an `agent` span.
Best-effort: a safe no-op if `pydantic_ai` isn't installed or its API differs.
"""

from __future__ import annotations

import time
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode


class PydanticAIInstrumentor(BaseInstrumentor):
    def instrumentation_dependencies(self) -> Collection[str]:
        return ("pydantic-ai >= 0.0.1",)

    def _instrument(self, **kwargs):
        try:
            from pydantic_ai import Agent
        except Exception:
            return
        tracer = trace.get_tracer("splyntra.pydantic_ai")
        self._orig = {}

        def make_sync(orig):
            def wrapper(self_agent, *args, **kw):
                span = tracer.start_span("pydantic_ai.run", kind=trace.SpanKind.INTERNAL,
                                         attributes={"splyntra.span.type": "agent", "splyntra.framework": "pydantic-ai"})
                start = time.time()
                try:
                    result = orig(self_agent, *args, **kw)
                    span.set_attribute("splyntra.tool.duration_ms", (time.time() - start) * 1000)
                    span.set_status(StatusCode.OK)
                    span.end()
                    return result
                except Exception as e:
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    span.end()
                    raise
            return wrapper

        def make_async(orig):
            async def wrapper(self_agent, *args, **kw):
                span = tracer.start_span("pydantic_ai.run", kind=trace.SpanKind.INTERNAL,
                                         attributes={"splyntra.span.type": "agent", "splyntra.framework": "pydantic-ai"})
                start = time.time()
                try:
                    result = await orig(self_agent, *args, **kw)
                    span.set_attribute("splyntra.tool.duration_ms", (time.time() - start) * 1000)
                    span.set_status(StatusCode.OK)
                    span.end()
                    return result
                except Exception as e:
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    span.end()
                    raise
            return wrapper

        for method, factory in (("run_sync", make_sync), ("run", make_async)):
            orig = getattr(Agent, method, None)
            if orig is None or getattr(orig, "__splyntra_wrapped", False):
                continue
            wrapped = factory(orig)
            wrapped.__splyntra_wrapped = True
            setattr(Agent, method, wrapped)
            self._orig[method] = orig

    def _uninstrument(self, **kwargs):
        try:
            from pydantic_ai import Agent
        except Exception:
            return
        for method, orig in getattr(self, "_orig", {}).items():
            setattr(Agent, method, orig)
