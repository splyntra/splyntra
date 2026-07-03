// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";

/**
 * Auto-instrument the `ollama` Node SDK (local models). Patches chat/generate to
 * emit an `llm_call` span with model + token usage. Best-effort: a safe no-op if
 * the package is absent or its internals moved.
 *
 * Ollama reports usage as prompt_eval_count / eval_count (top-level on the
 * response, not under `.usage`); we map them onto the same
 * gen_ai.usage.prompt_tokens / completion_tokens attributes the collector reads.
 * Patches the `Ollama` class prototype (covers `new Ollama().chat()`) and the
 * default exported instance (covers `import ollama from "ollama"; ollama.chat()`),
 * across both the CJS and ESM builds (see ./patch).
 *
 * Returns true if the synchronous CJS patch was applied.
 */
export function instrumentOllama(): boolean {
  return patchDual(["ollama"], patchOllama);
}

function patchOllama(mod: unknown): boolean {
  const OllamaClass = pick(mod, "Ollama") as { prototype?: Record<string, unknown> } | undefined;
  const defaultInstance = ((mod as Record<string, unknown>)?.default ?? mod) as Record<string, unknown> | undefined;

  let wrapped = false;
  for (const op of ["chat", "generate"]) {
    // Prototype methods — cover `new Ollama().chat()`.
    if (wrapMethod(OllamaClass?.prototype, op)) wrapped = true;
    // Default-instance own methods — cover the module default export, whose
    // methods may be bound in the constructor (prototype patch wouldn't reach them).
    if (defaultInstance && Object.prototype.hasOwnProperty.call(defaultInstance, op)) {
      wrapMethod(defaultInstance, op);
    }
  }
  return wrapped;
}

// Replace target[op] with a span-emitting wrapper. Idempotent. Returns true if wrapped.
function wrapMethod(target: Record<string, unknown> | undefined, op: string): boolean {
  if (!target || typeof target[op] !== "function" || (target[op] as { __splyntraWrapped?: boolean }).__splyntraWrapped) {
    return false;
  }
  const original = target[op] as (...args: unknown[]) => unknown;
  function patched(this: unknown, request: any) {
    const model = (request && request.model) || "unknown";
    const tracer = trace.getTracer("splyntra.ollama");
    return tracer.startActiveSpan(
      `ollama.${op}.${model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "splyntra.span.type": "llm_call",
          "gen_ai.system": "ollama",
          "gen_ai.request.model": model,
        },
      },
      (span: Span) => {
        const start = Date.now();
        let result: any;
        try {
          result = original.call(this, request);
        } catch (err: any) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        return Promise.resolve(result)
          .then((res: any) => {
            span.setAttribute("gen_ai.latency_ms", Date.now() - start);
            // Ollama: token counts are top-level on the response.
            if (res?.prompt_eval_count) span.setAttribute("gen_ai.usage.prompt_tokens", res.prompt_eval_count);
            if (res?.eval_count) span.setAttribute("gen_ai.usage.completion_tokens", res.eval_count);
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
  target[op] = patched;
  return true;
}
