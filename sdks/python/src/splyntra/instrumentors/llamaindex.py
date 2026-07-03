# SPDX-License-Identifier: Apache-2.0
"""LlamaIndex instrumentor — query engines emit an `agent` span, retrievers emit
a `retrieval` span (so RAG latency/hits land in Tools & Retrieval). Best-effort:
a safe no-op if `llama_index` isn't installed or its module paths differ.
"""

from __future__ import annotations

import time
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode


def _wrap(cls, method, tracer, span_type, name):
    orig = getattr(cls, method, None)
    if orig is None or getattr(orig, "__splyntra_wrapped", False):
        return None

    def wrapper(self_obj, *args, **kw):
        span = tracer.start_span(name, kind=trace.SpanKind.INTERNAL, attributes={"splyntra.span.type": span_type})
        start = time.time()
        try:
            result = orig(self_obj, *args, **kw)
            span.set_attribute("splyntra.tool.duration_ms", (time.time() - start) * 1000)
            span.set_status(StatusCode.OK)
            span.end()
            return result
        except Exception as e:
            span.set_status(StatusCode.ERROR, str(e))
            span.record_exception(e)
            span.end()
            raise

    wrapper.__splyntra_wrapped = True
    setattr(cls, method, wrapper)
    return orig


class LlamaIndexInstrumentor(BaseInstrumentor):
    def instrumentation_dependencies(self) -> Collection[str]:
        return ("llama-index-core >= 0.10.0",)

    def _instrument(self, **kwargs):
        tracer = trace.get_tracer("splyntra.llamaindex")
        self._orig = []
        # Query engine → agent span.
        try:
            from llama_index.core.base.base_query_engine import BaseQueryEngine

            o = _wrap(BaseQueryEngine, "query", tracer, "agent", "llamaindex.query")
            if o:
                self._orig.append((BaseQueryEngine, "query", o))
        except Exception:
            pass
        # Retriever → retrieval span.
        try:
            from llama_index.core.base.base_retriever import BaseRetriever

            o = _wrap(BaseRetriever, "retrieve", tracer, "retrieval", "llamaindex.retrieve")
            if o:
                self._orig.append((BaseRetriever, "retrieve", o))
        except Exception:
            pass

    def _uninstrument(self, **kwargs):
        for cls, method, orig in getattr(self, "_orig", []):
            setattr(cls, method, orig)
