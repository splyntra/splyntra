# Splyntra

**Unified observability and security for AI agents.**

See what your agents did and whether it was safe — in one view.

[![Go](https://github.com/splyntra/splyntra/actions/workflows/go.yml/badge.svg)](https://github.com/splyntra/splyntra/actions/workflows/go.yml)
[![Python](https://github.com/splyntra/splyntra/actions/workflows/python.yml/badge.svg)](https://github.com/splyntra/splyntra/actions/workflows/python.yml)
[![Web](https://github.com/splyntra/splyntra/actions/workflows/web.yml/badge.svg)](https://github.com/splyntra/splyntra/actions/workflows/web.yml)
[![License](https://img.shields.io/badge/core-AGPL--3.0-blue.svg)](LICENSE) [![SDKs](https://img.shields.io/badge/SDKs-Apache--2.0-green.svg)](LICENSING.md)

---

## Quick Start

```bash
# Start everything (one command)
docker compose up -d

# Dashboard: http://localhost:3000
# Collector (OTLP): http://localhost:4318
```

### Instrument Your Agent (Python)

```bash
pip install splyntra
```

```python
from splyntra import Splyntra, trace_agent, trace_tool, trace_llm

# Initialize (one line)
splyntra = Splyntra(api_key="splyntra_dev_key", project="my-project")

@trace_agent(name="support_agent", workflow="refund")
def run_agent(query: str):
    plan = call_llm(query)
    result = execute_tool(plan)
    return result

@trace_llm(model="gpt-4o", provider="openai")
def call_llm(prompt: str):
    # Your LLM call here
    ...

@trace_tool(name="crm.read")
def execute_tool(action: dict):
    # Your tool call here
    ...
```

Run your agent. Open `http://localhost:3000/traces`. See your trace — complete with risk scoring for leaked secrets, exposed PII, and suspected prompt injection.

**Time to first trace: under 5 minutes.**

### Instrument Your Agent (TypeScript / JavaScript)

```bash
npm install @splyntra/sdk
```

```ts
import { Splyntra, wrapAgent, wrapTool, wrapLLM } from "@splyntra/sdk";

// Initialize once (auto-instruments the listed frameworks).
new Splyntra({
  apiKey: "splyntra_dev_key",
  project: "my-project",
  instrument: ["openai", "langgraph"],
});

// Wrap your own functions — works in TS and plain JS, no decorators needed:
const callLLM = wrapLLM(async (prompt: string) => openai.chat.completions.create({ /* ... */ }), "gpt-4o", "openai");
const readCrm = wrapTool(async (id: string) => db.get(id), "crm.read");
const runAgent = wrapAgent(async (q: string) => callLLM(q), "support_agent", "refund");

await runAgent("refund my order");
```

TypeScript users can use `@traceAgent` / `@traceTool` / `@traceLLM` decorators instead
(requires `experimentalDecorators`). Plain JavaScript works via `require("@splyntra/sdk")`.
See [`sdks/typescript/README.md`](sdks/typescript/README.md) and [`examples/quickstart.ts`](examples/quickstart.ts).

---

## What You Get

Five pillars on one pipeline — Observe, Evaluate, Secure, Govern, Trust.

| Pillar | Capabilities | Quality |
|--------|--------------|---------|
| **Observability** | Execution tracing, agent replay, time-series metrics, cost analytics (run/model/project) | ✅ GA |
| **Evaluation** | Dataset management, scorers (exact/rule/tool-call/latency/cost), regression detection, CI gate (+ LLM-as-judge in the commercial edition) | ✅ GA |
| **Security** | Secret + PII detection (reliable), prompt-injection (beta), unified risk scoring | ✅ GA / ⚠️ BETA |
| **Governance** | Activity Ledger (hash-chained), Delegation (permissions, spend, approvals), Policy engine (RBAC/ABAC/ReBAC) | 💼 Commercial |
| **Dashboard** | Projects, alerts (risk + cost), team management (RBAC + login) | ✅ GA |

> 💼 Governance, identity/SSO, the control plane, billing, and advanced
> detectors/scorers are the **commercial edition** (the private `splyntra-cloud`
> repository); the open core is fully usable without them. See [LICENSING.md](LICENSING.md).

**Integrations:** OpenAI, LangGraph, OpenAI Agents, CrewAI (SDK) · Dify, n8n (webhook). See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

---

## Documentation

| Doc | What's in it |
|-----|--------------|
| [Getting Started](docs/GETTING_STARTED.md) | Zero → first trace, dashboard tour, evaluation/governance, Docker + Helm |
| [API Reference](docs/API.md) | Ingest, query, metrics, integrations, governance, evaluation endpoints |
| [Integrations](docs/INTEGRATIONS.md) | OpenAI, LangGraph, OpenAI Agents, CrewAI, Dify, n8n |
| [Python SDK](sdks/python/README.md) | `instrument()`, decorators, redaction, `eval` CLI, `authorize()`/`log_action()` |
| [TypeScript / JavaScript SDK](sdks/typescript/README.md) | Install, auto-instrument, function wrappers, decorators |
| [Helm chart](deploy/helm/splyntra) | Kubernetes / managed-cloud deployment |
| [Contributing](CONTRIBUTING.md) | Local dev, Conventional Commits, automated releases |
| [Security](SECURITY.md) | Responsible disclosure |

---

## Architecture

```
Agent (SDK / Dify / n8n)
      │  OTLP / webhook
      ▼
 Collector (Go) ── enrich · validate · redact · extension seam (commercial: governance)
      │                         │
      │ NATS JetStream          ├──► PostgreSQL  (projects, agents, users/teams, alerts,
      ▼                         │                 ledger, policies, delegation)
 Security (Python)              └──► ClickHouse  (traces, spans, detections, metrics)
   PII · secrets · injection
      ▲                          Evaluation (Python) ── datasets (MinIO) · scorers · regression
      │                                   │
      └───────────────────────────────────┴──►  Dashboard (Next.js BFF + RBAC login)
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| SDK | Python + TypeScript (OpenTelemetry) | Instrument agents; OpenAI / LangGraph / OpenAI-Agents / CrewAI |
| Wire Protocol | OTLP (HTTP/protobuf) + JSON webhooks | Telemetry transport (incl. Dify / n8n) |
| Collector | Go (chi, zap, clickhouse-go) | Auth, validation, enrichment, ingestion, metrics (+ extension seam for commercial modules) |
| Streaming | NATS JetStream | Durable buffering, fan-out to detectors |
| Security | Python (Presidio, DeBERTa, regex) | PII, secrets, injection detection |
| Evaluation | Python (FastAPI) | Datasets, scorers, regression gates |
| Trace/Metric Store | ClickHouse | 100M+ events/day; traces, spans, detections, time-series metrics |
| Metadata | PostgreSQL | Orgs, projects, agents, users/teams, alerts (governance tables added by the commercial edition) |
| Object Storage | MinIO / S3 | Evaluation datasets |
| Cache | Valkey | Rate limiting, key resolution |
| Dashboard | Next.js + Tailwind + next-auth | Trace viewer, metrics, costs, evaluation, RBAC (governance screens in the commercial edition) |

---

## Project Structure

```
splyntra/
├── README.md
├── LICENSE                    AGPL-3.0 (core); sdks/* are Apache-2.0
├── LICENSING.md               per-directory license map
├── CONTRIBUTING.md            Build + run locally, PR rules
├── SECURITY.md                Responsible disclosure
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── docker-compose.yml         `docker compose up` == your funnel
├── Taskfile.yml               One command per common task
├── release-please-config.json Automated, lockstep SDK versioning
├── docs/                      Getting Started + API reference
├── .github/
│   ├── workflows/             CI per language + release + license-check + docker
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── schema/proto/              Shared event/span schema (OTel-based)
├── apps/
│   ├── collector/             Go — ingest, auth, redaction, metrics + extension seam (+ Dockerfile)
│   ├── security/              Python — Presidio PII, secret patterns, injection ML (+ Dockerfile)
│   ├── evaluation/            Python — datasets, scorers, regression gates (+ Dockerfile)
│   └── web/                   Next.js dashboard — observability/eval/alerts + RBAC login (+ Dockerfile)
├── sdks/
│   ├── python/                Published to PyPI  (splyntra)
│   └── typescript/            Published to npm   (@splyntra/sdk)
├── deploy/
│   └── helm/splyntra/         Kubernetes / Helm chart (managed-cloud deploy)
├── examples/                  Runnable example agents (Python + TypeScript)
└── migrations/                SQL (Postgres + ClickHouse)
```

---

## Development

```bash
# Prerequisites: Go 1.22+, Python 3.9+, Node 20+, Docker

# Using Task (recommended)
task dev              # Start full stack
task test             # Run all tests
task lint             # Lint everything
task build:collector  # Build Go binary

# Or use Make
make dev
make test
make lint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## Design Principles

- **OTel-native**: Built on OpenTelemetry — not a proprietary format
- **One pipeline**: Observability and security from the same data stream
- **Self-host first**: `docker compose up` is the adoption funnel
- **Redact by default**: Sensitive data stripped before storage
- **Boring infrastructure**: Go + ClickHouse + Postgres; novel product, not novel infra

---

## License

Splyntra follows an **open-core** model with a tri-license split (see
[LICENSING.md](./LICENSING.md)):

- **Server core, detectors, and dashboard** — [GNU AGPL-3.0](./LICENSE).
- **Client SDKs** (`sdks/python`, `sdks/typescript`) — Apache-2.0.
- **Governance, identity/SSO, control plane, billing, advanced detectors** —
  commercial, in the separate private `splyntra-cloud` repository.

Contributions require the [CLA](./CLA.md).

---

## Security

For responsible disclosure of security vulnerabilities, see [SECURITY.md](./SECURITY.md).
Do not open public issues for security bugs.
