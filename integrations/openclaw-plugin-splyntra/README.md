# openclaw-plugin-splyntra

A [OpenClaw](https://docs.openclaw.ai) plugin that sends each agent **session's**
telemetry — tool calls, status, timing, token usage — to
[Splyntra](https://github.com/splyntra/splyntra) for tracing, cost, and security.
It hooks OpenClaw's plugin lifecycle and POSTs a run summary to the collector's
`/v1/integrations/openclaw` webhook when a session replies.

## Install

Add it as an OpenClaw plugin (see OpenClaw's *Building plugins* guide) — e.g. drop
this folder under your gateway's plugins directory, or install from npm once
published:

```bash
openclaw plugins add openclaw-plugin-splyntra
```

## Configure

In your OpenClaw config, set the plugin's `endpoint` + `apiKey` (or the
`SPLYNTRA_ENDPOINT` / `SPLYNTRA_API_KEY` env vars):

```json5
{
  plugins: {
    splyntra: {
      endpoint: "https://<your-collector>:4318",
      apiKey: "<splyntra-ingest-key>",   // sent as a Bearer token
      enabled: true,
    },
  },
}
```

Get an ingest key from the Splyntra dashboard (**API Keys**, or **Connect → No-code
→ OpenClaw**).

## What it captures

Per OpenClaw session → one Splyntra trace:

- **Root `agent` span** — the session (agent, channel, status, elapsed).
- **Child `tool_call` spans** — each `before_tool_call` (tool name + arguments,
  redacted by the collector).
- **Tokens** — accumulated from turn events when the gateway surfaces usage
  (drives cost).

The collector redacts inputs/outputs, sequences the spans into a waterfall, and
runs the security detectors — identical to SDK ingestion.

## Note on gateway versions

OpenClaw's hook payload shapes are gateway-version-dependent and not fully pinned
in the public docs. `index.ts` reads fields defensively (with fallbacks); if your
gateway exposes token usage or tool timing under different keys, adjust the
extractors near the top of `index.ts`. The webhook contract on the Splyntra side
is stable regardless.

License: Apache-2.0.
