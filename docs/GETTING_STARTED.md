# Getting Started with Splyntra

Splyntra gives you **one view of what an AI agent did and whether it was safe** —
a full execution trace annotated with a risk score for leaked secrets, exposed
PII, and suspected prompt injection. This guide takes you from zero to your
first trace in under five minutes, then tours the dashboard and the two ways to
deploy.

---

## 1. Start Splyntra (self-host)

```bash
cp .env.example .env          # set POSTGRES_PASSWORD, CLICKHOUSE_PASSWORD, NEXTAUTH_SECRET, ...
docker compose up -d
```

This brings up the full stack:

| Service     | URL                     | Role                                   |
|-------------|-------------------------|----------------------------------------|
| Dashboard   | http://localhost:3000   | Traces, metrics, costs, evaluation, alerts |
| Collector   | http://localhost:4318   | OTLP ingest + query API                |
| Security    | http://localhost:8001   | Secret / PII / injection detectors     |
| Evaluation  | http://localhost:8002   | Datasets, scorers, regression gates    |

First time? Open <http://localhost:3000> and **sign up** — the first account
becomes the org owner; invite teammates from **Team**.

Wait for health: `curl localhost:4318/health` and `curl localhost:4318/ready`.

The dev API key is **`splyntra_dev_key`** (seeded; works when the collector runs
with `ENV=development`). It maps to the seeded org + "Default Project".

---

## 2. Instrument your agent (one line)

### Python

```bash
pip install "splyntra[langgraph,openai]"   # extras: langgraph, openai, openai-agents, crewai
```

```python
from splyntra import Splyntra

Splyntra(
    api_key="splyntra_dev_key",
    project="my-app",
    framework="langgraph",            # surfaced on the Agents page
    instrument=("langgraph", "openai"),  # also: "openai-agents", "crewai"
)
# ...run your LangGraph / OpenAI / CrewAI agent as usual — spans flow automatically.
```

Out-of-process platforms (**Dify**, **n8n**) post to the collector via webhook —
see [INTEGRATIONS.md](INTEGRATIONS.md).

Prefer manual control? Decorate functions:

```python
from splyntra import trace_agent, trace_tool, trace_llm

@trace_agent(name="support_agent", workflow="refund")
def run(query): ...

@trace_tool(name="crm.read")
def read_customer(id): ...

@trace_llm(model="gpt-4o", provider="openai")
def call_llm(prompt): ...
```

### TypeScript

```bash
npm install @splyntra/sdk
```

```ts
import { Splyntra, wrapAgent, wrapTool } from "@splyntra/sdk";

new Splyntra({
  apiKey: "splyntra_dev_key",
  project: "my-app",
  framework: "langgraph",
  instrument: ["openai", "langgraph"],
});

const run = wrapAgent(async (q: string) => { /* ... */ }, "support_agent", "refund");
```

### Run an example

```bash
python examples/langgraph_quickstart.py   # LangGraph path (DoD #1)
python examples/crewai_quickstart.py      # CrewAI crew
python examples/quickstart.py             # framework-free, decorator-based
python examples/security_demo.py          # deliberately leaks secrets + PII
```

Open <http://localhost:3000/traces> — your trace appears within seconds.

---

## 3. Read the unified trace + risk view

Click any trace to open the **trace viewer** — the heart of Splyntra:

- **Header** — status, latency, cost, total tokens, and the overall **risk
  score** (color-coded by severity).
- **Security detections** — every secret/PII/injection finding with its
  confidence. Injection findings are labelled **beta** and never block.
- **Execution steps (replay)** — the nested waterfall of agent → llm_call →
  tool_call → step spans. Expand a step for its model, tokens, per-span cost,
  input/output preview, and any span-level detections.

Observability answers *what did it do?*; security answers *was it safe?* — both
on one screen, from one pipeline.

---

## 4. Tour the rest of the dashboard

- **Traces** — recent runs with risk badges; click through to the viewer.
- **Agents** — per-agent volume, error rate, p95 latency, cost, detections, and
  framework (from the SDK).
- **Metrics** — latency (p50/p95), throughput, error/success rate, tokens, and
  spend over time (1h / 24h / 7d windows).
