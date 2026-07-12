// SPDX-License-Identifier: Apache-2.0
/**
 * Governance helpers — call the collector's decision + ledger endpoints (npm
 * parity with the Python `authorize` / `log_action`).
 *
 *   import { authorize, logAction } from "@splyntra/sdk";
 *   const d = await authorize("payments.refund", { agentId: "support", context: { amount: 80 } });
 *   if (d.decision === "allow") { ... }
 *   else if (d.decision === "needs_approval") { ... wait for a human ... }
 *
 * These hit the collector (same endpoint/key as tracing). The decision + ledger
 * routes are served by the commercial governance module.
 */
function endpoint(): string {
  return (process.env.SPLYNTRA_ENDPOINT || "http://localhost:4318").replace(/\/$/, "");
}
function apiKey(explicit?: string): string {
  const k = explicit || process.env.SPLYNTRA_API_KEY || "";
  if (!k) throw new Error("Splyntra: set SPLYNTRA_API_KEY or pass apiKey");
  return k;
}
async function post(path: string, payload: unknown, key?: string): Promise<any> {
  const res = await fetch(`${endpoint()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey(key)}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`governance request failed (${res.status}): ${await res.text().catch(() => "")}`);
  return res.json();
}

export interface AuthorizeDecision {
  decision: "allow" | "deny" | "needs_approval";
  reason?: string;
  request_id?: string;
  limit_usd?: number;
}

/** Ask whether an agent may perform an action on a resource. `resource` scopes
 * the decision (e.g. "payroll.read") for resource-level policies; omit it for
 * action-only rules. */
export async function authorize(
  action: string,
  opts: { agentId?: string; resource?: string; context?: Record<string, unknown>; apiKey?: string } = {}
): Promise<AuthorizeDecision> {
  return post("/v1/authorize", { agent_id: opts.agentId || "agent", action, resource: opts.resource || "", context: opts.context || {} }, opts.apiKey);
}

/** Append a consequential action to the immutable, tamper-evident activity ledger. */
export async function logAction(
  action: string,
  opts: { actor?: string; resource?: string; traceId?: string; metadata?: Record<string, unknown>; apiKey?: string } = {}
): Promise<any> {
  return post("/v1/ledger", { actor: opts.actor || "agent", action, resource: opts.resource || "", trace_id: opts.traceId || "", metadata: opts.metadata || {} }, opts.apiKey);
}
