# n8n-nodes-splyntra

An [n8n](https://n8n.io) community node that sends a workflow's run telemetry to
[Splyntra](https://github.com/splyntra/splyntra) — traces, cost, and security —
with no glue code. Drop it at the end of a workflow; it fills in the workflow
id/name + execution id automatically and POSTs to the collector's
`/v1/integrations/n8n` webhook.

## Install (community node)

In n8n: **Settings → Community nodes → Install** → `n8n-nodes-splyntra`.

Or build from source and link:

```bash
cd integrations/n8n-nodes-splyntra
npm install
npm run build        # tsc + copy the node icon into dist
npm link             # then `npm link n8n-nodes-splyntra` in your n8n install
```

## Configure

1. Add a **Splyntra API** credential:
   - **Collector Base URL** — your collector's ingest URL (e.g. `http://localhost:4318`).
   - **API Key** — an ingest-scoped key (Dashboard → **API Keys**, or **Connect → No-code**).
   The credential's **Test** button calls `GET /v1/projects` to verify it.
2. Add the **Splyntra** node as the last step of your workflow.
   - **Status** — `success` or `error` (map from upstream with an expression).
   - **Steps (nodes)** — optional JSON array of step summaries; leave `[]` to
     record a single agent span for the run. Each entry:
     ```json
     { "name": "OpenAI", "type": "llm", "model": "gpt-4o-mini",
       "prompt_tokens": 150, "completion_tokens": 40, "elapsed_ms": 300,
       "status": "success", "input": "...", "output": "..." }
     ```

The collector builds a root `agent` span with one child per step (sequenced into
a waterfall), redacts `input`/`output`, and runs detections — identical to SDK
ingestion. The node passes its input through unchanged, so it can sit inline.

## Publish

```bash
npm run build && npm publish --access public
```

License: Apache-2.0.
