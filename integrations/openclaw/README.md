<!-- SPDX-License-Identifier: Apache-2.0 -->
# OpenClaw → Splyntra recipe

[OpenClaw](https://docs.openclaw.ai) is a self-hosted Node.js gateway bridging
messaging channels to AI coding agents. It has no native OTLP export, so telemetry
is captured through its **plugin lifecycle hooks** and forwarded to Splyntra's
`/v1/integrations/openclaw` webhook. Fastest path: **Dashboard → Connect → No-code
→ OpenClaw**.

## Turnkey — the Splyntra plugin (recommended)

Use [`integrations/openclaw-plugin-splyntra/`](../openclaw-plugin-splyntra): it
registers `before_tool_call` + `message:sent` hooks, accumulates the session, and
POSTs the run summary automatically. Configure `endpoint` + `apiKey` in your
OpenClaw config and you're done.

## Manual — a minimal hook

If you'd rather not install the plugin, add a small plugin/hook that POSTs on
completion:

```ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "splyntra-inline", name: "Splyntra (inline)",
  register(api) {
    api.registerHook("message:sent", async (e) => {
      await fetch(`${process.env.SPLYNTRA_ENDPOINT}/v1/integrations/openclaw`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SPLYNTRA_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: e.sessionKey ?? "session",
          agent: e.agentId ?? "openclaw",
          status: "success",
          nodes: [], // optionally include per-tool { name, type:"tool", elapsed_ms, status }
        }),
      });
    });
  },
});
```

## Webhook contract

```
POST http://<collector>:4318/v1/integrations/openclaw
Authorization: Bearer <api-key>

{ "session_id": "sess_1", "agent": "coder", "channel": "telegram", "status": "success",
  "elapsed_time": 0.9, "total_tokens": 150,
  "nodes": [ { "name": "read_file", "type": "tool", "elapsed_ms": 40, "status": "success" },
             { "name": "gpt-4o", "type": "llm", "model": "gpt-4o",
               "prompt_tokens": 120, "completion_tokens": 30, "elapsed_ms": 260, "status": "success" } ] }
```

`session_id` (falling back to `agent`) becomes the trace id; each node is a child
span. The collector redacts input/output, sequences a waterfall, and runs detections.
