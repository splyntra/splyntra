// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";
import { enforceGuard, extractText } from "../guard";

/**
 * Auto-instrument the `@anthropic-ai/sdk` (Claude) Node SDK. Patches
 * Messages.create to emit an `llm_call` span with model + token usage.
 * Best-effort: a safe no-op if the package is absent or its internals moved.
 *
 * Anthropic reports usage as input_tokens / output_tokens (not prompt/
 * completion); we map them onto the same gen_ai.usage.prompt_tokens /
 * completion_tokens attributes the collector already reads, so cost/token
 * analytics work unchanged. Patches both the CJS and ESM builds (see ./patch),
 * so it works whether the host app is CJS or ESM.
 *
 * Returns true if the synchronous CJS patch was applied.
 */
export function instrumentAnthropic(): boolean {
  return patchDual(["@anthropic-ai/sdk"], patchAnthropic);
}

// Idempotent: guarded by __splyntraWrapped so patching the CJS and ESM builds
// (or the same build twice) never double-wraps.
function patchAnthropic(mod: unknown): boolean {
  const AnthropicClass = (pick(mod, "Anthropic") ?? (mod as Record<string, unknown>)?.default ?? mod) as
    | Record<string, unknown>
    | undefined;
  const Messages = (AnthropicClass?.Messages ?? pick(mod, "Messages")) as
    | { prototype?: Record<string, unknown> }
    | undefined;
  const proto = Messages?.prototype;
  if (!proto || typeof proto.create !== "function" || (proto.create as { __splyntraWrapped?: boolean }).__splyntraWrapped) {
    return false;
  }

  const original = proto.create as (...args: unknown[]) => unknown;
  function patched(this: unknown, body: any, options: any) {
    const model = (body && body.model) || "unknown";
    const tracer = trace.getTracer("splyntra.anthropic");
    // Inline guardrail pre-flight: may reject with SplyntraBlocked before the call.
    return enforceGuard(extractText(body), "input").then(() =>
    tracer.startActiveSpan(
      `anthropic.messages.${model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "splyntra.span.type": "llm_call",
          "gen_ai.system": "anthropic",
          "gen_ai.request.model": model,
        },
      },
      (span) => {
        const start = Date.now();
        let result: any;
        try {
          result = original.call(this, body, options);
        } catch (err: any) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        return Promise.resolve(result)
          .then((res: any) => {
            span.setAttribute("gen_ai.latency_ms", Date.now() - start);
            const usage = res?.usage;
            if (usage) {
              // Anthropic: input_tokens / output_tokens.
              if (usage.input_tokens) span.setAttribute("gen_ai.usage.prompt_tokens", usage.input_tokens);
              if (usage.output_tokens) span.setAttribute("gen_ai.usage.completion_tokens", usage.output_tokens);
            }
            if (res?.model) span.setAttribute("gen_ai.response.model", res.model);
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
    )
    );
  }
  (patched as any).__splyntraWrapped = true;
  proto.create = patched;
  return true;
}
