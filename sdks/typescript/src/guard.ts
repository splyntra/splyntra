// SPDX-License-Identifier: Apache-2.0
// Inline guardrail — a synchronous pre-flight check that can block a prompt
// before it reaches the model provider. Instrumentors call `enforceGuard` just
// before the provider call; it posts the prompt to the collector's `/v1/guard`
// endpoint and enforces the verdict per the configured mode.
//
//   off     — no guard calls (default)
//   monitor — call the guard and log the verdict, but never alter or block
//   block   — throw SplyntraBlocked on a `block` or `redact` verdict (flagged
//             content is never sent to the provider)
//
// `failOpen` (default true) lets a guard error/timeout proceed; set false to
// fail closed in block mode.

export type GuardMode = "off" | "monitor" | "block";

export class SplyntraBlocked extends Error {
  reasons: string[];
  constructor(reasons: string[]) {
    super("Splyntra guard blocked the request: " + (reasons.join(", ") || "policy"));
    this.name = "SplyntraBlocked";
    this.reasons = reasons;
  }
}

interface GuardConfig {
  mode: GuardMode;
  failOpen: boolean;
  endpoint: string;
  apiKey: string;
}

let cfg: GuardConfig = { mode: "off", failOpen: true, endpoint: "http://localhost:4318", apiKey: "" };

export function configureGuard(c: Partial<GuardConfig>): void {
  cfg = {
    ...cfg,
    ...c,
    endpoint: (c.endpoint || cfg.endpoint).replace(/\/+$/, ""),
  };
}

interface Decision {
  action?: "allow" | "redact" | "block";
  reasons?: string[];
}

async function check(content: string, direction: string): Promise<Decision> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${cfg.endpoint}/v1/guard`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content, direction }),
    });
    // A non-2xx response (e.g. 403 missing guard scope, 5xx) has no usable
    // verdict — its JSON error body lacks `action`, which would otherwise be
    // treated as "allow" and silently forward flagged content in fail-closed
    // mode. Throw so enforceGuard applies the configured fail-open/closed policy.
    if (!res.ok) throw new Error(`guard http ${res.status}`);
    return (await res.json()) as Decision;
  } finally {
    clearTimeout(timer);
  }
}

/** Guard `content`. Resolves when allowed; throws SplyntraBlocked in block mode. */
export async function enforceGuard(content: string, direction = "input"): Promise<void> {
  if (cfg.mode === "off" || !content) return;

  let decision: Decision;
  try {
    decision = await check(content, direction);
  } catch (e) {
    // monitor mode observes but never enforces, so a guard error must not block
    // even when failOpen is false.
    if (cfg.failOpen || cfg.mode === "monitor") {
      console.warn("[splyntra] guard check failed, proceeding (not enforced):", e);
      return;
    }
    throw new SplyntraBlocked(["guard_unavailable"]);
  }

  const action = decision?.action || "allow";
  const reasons = decision?.reasons || [];
  if (action === "allow") return;
  if (cfg.mode === "monitor") {
    console.warn(`[splyntra] guard verdict (monitor, not enforced): ${action}`, reasons);
    return;
  }
  throw new SplyntraBlocked(reasons);
}

/** Best-effort prompt-text extraction from an OpenAI/Anthropic-style request. */
export function extractText(body: any): string {
  const parts: string[] = [];
  if (typeof body?.system === "string") parts.push(body.system);
  if (typeof body?.prompt === "string") parts.push(body.prompt);
  for (const m of body?.messages || []) {
    const c = m?.content;
    if (typeof c === "string") parts.push(c);
    else if (Array.isArray(c)) for (const b of c) if (typeof b?.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}
