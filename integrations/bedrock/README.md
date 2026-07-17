<!-- SPDX-License-Identifier: Apache-2.0 -->
# AWS Bedrock AgentCore → Splyntra recipe

Two ways to get Bedrock agent traces into Splyntra. Fastest path: **Dashboard →
Connect → No-code → AWS Bedrock AgentCore** for a pre-filled URL, key, and a Test button.

## Option 1 — Native OTLP (preferred, zero glue)

Bedrock AgentCore emits OpenTelemetry `gen_ai.*` spans. Point its OTLP exporter at the
collector and they ingest with correct model / tokens / cost — the collector reads the
`gen_ai.*` semantic conventions directly.

```
OTEL_EXPORTER_OTLP_ENDPOINT = https://<your-collector>:4318
OTEL_EXPORTER_OTLP_HEADERS  = Authorization=Bearer <ingest-key>
```

Nothing else to build. Traces appear in `/traces` and feed the detectors + Trust view.

## Option 2 — Webhook forwarder (no OTLP export configured)

Add a tiny Lambda subscribed to your Bedrock agent invocation logs (CloudWatch) that POSTs
a run summary. Minimal handler:

```python
import json, os, urllib.request

def handler(event, _ctx):
    summary = {
        "agent_name": event["agentName"],
        "agent_id": event.get("agentId", ""),
        "session_id": event["sessionId"],
        "status": "success" if not event.get("error") else "error",
        "elapsed_time": event.get("elapsedSeconds", 0),
        "total_tokens": event.get("totalTokens", 0),
        "error": event.get("error", ""),
        "nodes": event.get("steps", []),  # [{name,type,model,prompt_tokens,completion_tokens,elapsed_ms,status,input,output}]
    }
    req = urllib.request.Request(
        os.environ["SPLYNTRA_URL"] + "/v1/integrations/bedrock",
        data=json.dumps(summary).encode(),
        headers={"Authorization": "Bearer " + os.environ["SPLYNTRA_KEY"], "Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5).read()
```

The collector builds a root `agent` span with one child per step (redacted, sequenced) and
runs detections — identical to SDK ingestion. `session_id` (falling back to `agent_id`) is
the trace id.
