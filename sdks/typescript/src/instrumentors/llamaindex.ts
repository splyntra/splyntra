// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode, Span } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";

/**
 * Auto-instrument LlamaIndex.TS (`llamaindex`). Query engines emit an `agent`
 * span; retrievers emit a `retrieval` span (so RAG latency/hits land in Tools &
 * Retrieval and feed the groundedness scorer). Mirrors the Python LlamaIndex
 * adapter. Best-effort: a safe no-op if the package/classes are absent.
 */
export function instrumentLlamaIndex(): boolean {
  return patchDual(["llamaindex"], patchLlama);
}

const QUERY_ENGINES = ["RetrieverQueryEngine", "SubQuestionQueryEngine", "RouterQueryEngine"];
const RETRIEVERS = ["VectorIndexRetriever", "SummaryIndexRetriever", "BaseRetriever", "KeywordTableRetriever"];

function patchLlama(mod: unknown): boolean {
  let wrapped = false;
  for (const cls of QUERY_ENGINES) {
    const C = pick(mod, cls) as { prototype?: any } | undefined;
    wrapped = wrapSpan(C?.prototype, "query", "agent", "llamaindex.query") || wrapped;
  }
  for (const cls of RETRIEVERS) {
    const C = pick(mod, cls) as { prototype?: any } | undefined;
    wrapped = wrapSpan(C?.prototype, "retrieve", "retrieval", "llamaindex.retrieve") || wrapped;
  }
  return wrapped;
}

function wrapSpan(proto: any, method: string, spanType: string, name: string): boolean {
  if (!proto || typeof proto[method] !== "function" || proto[method].__splyntraWrapped) return false;
  const original = proto[method];
  function patched(this: any, ...args: any[]) {
    const tracer = trace.getTracer("splyntra.llamaindex");
    return tracer.startActiveSpan(
      name,
      { kind: SpanKind.INTERNAL, attributes: { "splyntra.span.type": spanType, "splyntra.framework": "llamaindex" } },
      (span: Span) => {
        let result: any;
        try {
          result = original.apply(this, args);
        } catch (err: any) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        return Promise.resolve(result)
          .then((res: any) => {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return res;
          })
          .catch((err: any) => {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
            span.recordException(err);
            span.end();
            throw err;
          });
      }
    );
  }
  (patched as any).__splyntraWrapped = true;
  proto[method] = patched;
  return true;
}
