# Splyntra Collector API

The collector exposes an OTLP-compatible ingest path and a small query API the
dashboard uses. All `/v1/*` endpoints require authentication; health endpoints
do not.

Base URL (self-host): `http://localhost:4318`

## Authentication

Send your API key as a Bearer token (or `X-API-Key` header):

```
Authorization: Bearer splyntra_dev_key
```

The key resolves to an org + project (tenant). **Every query is scoped to the
key's organization** — you can never read another org's data. A `?project_id=`
query param narrows results to a specific project within your org.

## Health

| Method | Path      | Auth | Description                                  |
|--------|-----------|------|----------------------------------------------|
| GET    | `/health` | no   | Liveness. `{"status":"ok","version":"..."}`  |
| GET    | `/ready`  | no   | Readiness; checks ClickHouse/NATS dependencies. |

## Ingest

### `POST /v1/traces` — OTLP

Standard OTLP/HTTP traces (`application/x-protobuf` or JSON). This is what the
SDKs send. Spans are converted, redacted, validated, published for detection,
and stored. Returns the OTLP `ExportTraceServiceResponse`. Invalid traces
(missing ids, too many spans, bad span type, token overflow) are rejected `400`.

Recognised span attributes: `splyntra.span.type` (`agent|llm_call|tool_call|step`),
`gen_ai.request.model`, `gen_ai.usage.prompt_tokens`,
`gen_ai.usage.completion_tokens`, `splyntra.input`, `splyntra.output`,
`splyntra.workflow`. Resource attributes: `service.name` / `splyntra.agent.name`,
`splyntra.framework`.

### `POST /v1/events` — JSON (direct)

For clients that post traces without OTLP. Accepts a single trace object or an
array. Two forms:

```jsonc
// nested
{ "trace_id": "tr_1", "agent_id": "a1", "framework": "langgraph",
  "spans": [ { "span_id": "s1", "type": "llm_call", "name": "call",
               "model": "gpt-4o", "prompt_tokens": 100, "completion_tokens": 50,
               "input": "...", "output": "..." } ] }

// flat single span
{ "trace_id": "tr_1", "span_id": "s1", "agent_id": "a1",
  "type": "llm_call", "name": "call", "model": "gpt-4o",
  "prompt_tokens": 100, "completion_tokens": 50 }
```

Response: `{"accepted": N, "spans": M, "timestamp": "..."}`.

## Query

| Method | Path                    | Description |
|--------|-------------------------|-------------|
| GET    | `/v1/traces?limit=N`    | Recent traces (risk score, latency, cost, tokens). |
| GET    | `/v1/traces/{traceID}`  | One trace: `{spans, detections}`. |
| GET    | `/v1/agents`            | Aggregated agent stats + framework metadata. |
| GET    | `/v1/costs`             | `{models, summary, by_project}` cost breakdown. |
| GET    | `/v1/metrics?window=&interval=` | Time-series: latency p50/p95, throughput, error/success rate, tokens, cost. |
| GET    | `/v1/projects`          | Projects in your org. |

All accept an optional `?project_id=` filter.

## Integrations (webhook ingestion)

For out-of-process platforms (see [INTEGRATIONS.md](INTEGRATIONS.md)). Each
translates a provider payload into a trace and runs the standard
redact→validate→store→detect path.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/integrations/dify` | Dify `workflow_finished` (+ optional `nodes`). |
| POST | `/v1/integrations/n8n`  | n8n workflow execution summary. |

## Governance (commercial)

> The governance API is **not part of the open-source collector** — these routes
> return `404` on the open build. They are provided by the commercial
> `collector-cloud` binary (the `splyntra-cloud` repository), which mounts the
> governance module onto the same `/v1` group. Documented here for reference.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/v1/ledger` | Append-only, hash-chained activity ledger (+ integrity status). |
| GET | `/v1/policies` · POST · DELETE `/v1/policies/{id}` | RBAC/ABAC/ReBAC allow/deny rules (deny wins). |
| GET | `/v1/delegation` | Agent permissions + pending approval requests. |
| POST | `/v1/delegation/permissions` | Set an agent allow/deny permission. |
| POST | `/v1/approvals/{id}/decide` | `{"decision":"approve"|"deny"}`. |
| POST | `/v1/authorize` | Decision API → `{"decision":"allow"|"deny"|"needs_approval"}`. Checks permissions, daily spend, policies, and approval rules. |

`authorize` body: `{"agent_id":"support_agent","action":"payments.refund","resource":"payments","context":{"amount":80}}`.

## Evaluation service (port 8002)

A separate service sharing the same API-key auth. Datasets live in object
storage; scores + regressions in Postgres.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/datasets` | Create/version a dataset (`{name, items:[{input, expected_output}]}`). |
| GET  | `/v1/datasets` | List datasets. |
| POST | `/v1/evaluations/run` | Score caller-produced results vs the dataset; returns `{score, per_scorer, regression, passed}`. |
| GET  | `/v1/evaluations` | Run history (score over time). |

Built-in scorers: `exact_match`, `rule_based`, `tool_call_success`, `latency`,
`cost`. The `llm_as_judge` scorer is **commercial** — it ships as the
`splyntra-scorers-pro` plugin (the `splyntra-cloud` repository) and registers via
the `splyntra.scorers` entry point when installed (with `EVAL_LLM_API_KEY` set).
A run with `gate:true` fails when the score regresses below the dataset baseline.

## Alerts

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| GET    | `/v1/alerts`          | `{alerts, events}` — configs + recent fired history. |
| POST   | `/v1/alerts`          | Create an alert. Body below. |
| DELETE | `/v1/alerts/{alertID}`| Delete an alert (scoped to your org). |

Create body:

```json
{ "name": "High-risk traces", "type": "risk_threshold",
  "project_id": "<optional-uuid>", "config": { "threshold": 70 },
  "channels": ["email", "webhook", "slack"] }
```

When a trace's risk score crosses a configured `risk_threshold`, the collector
records an alert event and dispatches to the configured channels. Webhook/Slack
destinations come from `ALERT_WEBHOOK_URL` / `ALERT_SLACK_WEBHOOK_URL`.

## Collector configuration (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4318` | Listen port |
| `ENV` | `development` | `development` enables the seeded dev key |
| `POSTGRES_DSN` | local | Metadata store (auth, projects, agents, alerts) |
| `CLICKHOUSE_DSN` | local | Trace/span/detection store |
| `NATS_URL` | local | Streaming bus (detection fan-out) |
| `VALKEY_ADDR` | local | Rate-limit cache |
| `RATE_LIMIT_RPS` | `1000` | Per-IP rate limit |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `ALERT_WEBHOOK_URL` | — | Generic webhook destination for fired alerts |
| `ALERT_SLACK_WEBHOOK_URL` | — | Slack incoming-webhook destination |

### Evaluation service env

| Var | Default | Purpose |
|-----|---------|---------|
| `POSTGRES_DSN` | local | Shared metadata store (auth + eval tables) |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | local MinIO | Object storage for dataset items |
| `EVAL_BUCKET` | `splyntra-datasets` | Dataset bucket |
| `EVAL_LLM_API_KEY` | — | Enables the `llm_as_judge` scorer (else deterministic only) |
| `EVAL_LLM_MODEL` | `gpt-4o-mini` | Judge model |
