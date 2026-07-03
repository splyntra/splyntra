// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";

/**
 * Auto-instrument the OpenAI Agents SDK (`@openai/agents`, or the `openai-agents`
 * alias). Wraps Runner.run / Runner.runSync to emit a root `agent` span,
 * mirroring the Python adapter. Best-effort: a safe no-op if the package is
 * absent or its internals moved. Patches both the CJS and ESM builds (see ./patch).
 *
 * Returns true if the synchronous CJS patch was applied.
 */
export function instrumentOpenAIAgents(): boolean {
  return patchDual(["@openai/agents", "openai-agents"], patchOpenAIAgents);
}

function patchOpenAIAgents(mod: unknown): boolean {
  const run = pick(mod, "run") as Record<string, unknown> | undefined;
  const Runner = (pick(mod, "Runner") ?? run?.Runner) as { prototype?: any } | undefined;
  const proto = Runner?.prototype;
  if (!proto) return false;

  let wrapped = false;
  for (const m of ["run", "runSync"]) {
    if (typeof proto[m] !== "function" || proto[m].__splyntraWrapped) continue;
    const original = proto[m];
    function patched(this: any, ...args: any[]) {
      // Agent is the first positional arg or a `startingAgent`/`agent` field.
      const a0 = args[0];
      const name = a0?.name || a0?.startingAgent?.name || a0?.agent?.name || "agent";
      const tracer = trace.getTracer("splyntra.openai-agents");
      return tracer.startActiveSpan(
        name,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            "splyntra.span.type": "agent",
            "splyntra.agent.name": name,
            "splyntra.framework": "openai-agents",
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
    proto[m] = patched;
    wrapped = true;
  }
  return wrapped;
}
