# Framework Integrations

The fastest way to connect a source is the in-product **Connect** page
(dashboard → **Connect**): pick **Code** or **No-code**, and it gives you the
exact snippet or webhook URL, an ingest key, and a **Test connection** button.
This doc is the reference behind it.

Splyntra captures agent telemetry two ways:

- **In-process SDK adapters** — for frameworks that run inside your Python/JS
  process. One line auto-instruments them.
- **Webhook ingestion** — for hosted/no-code workflow platforms (Dify, n8n,
  Flowise) that run out-of-process and emit events. They POST to a collector
  endpoint.

| Framework | Mechanism | How |
|-----------|-----------|-----|
| OpenAI | SDK (Py + TS) | `instrument=("openai",)` |
| Anthropic (Claude) | SDK (Py + TS) | `instrument=("anthropic",)` |
| Ollama | SDK (Py + TS) | `instrument=("ollama",)` |
| LangGraph | SDK (Py + TS) | `instrument=("langgraph",)` |
| CrewAI | SDK (Py + TS) | `instrument=("crewai",)` |
| OpenAI Agents | SDK (Py + TS) | `instrument=("openai-agents",)` |
| MCP (Model Context Protocol) | SDK (Py + TS) | `instrument=("mcp",)` — traces `tools/call` as `tool_call` spans, per MCP server |
| LlamaIndex | SDK (Py) | `instrument=("llamaindex",)` — query = agent span, retrieve = `retrieval` span |
| Pydantic AI | SDK (Py) | `instrument=("pydantic-ai",)` |
| Google ADK | SDK (Py) | `instrument=("google-adk",)` |
| Chroma | SDK (Py) | `instrument=("chroma",)` — collection queries as `vector_search` spans |
| LLM providers (Groq/Together/DeepSeek/xAI/Fireworks/Mistral/OpenRouter/…) | SDK (Py + TS) | `instrument=("openai",)` + a provider `base_url` — labeled + cost-tracked by provider |
| Vector DBs / Databases (Pinecone/Weaviate/Postgres/…) | OTLP semconv | emit `db.system`/`db.statement` spans → `vector_search`/`db` types |
| Langflow | Webhook | `POST /v1/integrations/langflow` |
| Dify | Webhook | `POST /v1/integrations/dify` |
| n8n | Webhook | `POST /v1/integrations/n8n` |
| Flowise | Webhook | `POST /v1/integrations/flowise` |
| AWS Bedrock AgentCore | OTLP or Webhook | native `gen_ai.*` OTLP → `/v1/traces`, or `POST /v1/integrations/bedrock` |
| Google Vertex Agent Engine | OTLP or Webhook | native `gen_ai.*` OTLP → `/v1/traces`, or `POST /v1/integrations/vertex` |
| OpenClaw | Plugin → Webhook | Splyntra OpenClaw plugin → `POST /v1/integrations/openclaw` |

## CrewAI (in-process)

```bash
pip install splyntra
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

Other in-process frameworks work identically — just change the `instrument`
tuple (e.g. `("anthropic",)`, `("ollama",)`, `("langgraph",)`,
`("openai-agents",)`). The **Connect → Code** page generates the exact snippet.

---

## No-code (webhook) platforms

All three webhook receivers share the same behavior: the collector builds a
**root `agent` span** with one **child span per step** (parented + sequenced by
duration, so you get a real waterfall), redacts `input`/`output`, validates,
stores, and runs the security detectors — identical to SDK ingestion. Send the
API key as a Bearer token. Get a turnkey URL + key from **Connect → No-code**.

### Dify (webhook)

Add an **HTTP Request** node (or use Dify's webhook/callback) that POSTs the
`workflow_finished` payload — optionally enriched with a `nodes` array — to:

```
POST http://<collector>:4318/v1/integrations/dify
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "event": "workflow_finished",
  "workflow_run_id": "run_abc",
  "data": { "workflow_id": "wf_support", "status": "succeeded",
            "elapsed_time": 1.2, "total_tokens": 408, "outputs": { "text": "..." } },
  "nodes": [
    { "id": "n1", "name": "classify", "type": "llm", "model": "gpt-4o",
      "prompt_tokens": 320, "completion_tokens": 88, "elapsed_ms": 220,
      "status": "succeeded", "input": "...", "output": "..." },
    { "id": "n2", "name": "crm.read", "type": "tool", "elapsed_ms": 180,
      "status": "succeeded" }
  ]
}
```

If you omit `nodes`, the run still appears as a single `agent` span — and its
`total_tokens` (→ cost), `outputs` (→ output), and `error` are captured on that
span. Recipe: [`integrations/dify/`](../integrations/dify).

### n8n (webhook)

**Turnkey:** install the **Splyntra community node**
([`integrations/n8n-nodes-splyntra/`](../integrations/n8n-nodes-splyntra)) — drop
it at the end of a workflow and it assembles + POSTs the payload for you (with a
`splyntraApi` credential holding the base URL + key).

**Manual:** add a final **Code** node that assembles the run summary and an
**HTTP Request** node that POSTs it to:

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
run format, so your workflow controls exactly what is sent (and what is redacted
before sending).

### Flowise (webhook)

Add an **HTTP** node (or a custom tool) at the end of your chatflow that POSTs
the run summary to:

```
POST http://<collector>:4318/v1/integrations/flowise
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "chatflow_id": "cf_1",
  "name": "RAG Bot",
  "session_id": "sess_9",
  "status": "success",
  "nodes": [
    { "name": "Retriever", "type": "tool", "elapsed_ms": 90, "status": "success" },
    { "name": "LLM Chain", "type": "llm", "model": "gpt-4o",
      "prompt_tokens": 210, "completion_tokens": 55, "elapsed_ms": 410,
      "status": "success", "output": "..." }
  ]
}
```

`session_id` (falling back to `chatflow_id`) becomes the trace id. Recipe:
[`integrations/flowise/`](../integrations/flowise).

### AWS Bedrock AgentCore

**Preferred — native OTLP:** Bedrock AgentCore emits OpenTelemetry `gen_ai.*` spans.
Point its OTLP exporter at `https://<collector>:4318/v1/traces` with the API key as a
Bearer token; they ingest with correct model/tokens/cost, no glue (see *OTel GenAI interop* below).

