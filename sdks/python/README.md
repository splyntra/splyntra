<p align="center">
  <img src="https://avatars.githubusercontent.com/u/291030557?s=200" alt="Splyntra" width="64" />
</p>

# Splyntra Python SDK

<p align="center">
  <a href="https://docs.splyntra.com"><strong>Documentation</strong></a> ·
  <a href="https://app.splyntra.com"><strong>Cloud Dashboard</strong></a> ·
  <a href="https://ingest.splyntra.com"><strong>Ingest Endpoint</strong></a>
</p>

[![PyPI](https://img.shields.io/pypi/v/splyntra)](https://pypi.org/project/splyntra/)
[![Docs](https://img.shields.io/badge/docs-docs.splyntra.com-blue)](https://docs.splyntra.com)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

Unified observability and security for AI agents in Python. Built on OpenTelemetry, the Splyntra SDK captures every agent step, LLM call, and tool invocation as a structured trace — enriched with real-time risk scoring for leaked secrets, PII exposure, prompt injection, content moderation, and unsafe tool calls. It also ships trace-correlated structured logging, an inline block/redact guardrail, evaluation, and governance helpers.

## Installation

```bash
pip install splyntra
```

With framework auto-instrumentation:

```bash
pip install "splyntra[langgraph,openai]"
```

Available extras: `langgraph`, `openai`, `openai-agents`, `crewai`

## Getting Started

Initialize once at application startup. The `instrument` parameter enables automatic tracing for supported frameworks — no per-call changes required.

```python
import os
from splyntra import Splyntra

Splyntra(
    api_key=os.getenv("SPLYNTRA_API_KEY", "splyntra_dev_key"),
    project="my-app",
    endpoint=os.getenv("SPLYNTRA_ENDPOINT", "https://ingest.splyntra.com"),  # or http://localhost:4318 for local dev
    framework="langgraph",
    instrument=("langgraph", "openai"),
)

# Run your LangGraph / OpenAI agent as usual — spans are captured automatically.
```

To instrument separately (e.g., after configuring the client elsewhere):

```python
from splyntra import instrument

instrument()                 # auto-detect all installed frameworks
instrument("langgraph")      # or target a specific one
```

## Manual Instrumentation

For custom agent, tool, and LLM functions, use decorators. Both sync and async functions are supported.

```python
from splyntra import trace_agent, trace_tool, trace_llm

@trace_agent(name="support_agent", workflow="refund")
def run(query: str):
    customer = read_customer("42")
    return call_llm(query)

@trace_tool(name="crm.read")
def read_customer(id: str):
    ...

@trace_llm(model="gpt-4o", provider="openai")
def call_llm(prompt: str) -> dict:
    # Return a dict with a "usage" key for token/cost analytics
    ...
```

## Configuration

| Parameter           | Default                 | Description                                    |
|---------------------|-------------------------|------------------------------------------------|
| `api_key`           | *required*              | Splyntra API key (sent as Bearer token)        |
| `project`           | *required*              | Project slug                                   |
| `endpoint`          | `http://localhost:4318` | Collector base URL                             |
| `environment`       | `development`           | Deployment environment label                   |
| `service_name`      | value of `project`      | OpenTelemetry `service.name` resource          |
| `framework`         | `None`                  | Framework label shown on the Agents page       |
| `redact_by_default` | `True`                  | Strip secrets from spans before export         |
| `instrument`        | `None`                  | Tuple of frameworks to auto-instrument         |
| `guard`             | `"off"`                 | Inline guardrail mode: `"off"`, `"monitor"`, or `"block"` |
| `guard_fail_open`   | `True`                  | On a guard-service error, allow (fail open) vs raise |

## Client-Side Redaction

High-confidence secrets (AWS keys, JWTs, bearer tokens, API keys) are stripped from span attributes **before they leave your process**. The collector applies a second pass on ingest as defence-in-depth.

Disable with `redact_by_default=False` (not recommended for production).

## Structured Logs

Emit trace-correlated logs to the same collector. Each entry auto-attaches the
active `trace_id`/`span_id` and is redacted with the same rules as spans, so logs
line up with the trace timeline on the dashboard's **Logs** page.

```python
from splyntra import log

log.info("charged card", {"amount": 42})
log.warn("rate limited", {"server": "stripe"})
log.error("payment failed", {"code": "card_declined"})
# also: log.debug(...), log.fatal(...)
```

The attributes mapping is optional and redacted before export.

## Inline Guard

The guardrail runs a fast, high-confidence check *before* a model/tool call
completes, so you can block or redact rather than only detect after the fact.
Enable it at init with `guard="monitor"` (log only) or `guard="block"` (raise on
a high-confidence prompt-injection match):

```python
from splyntra import Splyntra, SplyntraBlocked

Splyntra(api_key="...", project="my-app", guard="block", instrument=("openai",))

try:
    run_agent(user_input)
except SplyntraBlocked as e:
    # A high-precision injection signature was detected pre-flight.
    handle_blocked(e)
```

Secrets are redacted in place; only high-precision injection signatures block, so
benign role-play prompts pass through (deep analysis stays on the async detector
path). `guard_fail_open=True` (default) allows the call if the guard service is
unreachable — set it to `False` to fail closed.

## Supported Frameworks

| Framework     | `instrument` name | Span mapping                                              |
|---------------|-------------------|-----------------------------------------------------------|
| OpenAI SDK    | `openai`          | Chat completions → `llm_call` spans                      |
| Anthropic SDK | `anthropic`       | Messages → `llm_call` spans                              |
| Ollama        | `ollama`          | Generate/chat → `llm_call` spans                         |
| LangGraph     | `langgraph`       | Graph run → `agent` span, nodes → `step` spans           |
| OpenAI Agents | `openai_agents`   | `Runner.run` → `agent` span                              |
| CrewAI        | `crewai`          | Crew kickoff → `agent`, tasks → `step`, tools → `tool_call` |
| Google ADK    | `google_adk`      | Agent runs → `agent`/`tool_call` spans                   |
| Pydantic AI   | `pydantic_ai`     | Agent runs → `agent` span                                |
| LlamaIndex    | `llamaindex`      | Query engine → `agent`; retriever → `retrieval`          |
| Chroma        | `chroma`          | Collection query/get → `vector_search`                   |
| MCP           | `mcp`             | `tools/call` → `tool_call` (server, tool, args)          |

Each instrumentor is a safe no-op when its target package is not installed, so
`instrument()` with no arguments auto-detects everything present. Only the four
frameworks with a published PyPI dependency ship a pip extra (`openai`,
`langgraph`, `openai-agents`, `crewai`); the rest instrument whatever is already
in your environment.

For out-of-process platforms (Dify, n8n), see [Integrations](../../docs/INTEGRATIONS.md).

## Evaluation

Run scored evaluations against the Splyntra evaluation service. The service scores
caller-produced results against a dataset's ground truth (joined by `input`) — it
never executes your agent. Pick scorers explicitly; `run(..., gate=True)` exits
non-zero on a regression versus the dataset baseline, making it a CI gate.

```python
from splyntra import eval as ev

ev.push_dataset("support-qa", [
    {"input": "capital of France?", "expected_output": "Paris",
     "context": "Paris is the capital of France."},  # context powers groundedness
])

result = ev.run(
    dataset_id,
    results=[{"input": "capital of France?", "actual": "Paris"}],
    scorers=["exact_match", "groundedness"],
    gate=True,          # exit non-zero on regression
    set_baseline=False, # promote this run to the dataset baseline
)
```

Built-in scorers: `exact_match`, `rule_based`, `tool_call_success`,
`tool_call_precision`, `precision_token_overlap`, `recall_token_overlap`,
`groundedness`, `latency`, `cost` (LLM-as-judge `faithfulness` is available in the
commercial edition). `groundedness`/`faithfulness` require a `context` on the item.
`GET /v1/scorers` returns the live catalog.

```bash
# In CI (SPLYNTRA_API_KEY + SPLYNTRA_EVAL_ENDPOINT set):
splyntra eval push --name support-qa --file dataset.jsonl
splyntra eval run  --dataset <id> --file results.jsonl --scorers exact_match,groundedness --gate
```

## Governance

Request delegation decisions and record consequential actions to the immutable ledger:

```python
from splyntra import authorize, log_action

decision = authorize(
    "payments.refund",
    agent_id="support_agent",
    context={"amount": 80},
)

if decision["decision"] == "allow":
    # proceed with action
    ...
elif decision["decision"] == "needs_approval":
    # routed to human approval in the dashboard
    ...

log_action("refund", actor="support_agent", resource="order_42", metadata={"amount": 80})
```

## Examples

```bash
python examples/quickstart.py             # Decorator-based, framework-free
python examples/langgraph_quickstart.py   # LangGraph end-to-end
python examples/crewai_quickstart.py      # CrewAI crew
python examples/security_demo.py          # Deliberately triggers security detections
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
