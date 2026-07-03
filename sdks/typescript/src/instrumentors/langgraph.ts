// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";

/**
 * Auto-instrument LangGraph.js (`@langchain/langgraph`). Wraps compiled-graph
 * `invoke` to emit a root `agent` span; nested LLM spans come from the OpenAI
 * instrumentor. Best-effort: a safe no-op if the package is absent or its
 * internals have moved. Patches both the CJS and ESM builds (see ./patch).
 *
 * Returns true if the synchronous CJS patch was applied.
 */
export function instrumentLangGraph(): boolean {
  return patchDual(["@langchain/langgraph"], patchLangGraph);
}

function patchLangGraph(mod: unknown): boolean {
  const Compiled = (pick(mod, "CompiledStateGraph") ?? pick(mod, "CompiledGraph")) as
    | { prototype?: Record<string, unknown> }
    | undefined;
  const proto = Compiled?.prototype;
  if (!proto || typeof proto.invoke !== "function" || (proto.invoke as { __splyntraWrapped?: boolean }).__splyntraWrapped) {
    return false;
  }

  const original = proto.invoke as (...args: unknown[]) => unknown;
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