**Webhook (for environments not wired for OTLP):** a small Lambda forwards a run summary:

```
POST http://<collector>:4318/v1/integrations/bedrock
Authorization: Bearer <api-key>

{ "agent_name": "support-agent", "agent_id": "ABC123", "session_id": "sess_1",
  "status": "success", "elapsed_time": 1.4, "total_tokens": 380,
  "nodes": [ { "name": "KnowledgeBase", "type": "tool", "elapsed_ms": 120, "status": "success" },
             { "name": "Claude", "type": "llm", "model": "anthropic.claude-3-sonnet",
               "prompt_tokens": 300, "completion_tokens": 80, "elapsed_ms": 500, "status": "success" } ] }
```

`session_id` (falling back to `agent_id`) becomes the trace id. Recipe:
[`integrations/bedrock/`](../integrations/bedrock).

### Google Vertex Agent Engine

Same two options. **Native OTLP** → `/v1/traces`. **Webhook** (Cloud Function forwarder):

```
POST http://<collector>:4318/v1/integrations/vertex
Authorization: Bearer <api-key>

{ "app_name": "planner", "reasoning_engine_id": "re_9", "session_id": "sess_2",
  "status": "ok",
  "nodes": [ { "name": "Gemini", "type": "llm", "model": "gemini-1.5-pro",
               "prompt_tokens": 150, "completion_tokens": 40, "elapsed_ms": 300, "status": "ok" } ] }
```

`session_id` (falling back to `reasoning_engine_id`) becomes the trace id. Recipe:
[`integrations/vertex/`](../integrations/vertex).

### OpenClaw

[OpenClaw](https://docs.openclaw.ai) is a self-hosted Node.js gateway that bridges messaging
channels to AI coding agents. It has no native OTLP export, but its **plugin system** exposes
lifecycle hooks (`api.on(...)`, `api.registerHook("message:sent", …)`). The **Splyntra OpenClaw
plugin** ([`integrations/openclaw-plugin-splyntra/`](../integrations/openclaw-plugin-splyntra))
listens for session completion, assembles a run summary, and POSTs it:

```
POST http://<collector>:4318/v1/integrations/openclaw
Authorization: Bearer <api-key>

{ "session_id": "sess_1", "agent": "coder", "channel": "telegram", "status": "success",
  "elapsed_time": 0.9,
  "nodes": [ { "name": "read_file", "type": "tool", "elapsed_ms": 40, "status": "success" },
             { "name": "gpt-4o", "type": "llm", "model": "gpt-4o",
               "prompt_tokens": 120, "completion_tokens": 30, "elapsed_ms": 260, "status": "success" } ] }
```

`session_id` (falling back to `agent`) becomes the trace id; each tool/model step is a child span.
Recipe + plugin config: [`integrations/openclaw/`](../integrations/openclaw).

## Inline guardrail (prevent, not just detect)

The SDKs can run a synchronous pre-flight check before each LLM call and block or
redact based on the collector's `/v1/guard` verdict (fast Go engine: secrets +
injection heuristics). Detection (Presidio/ML) still runs async as before.

```python
Splyntra(api_key="...", project="app", instrument=("openai",),
         guard="block")          # "off" (default) | "monitor" | "block"
```
```ts
new Splyntra({ apiKey: "...", project: "app", instrument: ["openai"],
               guard: "block" }) // guardFailOpen defaults to true
```

- `monitor` logs the verdict without altering the call; `block` raises
  `SplyntraBlocked` before the provider call on an injection or secret hit.
- `guardFailOpen`/`guard_fail_open` (default true): if the guard is unreachable,
  proceed rather than block.

## OTel GenAI interop

The collector reads the OpenTelemetry `gen_ai.*` semantic conventions (and
OpenLLMetry's `traceloop.entity.*`) in addition to Splyntra's own `splyntra.*`
attributes, so spans from third-party OTel GenAI instrumentation — and the
hyperscaler agent platforms that emit `gen_ai.*` — ingest with correct
model/tokens/IO with no code changes.

## Export to a SIEM / observability sink

Set `SPLYNTRA_EXPORT_URL` (and optionally `SPLYNTRA_EXPORT_TOKEN`) on the
collector to forward every detection result as JSON to a Datadog/Splunk/generic
webhook — Splyntra as a source, not only a sink. Forwarding is fire-and-forget
and never blocks ingestion.
