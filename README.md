<p align="center">
  <img src="https://avatars.githubusercontent.com/u/291030557?s=200" alt="Splyntra" width="80" />
</p>

<h1 align="center">Splyntra</h1>

<p align="center"><strong>Unified observability and security for AI agents.</strong></p>

<p align="center">See what your agents did and whether it was safe — in one view.</p>

<p align="center">
  <a href="https://docs.splyntra.com"><strong>Documentation</strong></a> ·
  <a href="https://app.splyntra.com"><strong>Cloud App</strong></a> ·
  <a href="https://ingest.splyntra.com"><strong>Ingest Endpoint</strong></a> ·
</p>

<p align="center">
  <a href="https://pypi.org/project/splyntra/"><img src="https://img.shields.io/pypi/v/splyntra.svg" alt="PyPI version" /></a>
  <a href="https://www.npmjs.com/package/@splyntra/sdk"><img src="https://img.shields.io/npm/v/@splyntra/sdk.svg" alt="npm version" /></a>
  <a href="https://github.com/splyntra/splyntra/actions/workflows/go.yml"><img src="https://github.com/splyntra/splyntra/actions/workflows/go.yml/badge.svg" alt="Go" /></a>
  <a href="https://github.com/splyntra/splyntra/actions/workflows/python.yml"><img src="https://github.com/splyntra/splyntra/actions/workflows/python.yml/badge.svg" alt="Python" /></a>
  <a href="https://github.com/splyntra/splyntra/actions/workflows/web.yml"><img src="https://github.com/splyntra/splyntra/actions/workflows/web.yml/badge.svg" alt="Web" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/core-FSL--1.1--ALv2-blue.svg" alt="License" /></a>
  <a href="LICENSING.md"><img src="https://img.shields.io/badge/SDKs-Apache--2.0-green.svg" alt="SDKs" /></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/splyntra?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-splyntra" target="_blank" rel="noopener noreferrer">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1224406&theme=light&t=1787068071903" alt="Splyntra - Open-source AI agent observability and governance platform | Product Hunt" width="250" height="54" />
  </a>
  &nbsp;&nbsp;
  <a href="https://launchkiwi.com/p/splyntra" target="_blank" rel="noopener noreferrer">
    <img src="https://launchkiwi.com/badge-light.svg" alt="Featured on LaunchKiwi" height="54" />
  </a>
  &nbsp;&nbsp;
  <a href="https://wired.business" target="_blank" rel="noopener noreferrer">
    <img src="https://wired.business/badge1-white.svg" alt="Featured on Wired Business" width="200" height="54" />
  </a>
</p>

---

## Quick Start

```bash
# Start the full stack locally (dashboard, collector, detectors, eval, and infra)
docker compose up -d
```

| Service | Local Dev URL | Managed Cloud / Production | Notes |
|---------|---------------|----------------------------|-------|
| Dashboard | http://localhost:3000 | https://app.splyntra.com | Traces, logs, evals, security, cost |
| Collector (OTLP / Ingest) | http://localhost:4318 | https://ingest.splyntra.com | `/v1/traces`, `/v1/logs`, ingest + query API |

Database migrations (ClickHouse + Postgres) are applied automatically by the
containers on first start — there is no separate migrate step for local dev.

> **API keys.** `splyntra_dev_key` below is a **development-only** fallback that
> is accepted only when the stack runs with `ENV`/`NODE_ENV=development` (the
> default for `docker compose`). For production or managed cloud, generate a real
> key in **Settings → API Keys** and set `SPLYNTRA_API_KEY` along with
> `SPLYNTRA_ENDPOINT=https://ingest.splyntra.com` — the dev key is rejected in production (fail-closed).

### Instrument Your Agent (Python)

```bash
pip install splyntra
```

