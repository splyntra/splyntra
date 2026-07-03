# Production agent example

A **deployable** AI agent service instrumented with [`@splyntra/sdk`](https://www.npmjs.com/package/@splyntra/sdk) `^1.1.0` — not a quickstart. It shows the patterns you actually need to run an agent in production:

- **Fail-fast config** — env is validated before the port binds; the dev key and plaintext endpoints are refused in `production`.
- **Correct instrumentation layering** — wrap *your* logic (`wrapAgent`/`wrapTool`), and let the SDK **auto-instrument the LLM provider** (`instrument: ["openai"]`). No double spans.
- **Client-side redaction on** — secrets are stripped from spans before export (`redactByDefault: true`).
- **Resilience** — per-request timeout with real cancellation (`AbortController`), exponential-backoff retries that skip non-retriable (4xx / timeout) errors, and graceful degradation when the model returns junk.
- **Operable HTTP service** — `/healthz` + `/readyz` probes, body-size limits, structured JSON logs with a request id, and a **graceful SIGTERM drain that flushes telemetry** before exit (it takes over the signal handlers the SDK installs).
- **Pluggable LLM, one instrumentation path** — set `GEMINI_API_KEY` (Google Gemini 2.5 Flash) or `OPENAI_API_KEY` to call a real model; leave both unset for a labeled simulated completion so traces still flow. Gemini uses its OpenAI-compatible endpoint, so the *same* `openai` auto-instrumentor captures it with token usage — no provider-specific code.

## Architecture

```
POST /triage ─▶ support_triage_agent            (wrapAgent · workflow "support-triage")
                 ├─ crm.lookup_customer          (wrapTool)
                 └─ classify + draft reply       (Gemini/OpenAI, auto-instrumented · or simulated wrapLLM)
```

Each box is a span. Open the dashboard at `/traces` to see the tree, token usage/cost on the LLM span, and `ERROR` status with the recorded exception on any step that throws.

| File | Responsibility |
|------|----------------|
| [src/config.ts](src/config.ts) | Validated, immutable config; production startup assertions |
| [src/telemetry.ts](src/telemetry.ts) | The single `Splyntra` tracer; init + flush-on-shutdown |
| [src/agent.ts](src/agent.ts) | The triage agent, the CRM tool, timeout/retry helpers |
| [src/server.ts](src/server.ts) | HTTP service, probes, request handling, graceful drain |

## Run it

```bash
# 1. Start Splyntra so traces have somewhere to go.
docker compose up -d            # from the repo root

# 2. Configure + run the service.
cd examples/production-agent
cp .env.example .env            # defaults work against local self-host
npm install
npm run dev                     # tsx watch; or: npm run build && npm start
```

```bash
# 3. Send a ticket.
curl -s -X POST localhost:8080/triage \
  -H 'content-type: application/json' \
  -d '{"customerEmail":"jane@acme.com","message":"My invoice shows a duplicate charge — this is urgent"}' | jq

# {
#   "ticketId": "…",
#   "category": "billing",
#   "priority": "urgent",
#   "customerTier": "pro",
#   "draftReply": "…",
#   "model": "gemini-2.5-flash",
#   "simulated": false
# }
```

Open <http://localhost:3000/traces> to see the trace.

## Configuration

All via environment (see [.env.example](.env.example)). Required: `SPLYNTRA_API_KEY`, `SPLYNTRA_PROJECT`. In `NODE_ENV=production` the service **refuses to start** with the shared dev key or a non-HTTPS remote endpoint.

**LLM provider** — precedence is Gemini → OpenAI → simulated:

| Env | Provider | Default model |
|-----|----------|---------------|
| `GEMINI_API_KEY` | Google Gemini (OpenAI-compatible endpoint) | `gemini-2.5-flash` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o-mini` |
| *(neither)* | Simulated (`wrapLLM`) | `simulated-triage-v1` |

Get a Gemini key at <https://aistudio.google.com/apikey>. Cost on the LLM span is computed from the collector's model-pricing table — add a price for `gemini-2.5-flash` under **Costs → Manage model pricing** (else its spend records as `$0`).

## Deploy

```bash
docker build -t splyntra/triage-agent .
docker run -p 8080:8080 --env-file .env splyntra/triage-agent
```

`SIGTERM` reaches Node as PID 1, so the in-process drain runs: stop advertising `/readyz`, finish in-flight requests, flush spans, exit — with a hard deadline so a hung request never blocks past the orchestrator's grace period. Wire `/healthz` to the liveness probe and `/readyz` to the readiness probe.
