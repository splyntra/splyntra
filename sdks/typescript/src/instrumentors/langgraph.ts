// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

/**
 * Auto-instrument LangGraph.js (`@langchain/langgraph`). Wraps compiled-graph
 * `invoke` to emit a root `agent` span; nested LLM spans come from the OpenAI
 * instrumentor. Best-effort: a safe no-op if the package is absent or its
 * internals have moved.
 *
 * Returns true if instrumentation was applied.
 */
export function instrumentLangGraph(): boolean {
  let lg: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    lg = require("@langchain/langgraph");
  } catch {
    return false;
  }

  const Compiled = lg?.CompiledStateGraph ?? lg?.CompiledGraph;
  const proto = Compiled?.prototype;
  if (!proto || typeof proto.invoke !== "function" || proto.invoke.__splyntraWrapped) {
    return false;
  }

  const original = proto.invoke;
  function patched(this: any, ...args: any[]) {
    const name = this?.name || "langgraph";
    const tracer = trace.getTracer("splyntra.langgraph");
    return tracer.startActiveSpan(
      name,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "splyntra.span.type": "agent",
          "splyntra.agent.name": name,
          "splyntra.framework": "langgraph",
        },
      },
      (span) => {
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
  proto.invoke = patched;
  return true;
}
