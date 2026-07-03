<!-- SPDX-License-Identifier: Apache-2.0 -->
# Dify → Splyntra recipe

Send Dify workflow runs to Splyntra's `/v1/integrations/dify` webhook so they
appear as traces (with cost + security detection). Fastest path: **Dashboard →
Connect → No-code → Dify** for a pre-filled URL, key, and a Test button.

## Minimal (works out of the box)

Add an **HTTP Request** node at the end of your workflow that POSTs the
`workflow_finished` summary. Even with no per-node breakdown the run appears as a
single `agent` span, and its `total_tokens` (→ cost), `outputs` (→ output), and
`error` are captured.

- **Method:** `POST`
- **URL:** `https://<your-collector>/v1/integrations/dify`
- **Headers:** `Authorization: Bearer <ingest-key>`, `Content-Type: application/json`
- **Body (JSON):**

```json
{
  "event": "workflow_finished",
  "workflow_run_id": "{{#sys.workflow_run_id#}}",
  "data": {
    "workflow_id": "{{#sys.workflow_id#}}",
    "status": "succeeded",
    "elapsed_time": 0,
    "total_tokens": 0,
    "outputs": {}
  }
}
```

Map the `{{#...#}}` placeholders to your workflow's system variables / final
node outputs in Dify's variable picker.

## With a step breakdown (waterfall)

To get a per-step waterfall, include a `nodes` array. Dify emits `node_finished`
events separately, so aggregate them into a workflow variable (a Code node that
appends `{ name, type, model, prompt_tokens, completion_tokens, elapsed_ms,
status, input, output }` per node), then reference that array in the HTTP body:

```json
{
  "event": "workflow_finished",
  "workflow_run_id": "{{#sys.workflow_run_id#}}",
  "data": { "workflow_id": "{{#sys.workflow_id#}}", "status": "succeeded", "elapsed_time": 1.2 },
  "nodes": {{#code.nodes#}}
}
```

The collector redacts `input`/`output`, builds a root `agent` span parenting each
node span (sequenced by `elapsed_ms`), and runs detections.

> Roadmap: Dify's native Ops/Tracing export (OpenLLMetry/OTLP) will let you point
> Dify's built-in tracing at Splyntra with zero workflow glue — tracked separately.