```python
import os
from splyntra import Splyntra, trace_agent, trace_tool, trace_llm, log

# Initialize once. Reads SPLYNTRA_API_KEY from environment in production;
# endpoint defaults to https://ingest.splyntra.com in cloud or http://localhost:4318 in local dev.
splyntra = Splyntra(
    api_key=os.getenv("SPLYNTRA_API_KEY", "splyntra_dev_key"),
    project="my-project",
    endpoint=os.getenv("SPLYNTRA_ENDPOINT", "https://ingest.splyntra.com"),  # or http://localhost:4318 locally
)

@trace_agent(name="support_agent", workflow="refund")
def run_agent(query: str):
    plan = call_llm(query)
    result = execute_tool(plan)
    log.info("refund handled", {"amount": plan.get("amount")})  # trace-correlated, redacted
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

Run your agent, then open the dashboard:

- **[/traces](https://app.splyntra.com/traces)** (or `http://localhost:3000/traces` locally) — the execution trace, with unified risk scoring for leaked secrets, exposed PII, prompt injection, content moderation, and unsafe tool calls.
- **[/logs](https://app.splyntra.com/logs)** — structured, trace-correlated logs (redacted like spans).

**Time to first trace: under 5 minutes.**

> For frameworks, skip the decorators and pass `instrument=["openai", "langgraph", …]`
> to `Splyntra(...)` for automatic tracing. See the [Python SDK](sdks/python/README.md).

### Instrument Your Agent (TypeScript / JavaScript)

```bash
npm install @splyntra/sdk
```

```ts
import { Splyntra, wrapAgent, wrapTool, wrapLLM, log } from "@splyntra/sdk";

// Initialize once (auto-instruments the listed frameworks).
// In production, set SPLYNTRA_ENDPOINT=https://ingest.splyntra.com
new Splyntra({
  apiKey: process.env.SPLYNTRA_API_KEY ?? "splyntra_dev_key",
  project: "my-project",
  endpoint: process.env.SPLYNTRA_ENDPOINT ?? "https://ingest.splyntra.com", // or http://localhost:4318 locally
  instrument: ["openai", "langgraph"],
});

// Wrap your own functions — works in TS and plain JS, no decorators needed:
const callLLM = wrapLLM(async (prompt: string) => openai.chat.completions.create({ /* ... */ }), "gpt-4o", "openai");
const readCrm = wrapTool(async (id: string) => db.get(id), "crm.read");
const runAgent = wrapAgent(async (q: string) => callLLM(q), "support_agent", "refund");

await runAgent("refund my order");
log.info("refund handled", { amount: 80 }); // trace-correlated, redacted
```

TypeScript users can use `@traceAgent` / `@traceTool` / `@traceLLM` decorators instead
(requires `experimentalDecorators`). Plain JavaScript works via `require("@splyntra/sdk")`.
The package also ships a `splyntra` CLI to gate CI on eval regressions
(`splyntra eval run --gate`). See [`sdks/typescript/README.md`](sdks/typescript/README.md)
and [`examples/quickstart.ts`](examples/quickstart.ts).

---

## What You Get

Five pillars on one pipeline — Observe, Evaluate, Secure, Govern, Trust.

| Pillar | Capabilities | Quality |
|--------|--------------|---------|
| **Observability** | Execution tracing, agent replay, structured trace-correlated logs, time-series metrics, cost analytics (run/model/project), model pricing management & budgets | ✅ GA |
| **Evaluation** | Dataset management, scorers (exact/rule/tool-call/latency/cost/groundedness), version-over-version regression, benchmark leaderboard, CI gate via the `splyntra` CLI — Python **and** TypeScript (+ LLM-as-judge in the commercial edition) | ✅ GA |
| **Security** | Secret + PII detection, content moderation, tool-guard, prompt-injection (beta) — all feeding one risk score; inline block/redact guard | ✅ GA / ⚠️ BETA |
| **Governance** | Activity Ledger (hash-chained), Delegation (self-service permissions, spend limits, approval workflow), Policy engine (RBAC/ABAC/ReBAC) | 💼 Commercial |
| **Dashboard** | Projects, alerts (risk + cost), team management (RBAC + login), model pricing editor, searchable/sortable/paginated tables with Excel export | ✅ GA |

> 💼 Governance, identity/SSO, the control plane, billing, and advanced
> detectors/scorers are the **commercial edition** (the private `splyntra-cloud`
> repository); the open core is fully usable without them. See [LICENSING.md](LICENSING.md).

**Integrations (auto-instrument):** OpenAI, Anthropic, Ollama, LangGraph, OpenAI Agents, CrewAI, MCP, LlamaIndex, Chroma — plus Google ADK & Pydantic AI (Python) · Dify, n8n (webhook). See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

---

## Documentation

| Doc | What's in it |
|-----|--------------|
| [Official Documentation](https://docs.splyntra.com) | Complete user guides, architecture, cloud onboarding, and SDK references |
| [Getting Started](docs/GETTING_STARTED.md) | Zero → first trace, dashboard tour, evaluation/governance, Docker + Helm |
| [API Reference](docs/API.md) | Ingest, query, metrics, pricing, budgets, integrations, governance, evaluation endpoints |
| [Web Dashboard](apps/web/README.md) | Next.js dashboard setup, production proxying (`COLLECTOR_URL`), environment variables, features |
| [Integrations](docs/INTEGRATIONS.md) | OpenAI, LangGraph, OpenAI Agents, CrewAI, Dify, n8n |
| [Python SDK](sdks/python/README.md) | `instrument()`, decorators, redaction, `eval` CLI, `authorize()`/`log_action()` |
| [TypeScript / JavaScript SDK](sdks/typescript/README.md) | Install, auto-instrument, function wrappers, decorators |
| [Helm chart](deploy/helm/splyntra) | Kubernetes / managed-cloud deployment |
| [Contributing](CONTRIBUTING.md) | Local dev, Conventional Commits, automated releases |
| [Security](SECURITY.md) | Responsible disclosure |
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

- **Server core, detectors, and dashboard** — [Functional Source License
  1.1](./LICENSE) (`FSL-1.1-ALv2`). Source-available: **free for any use inside
  your company** (self-host, modify, run at any scale), but you may not resell it
  or offer it as a competing product/service. Each release automatically becomes
  Apache-2.0 two years later.
- **Client SDKs** (`sdks/python`, `sdks/typescript`) and **integrations** —
  Apache-2.0.
- **Governance, identity/SSO, control plane, billing, advanced detectors** —
  commercial, in the separate private `splyntra-cloud` repository.

Contributions require the [CLA](./CLA.md).

---

## Security

For responsible disclosure of security vulnerabilities, see [SECURITY.md](./SECURITY.md).
Do not open public issues for security bugs.
