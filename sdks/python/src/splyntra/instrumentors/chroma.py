# SPDX-License-Identifier: Apache-2.0
"""Chroma instrumentor — emits `vector_search` spans for collection queries so
RAG retrieval latency and failures show up in Splyntra's Tools & Retrieval view.
Best-effort: a safe no-op if `chromadb` isn't installed or its internals move.
"""

from __future__ import annotations

import time
from typing import Collection as TypingCollection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode


class ChromaInstrumentor(BaseInstrumentor):
    def instrumentation_dependencies(self) -> TypingCollection[str]:
        return ("chromadb >= 0.4.0",)

    def _instrument(self, **kwargs):
        try:
            from chromadb.api.models.Collection import Collection
        except Exception:
            return
        tracer = trace.get_tracer("splyntra.chroma")

        for op in ("query", "get"):
            orig = getattr(Collection, op, None)
            if orig is None or getattr(orig, "__splyntra_wrapped", False):
                continue

            def make(orig_fn, op_name):
                def wrapper(self_coll, *args, **kw):
                    span = tracer.start_span(
                        f"chroma.{op_name}",
                        kind=trace.SpanKind.CLIENT,
                        attributes={
                            "splyntra.span.type": "vector_search",
                            "db.system": "chroma",
                            "vector.collection": getattr(self_coll, "name", ""),
                            "vector.top_k": kw.get("n_results", 0) or 0,
                        },
                    )
                    start = time.time()
                    try:
                        result = orig_fn(self_coll, *args, **kw)
                        try:
                            ids = result.get("ids") if isinstance(result, dict) else None
                            if ids is not None:
                                span.set_attribute("vector.hits", sum(len(x) for x in ids))
                        except Exception:
                            pass
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

            wrapped = make(orig, op)
            wrapped.__splyntra_wrapped = True
            setattr(Collection, op, wrapped)
            self.__dict__.setdefault("_orig", {})[op] = orig

    def _uninstrument(self, **kwargs):
        try:
            from chromadb.api.models.Collection import Collection
        except Exception:
            return
        for op, orig in self.__dict__.get("_orig", {}).items():
            setattr(Collection, op, orig)
