// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode, Span } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";

/**
 * Auto-instrument the Chroma client (`chromadb`). Wraps Collection.query/get to
 * emit `vector_search` spans (db.system, collection, top_k, hits) so RAG
 * retrieval latency/failures land in Splyntra's Tools & Retrieval view. Mirrors
 * the Python Chroma adapter. Best-effort: a safe no-op if the package is absent.
 */
export function instrumentChroma(): boolean {
  return patchDual(["chromadb"], patchChroma);
}

function patchChroma(mod: unknown): boolean {
  const Collection = pick(mod, "Collection") as { prototype?: any } | undefined;
  if (!Collection?.prototype) return false;
  let wrapped = false;
  for (const op of ["query", "get"]) wrapped = wrapVector(Collection.prototype, op) || wrapped;
  return wrapped;
}

function wrapVector(proto: any, method: string): boolean {
  if (!proto || typeof proto[method] !== "function" || proto[method].__splyntraWrapped) return false;
  const original = proto[method];
  function patched(this: any, ...args: any[]) {
    const tracer = trace.getTracer("splyntra.chroma");
    const arg0 = (args[0] as { nResults?: number } | undefined) || {};
    return tracer.startActiveSpan(
      `chroma.${method}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "splyntra.span.type": "vector_search",
          "db.system": "chroma",
          "vector.collection": this?.name || "",
          "vector.top_k": arg0?.nResults || 0,
        },
      },
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
            try {
              const ids = res?.ids;
              if (Array.isArray(ids)) span.setAttribute("vector.hits", ids.reduce((n: number, x: any) => n + (Array.isArray(x) ? x.length : 0), 0));
            } catch { /* result shape varies */ }
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
