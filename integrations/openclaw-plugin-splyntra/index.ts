// SPDX-License-Identifier: Apache-2.0
// Splyntra plugin for OpenClaw. Accumulates a per-session run from OpenClaw's
// plugin lifecycle hooks (tool calls + completion) and POSTs a clean run summary
// to Splyntra's /v1/integrations/openclaw webhook when the session replies — the
// same contract the collector uses for Dify/n8n/Flowise.
//
// OpenClaw's hook payload shapes are gateway-version-dependent and not fully
// specified in the public docs, so field access here is defensive (best-effort
// with fallbacks). Adjust the extractors to your gateway version if a field
// (e.g. token usage) lands under a different key.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

interface RunNode {
  name: string;
  type: string; // "tool" | "llm"
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  elapsed_ms?: number;
  status: string;
  input?: string;
  output?: string;
}
interface Session {
  agent: string;
  channel: string;
  startedAt: number;
  nodes: RunNode[];
  totalTokens: number;
  error?: string;
}

const sessions = new Map<string, Session>();

let cfg = {
  endpoint: (process.env.SPLYNTRA_ENDPOINT || "http://localhost:4318").replace(/\/+$/, ""),
  apiKey: process.env.SPLYNTRA_API_KEY || "",
  enabled: true,
};

// ── best-effort extractors (tolerate differing event shapes) ─────────────────
const pick = (o: any, ...keys: string[]): any => {
  for (const k of keys) {
    const v = k.split(".").reduce((a: any, p) => (a == null ? a : a[p]), o);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
const sessionKey = (e: any): string =>
  String(pick(e, "sessionKey", "sessionId", "session.id", "session.key", "threadId") ?? "default");
const asNum = (v: any): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function ensure(e: any): Session {
  const key = sessionKey(e);
  let s = sessions.get(key);
  if (!s) {
    s = {
      agent: String(pick(e, "agentId", "agent.id", "agent") ?? "openclaw"),
      channel: String(pick(e, "channel", "channelId", "source") ?? ""),
      startedAt: Date.now(),
      nodes: [],
      totalTokens: 0,
    };
    sessions.set(key, s);
  }
  return s;
}

async function flush(e: any) {
  if (!cfg.enabled) return;
  const key = sessionKey(e);
  const s = sessions.get(key);
  if (!s) return;
  sessions.delete(key);

  const payload = {
    session_id: key,
    agent: s.agent,
    channel: s.channel,
    status: s.error ? "error" : "success",
    error: s.error || "",
    elapsed_time: (Date.now() - s.startedAt) / 1000,
    total_tokens: s.totalTokens,
    output: String(pick(e, "text", "reply.text", "message.text") ?? ""),
    nodes: s.nodes,
  };

  try {
    await fetch(`${cfg.endpoint}/v1/integrations/openclaw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[splyntra] failed to forward OpenClaw session:", err);
  }
}

export default definePluginEntry({
  id: "splyntra",
  name: "Splyntra",
  description: "Send OpenClaw agent session telemetry to Splyntra.",
  register(api: any) {
    // Load plugin config at startup (falls back to env).
    api.on("gateway_start", (ctx: any) => {
      const c = pick(ctx, "config.plugins.splyntra", "config.splyntra", "pluginConfig") || {};
      cfg = {
        endpoint: (c.endpoint || cfg.endpoint).replace(/\/+$/, ""),
        apiKey: c.apiKey || cfg.apiKey,
        enabled: c.enabled !== false,
      };
    });

    // Start (or continue) a session when a message arrives.
    api.on("message_received", (e: any) => {
      ensure(e);
    });

    // Record each tool invocation as a node. before_tool_call fires pre-execution,
    // so duration/output aren't known yet; we capture name + args.
    api.on("before_tool_call", (e: any) => {
      const s = ensure(e);
      s.nodes.push({
        name: String(pick(e, "tool.name", "toolName", "name") ?? "tool"),
        type: "tool",
        status: "success",
        input: safeJSON(pick(e, "tool.arguments", "arguments", "params")),
      });
    });

    // Accumulate token usage if the gateway surfaces it on turn/agent events.
    api.on("agent_turn_prepare", (e: any) => {
      const s = ensure(e);
      const t = asNum(pick(e, "usage.total_tokens", "usage.totalTokens", "tokens"));
      if (t) s.totalTokens += t;
    });

    // Finalize + forward the run when the agent's reply is dispatched.
    api.registerHook("message:sent", (e: any) => {
      void flush(e);
    });
  },
});

function safeJSON(v: any): string | undefined {
  if (v === undefined) return undefined;
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return undefined;
  }
}
