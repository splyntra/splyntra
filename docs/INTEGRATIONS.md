# Framework Integrations

Splyntra captures agent telemetry two ways:

- **In-process SDK adapters** — for frameworks that run inside your Python/JS
  process (OpenAI, LangGraph, OpenAI Agents, CrewAI). One line auto-instruments
  them.
- **Webhook ingestion** — for hosted/no-code workflow platforms (Dify, n8n)
  that run out-of-process and emit events. They POST to a collector endpoint.

| Framework | Mechanism | How |
|-----------|-----------|-----|
| OpenAI | SDK (Py + TS) | `instrument=("openai",)` |
| LangGraph | SDK (Py + TS) | `instrument=("langgraph",)` |
| OpenAI Agents | SDK (Py) | `instrument=("openai-agents",)` |
| CrewAI | SDK (Py) | `instrument=("crewai",)` |
| Dify | Webhook | `POST /v1/integrations/dify` |
| n8n | Webhook | `POST /v1/integrations/n8n` |

## CrewAI (in-process)

```bash
pip install "splyntra[crewai,openai]"
```

```python
from splyntra import Splyntra
Splyntra(api_key="splyntra_dev_key", project="my-app",
         framework="crewai", instrument=("crewai", "openai"))
# ...build and kickoff your Crew as usual.
```

Crew kickoff → `agent` span; each task → `step` span; tools → `tool_call`; LLM
calls (via the OpenAI adapter) → `llm_call`. See
[`examples/crewai_quickstart.py`](../examples/crewai_quickstart.py).

## Dify (webhook)

Dify runs out-of-process, so route its workflow events to the collector. Add an
**HTTP Request** node (or use Dify's webhook/callback) that POSTs the
`workflow_finished` payload — optionally enriched with a `nodes` array — to:

```
POST http://<collector>:4318/v1/integrations/dify
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "event": "workflow_finished",
  "workflow_run_id": "run_abc",
  "data": { "workflow_id": "wf_support", "status": "succeeded",
            "elapsed_time": 1.2, "total_tokens": 408 },
  "nodes": [
    { "id": "n1", "name": "classify", "type": "llm", "model": "gpt-4o",
      "prompt_tokens": 320, "completion_tokens": 88, "elapsed_ms": 220,
      "status": "succeeded", "input": "...", "output": "..." },
    { "id": "n2", "name": "crm.read", "type": "tool", "elapsed_ms": 180,
      "status": "succeeded" }
  ]
}
```

The collector redacts `input`/`output`, validates, stores, and runs the security
detectors — identical to SDK ingestion. If you omit `nodes`, a single `agent`
span is synthesized so the run still appears.

## n8n (webhook)

In your n8n workflow, add a final **Code** node that assembles the run summary
and an **HTTP Request** node that POSTs it to:

```
POST http://<collector>:4318/v1/integrations/n8n
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "workflow": { "id": "wf_42", "name": "Support Agent" },
  "execution_id": "exec_123",
  "status": "success",
  "nodes": [
    { "name": "OpenAI", "type": "llm", "model": "gpt-4o-mini",
      "prompt_tokens": 150, "completion_tokens": 40, "elapsed_ms": 300,
      "status": "success", "output": "..." },
    { "name": "HTTP Request", "type": "http", "elapsed_ms": 120, "status": "success" }
  ]
}
```

We deliberately accept this clean contract rather than n8n's volatile internal
run format, so your workflow controls exactly what is sent (and what is
redacted before sending).
