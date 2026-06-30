<p align="center">
  <img src="https://avatars.githubusercontent.com/u/291030557?s=200" alt="Splyntra" width="80" />
</p>

<h1 align="center">Splyntra</h1>

<p align="center"><strong>Unified observability and security for AI agents.</strong></p>

<p align="center">See what your agents did and whether it was safe — in one view.</p>

<p align="center">
  <a href="https://github.com/splyntra/splyntra/actions/workflows/go.yml"><img src="https://github.com/splyntra/splyntra/actions/workflows/go.yml/badge.svg" alt="Go" /></a>
  <a href="https://github.com/splyntra/splyntra/actions/workflows/python.yml"><img src="https://github.com/splyntra/splyntra/actions/workflows/python.yml/badge.svg" alt="Python" /></a>
  <a href="https://github.com/splyntra/splyntra/actions/workflows/web.yml"><img src="https://github.com/splyntra/splyntra/actions/workflows/web.yml/badge.svg" alt="Web" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/core-AGPL--3.0-blue.svg" alt="License" /></a>
  <a href="LICENSING.md"><img src="https://img.shields.io/badge/SDKs-Apache--2.0-green.svg" alt="SDKs" /></a>
</p>

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
