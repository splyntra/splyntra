// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";
import { enforceGuard, extractText } from "../guard";

/**
 * Auto-instrument the `openai` Node SDK. Patches chat-completions creation to
 * emit an `llm_call` span with model + token usage. Best-effort: if `openai`
 * is not installed or its internals have moved, this is a safe no-op.
 *
 * Patches both the CommonJS and ES-module builds of `openai` (the package ships
 * both; a CJS require and an ESM import resolve different copies), so it works
 * whether the host app is CJS or ESM. Returns true if the synchronous CJS patch
 * was applied; the ESM patch, when needed, completes on the next microtask.
 */
export function instrumentOpenAI(): boolean {
  return patchDual(["openai"], patchOpenAI);
}

// Idempotent: guarded by __splyntraWrapped so patching the CJS and ESM builds
// (or the same build twice) never double-wraps.
function patchOpenAI(mod: unknown): boolean {
  const OpenAI = (pick(mod, "OpenAI") ?? (mod as Record<string, unknown>)?.default ?? mod) as
    | Record<string, unknown>
    | undefined;
  const Chat = (OpenAI?.Chat ?? pick(mod, "Chat")) as Record<string, unknown> | undefined;
  const Completions = Chat?.Completions as { prototype?: Record<string, unknown> } | undefined;
  const proto = Completions?.prototype;
  if (!proto || typeof proto.create !== "function" || (proto.create as { __splyntraWrapped?: boolean }).__splyntraWrapped) {
    return false;
  }

  const original = proto.create as (...args: unknown[]) => unknown;
  // OpenAI-compatible providers set a custom baseURL; map the host to the provider.
  const PROVIDER_HOSTS: [string, string][] = [
    ["api.groq.com", "groq"], ["together.", "together"], ["api.deepseek.com", "deepseek"],
    ["openrouter.ai", "openrouter"], ["api.x.ai", "xai"], ["fireworks.ai", "fireworks"],
    ["api.mistral.ai", "mistral"], ["generativelanguage.googleapis", "gemini"], ["api.cohere", "cohere"],
  ];
  function providerFromClient(self: any): string {
    try {
      const base = String(self?._client?.baseURL || "").toLowerCase();
      for (const [frag, name] of PROVIDER_HOSTS) if (base.includes(frag)) return name;
    } catch {
      /* ignore */
    }
    return "openai";
  }
  function patched(this: unknown, body: any, options: any) {
    const model = (body && body.model) || "unknown";
    const tracer = trace.getTracer("splyntra.openai");
    // Inline guardrail pre-flight: may reject with SplyntraBlocked before the call.
    return enforceGuard(extractText(body), "input").then(() =>
    tracer.startActiveSpan(
      `openai.chat.${model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "splyntra.span.type": "llm_call",
          "gen_ai.system": providerFromClient(this),
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
    )
    );
  }
  (patched as any).__splyntraWrapped = true;
  proto.create = patched;
  return true;
}
