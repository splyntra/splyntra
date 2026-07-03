<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Google Vertex Agent Engine → Splyntra recipe

Two ways to get Vertex Agent Engine (Reasoning Engine / ADK) traces into Splyntra.
Fastest path: **Dashboard → Connect → No-code → Google Vertex Agent Engine**.

## Option 1 — Native OTLP (preferred, zero glue)

Vertex Agent Engine emits OpenTelemetry `gen_ai.*` spans. Point its OTLP exporter at the
collector; they ingest with correct model / tokens / cost (the collector reads `gen_ai.*`).

```
OTEL_EXPORTER_OTLP_ENDPOINT = https://<your-collector>:4318
OTEL_EXPORTER_OTLP_HEADERS  = Authorization=Bearer <ingest-key>
```

## Option 2 — Webhook forwarder (Cloud Function)

A Cloud Function triggered on the engine's execution logs POSTs a run summary:

```python
import json, os, urllib.request

def forward(request):
    e = request.get_json()
    summary = {
        "app_name": e["appName"],
        "reasoning_engine_id": e.get("reasoningEngineId", ""),
        "session_id": e["sessionId"],
        "status": e.get("status", "ok"),
        "elapsed_time": e.get("elapsedSeconds", 0),
        "total_tokens": e.get("totalTokens", 0),
        "error": e.get("error", ""),
        "nodes": e.get("steps", []),  # [{name,type,model,prompt_tokens,completion_tokens,elapsed_ms,status,input,output}]
    }
    req = urllib.request.Request(
        os.environ["SPLYNTRA_URL"] + "/v1/integrations/vertex",
        data=json.dumps(summary).encode(),
        headers={"Authorization": "Bearer " + os.environ["SPLYNTRA_KEY"], "Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5).read()
    return "ok"
```

The collector builds a root `agent` span parenting each step (redacted, sequenced) and runs
detections. `session_id` (falling back to `reasoning_engine_id`) is the trace id.
