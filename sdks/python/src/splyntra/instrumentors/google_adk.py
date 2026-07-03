# SPDX-License-Identifier: Apache-2.0
"""Google ADK (Agent Development Kit) instrumentor — wraps Runner.run / run_async
to emit an `agent` span. Best-effort: a safe no-op if `google-adk` isn't installed
or its API differs.
"""

from __future__ import annotations

import time
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode


class GoogleADKInstrumentor(BaseInstrumentor):
    def instrumentation_dependencies(self) -> Collection[str]:
        return ("google-adk >= 0.1.0",)

    def _instrument(self, **kwargs):
        try:
            from google.adk.runners import Runner
        except Exception:
            return
        tracer = trace.get_tracer("splyntra.google_adk")
        self._orig = {}

        def make(orig, is_async):
            if is_async:
                async def awrapper(self_runner, *args, **kw):
                    span = tracer.start_span("adk.run", kind=trace.SpanKind.INTERNAL,
                                             attributes={"splyntra.span.type": "agent", "splyntra.framework": "google-adk"})
                    start = time.time()
                    try:
                        result = await orig(self_runner, *args, **kw)
                        span.set_attribute("splyntra.tool.duration_ms", (time.time() - start) * 1000)
                        span.set_status(StatusCode.OK)
                        span.end()
                        return result
                    except Exception as e:
                        span.set_status(StatusCode.ERROR, str(e))
                        span.record_exception(e)
                        span.end()
                        raise
                return awrapper

            def wrapper(self_runner, *args, **kw):
                span = tracer.start_span("adk.run", kind=trace.SpanKind.INTERNAL,
                                         attributes={"splyntra.span.type": "agent", "splyntra.framework": "google-adk"})
                start = time.time()
                try:
                    result = orig(self_runner, *args, **kw)
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

        for method, is_async in (("run", False), ("run_async", True)):
            orig = getattr(Runner, method, None)
            if orig is None or getattr(orig, "__splyntra_wrapped", False):
                continue
            wrapped = make(orig, is_async)
            wrapped.__splyntra_wrapped = True
            setattr(Runner, method, wrapped)
            self._orig[method] = orig

    def _uninstrument(self, **kwargs):
        try:
            from google.adk.runners import Runner
        except Exception:
            return
        for method, orig in getattr(self, "_orig", {}).items():
            setattr(Runner, method, orig)