- **Costs** — spend by run, **by model**, and **by project**.
- **Evaluation** — datasets, run history, score-over-time, and regression flags.
- **Projects** — switch the active project (scopes every view). The selector in
  the sidebar persists your choice.
- **Alerts** — `risk_threshold` and `cost_threshold` alerts with email / webhook /
  Slack channels + triggered history (`ALERT_WEBHOOK_URL` / `ALERT_SLACK_WEBHOOK_URL`).
- **Ledger** — the append-only, hash-chained audit log, with an integrity check.
- **Policies** — RBAC/ABAC/ReBAC allow/deny rules (deny wins).
- **Delegation** — agent permissions, spend controls, and the approvals inbox.
- **Team** — members, roles (owner/admin/member/viewer), and invitations.

---

## 5. Redaction-by-default

Both SDKs scrub high-confidence secrets (AWS keys, JWTs, bearer tokens, API
keys) from span attributes **before they leave your process**. The collector
redacts again on ingest as defence-in-depth. To disable client-side redaction
(not recommended), pass `redact_by_default=False` (Python) /
`redactByDefault: false` (TS).

---

## 6. Evaluation & CI gates

Catch quality regressions before they ship. Push a labeled dataset, run your
agent over it in CI, post the outputs, and gate the release on the score:

```bash
splyntra eval push --name support-qa --file dataset.jsonl       # {input, expected_output}
# ...CI runs your agent, writes results.jsonl: {input, expected, actual}
splyntra eval run  --dataset <id> --file results.jsonl --gate   # exits 1 on regression
```

Built-in scorers: `exact_match`, `rule_based`, `tool_call_success`, `latency`,
`cost`. The `llm_as_judge` scorer is part of the **commercial** edition (the
`splyntra-scorers-pro` plugin). Results, score trend, and regression flags appear
on the **Evaluation** page.

## 7. Governance (commercial)

> Governance — the **Authorize** decision API, hash-chained **Ledger**, and
> **Policy** engine — is part of the commercial edition, not the open-source
> build. On the open collector these endpoints return `404`. They are served by
> the `collector-cloud` binary (the `splyntra-cloud` repository). The SDK helpers
> below ship in the open SDK as thin clients, so your agent code is identical;
> they simply require a `collector-cloud` deployment to function.

```python
from splyntra import authorize, log_action

# Ask before a consequential action — checks permissions, daily spend, policies, approvals.
decision = authorize("payments.refund", agent_id="support_agent", resource="payments", context={"amount": 80})
if decision["decision"] == "allow":
    do_refund()
elif decision["decision"] == "needs_approval":
    ...  # a human approves under Delegation → approvals

# Record it to the immutable, hash-chained ledger.
log_action("refund", actor="support_agent", resource="order_42", metadata={"amount": 80})
```

With the commercial edition: author allow/deny rules on the **Policies** page
(e.g. deny `payroll.read`), set agent permissions + spend limits + approval rules
under **Delegation**, and verify chain integrity on **Ledger**.

## 8. Deploy

### Self-host (Docker)

`docker compose up -d` — covered above. Suitable for a single host.

### Managed cloud (Kubernetes / Helm)

The same images deploy to any managed Kubernetes via the chart in
[`deploy/helm/splyntra`](../deploy/helm/splyntra):

```bash
# Bundled backends (good for a quick cluster / kind / minikube):
helm upgrade --install splyntra deploy/helm/splyntra \
  --set secrets.nextauthSecret=$(openssl rand -hex 32)

# Or point at managed backends (RDS / ClickHouse Cloud / managed NATS):
helm upgrade --install splyntra deploy/helm/splyntra \
  --set postgres.enabled=false --set clickhouse.enabled=false --set nats.enabled=false \
  --set external.postgresDsn="postgres://..." \
  --set external.clickhouseDsn="clickhouse://..." \
  --set external.natsUrl="nats://..." \
  --set ingress.enabled=true --set ingress.webHost=splyntra.example.com
```

Render without installing: `helm template splyntra deploy/helm/splyntra`.
Migrations run automatically — via the bundled backends' init mounts, or via a
post-install Job when using external DSNs.

---

## Next steps

- [API reference](API.md) — collector ingest + query endpoints.
- Tune detector precision and promote injection out of beta when ready.
- See the repo README for architecture and design principles.
