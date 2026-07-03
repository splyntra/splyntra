<!-- SPDX-License-Identifier: Apache-2.0 -->
# Flowise → Splyntra recipe

Send Flowise chatflow runs to Splyntra's `/v1/integrations/flowise` webhook so
they appear as traces (with cost + security detection). Fastest path:
**Dashboard → Connect → No-code → Flowise** for a pre-filled URL, key, and a
Test button.

## Minimal (works out of the box)

Add a **Custom Tool** (or an HTTP-capable node) at the end of your chatflow that
POSTs a run summary. Even with an empty `nodes` array the run appears as a single
`agent` span; its `status`, `output`, and `total_tokens` (→ cost) are captured.

- **Method:** `POST`
- **URL:** `https://<your-collector>/v1/integrations/flowise`
- **Headers:** `Authorization: Bearer <ingest-key>`, `Content-Type: application/json`
- **Body (JSON):**

```json
{
  "chatflow_id": "$flow.chatflowId",
  "name": "$flow.chatflowName",
  "session_id": "$flow.sessionId",
  "status": "success",
  "nodes": []
}
```

### Custom Tool snippet

In a Flowise **Custom Tool**, the JS body can be:

```js
const res = await fetch("https://<your-collector>/v1/integrations/flowise", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + $vars.SPLYNTRA_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    chatflow_id: $flow.chatflowId,
    name: $flow.chatflowName,
    session_id: $flow.sessionId,
    status: "success",
    nodes: [], // optional per-step breakdown, see below
  }),
});
return await res.text();
```

Store the ingest key as a Flowise variable (`SPLYNTRA_KEY`) rather than inlining it.

## With a step breakdown (waterfall)

Populate `nodes` with one entry per step to get a per-node waterfall:

```json
{ "name": "LLM Chain", "type": "llm", "model": "gpt-4o-mini",
  "prompt_tokens": 200, "completion_tokens": 60, "elapsed_ms": 450,
  "status": "success", "input": "...", "output": "..." }
```

The collector redacts `input`/`output`, builds a root `agent` span parenting each
node span (sequenced by `elapsed_ms`), and runs detections — identical to SDK
ingestion. The trace id is derived from `session_id` (falling back to
`chatflow_id`), so all turns of a session group together.
