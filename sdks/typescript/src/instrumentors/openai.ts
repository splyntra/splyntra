// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

/**
 * Auto-instrument the `openai` Node SDK. Patches chat-completions creation to
 * emit an `llm_call` span with model + token usage. Best-effort: if `openai`
 * is not installed or its internals have moved, this is a safe no-op.
 *
 * Returns true if instrumentation was applied.
 */
export function instrumentOpenAI(): boolean {
  let openai: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    openai = require("openai");
  } catch {
    return false;
  }

  const Completions = openai?.OpenAI?.Chat?.Completions ?? openai?.Chat?.Completions;
  const proto = Completions?.prototype;
  if (!proto || typeof proto.create !== "function" || proto.create.__splyntraWrapped) {
    return false;
  }

  const original = proto.create;
  function patched(this: any, body: any, options: any) {
    const model = (body && body.model) || "unknown";
    const tracer = trace.getTracer("splyntra.openai");
    return tracer.startActiveSpan(
      `openai.chat.${model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "splyntra.span.type": "llm_call",
          "gen_ai.system": "openai",
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
              if (usage.prompt_tokens) span.setAttribute("gen_ai.usage.prompt_tokens", usage.prompt_tokens);
              if (usage.completion_tokens) span.setAttribute("gen_ai.usage.completion_tokens", usage.completion_tokens);
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
    );
  }
  (patched as any).__splyntraWrapped = true;
  proto.create = patched;
  return true;
}
