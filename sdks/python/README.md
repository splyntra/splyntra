# Splyntra Python SDK

[![PyPI](https://img.shields.io/pypi/v/splyntra)](https://pypi.org/project/splyntra/)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

Unified observability and security for AI agents in Python. Built on OpenTelemetry, the Splyntra SDK captures every agent step, LLM call, and tool invocation as a structured trace — enriched with real-time risk scoring for leaked secrets, PII exposure, and prompt injection.

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
from splyntra import Splyntra

Splyntra(
    api_key="splyntra_dev_key",
    project="my-app",
    endpoint="http://localhost:4318",
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

## Client-Side Redaction

High-confidence secrets (AWS keys, JWTs, bearer tokens, API keys) are stripped from span attributes **before they leave your process**. The collector applies a second pass on ingest as defence-in-depth.

Disable with `redact_by_default=False` (not recommended for production).

## Supported Frameworks

| Framework     | Extra name      | Span mapping                                              |
|---------------|-----------------|-----------------------------------------------------------|
| OpenAI SDK    | `openai`        | Chat completions → `llm_call` spans                      |
| LangGraph     | `langgraph`     | Graph run → `agent` span, nodes → `step` spans           |
| OpenAI Agents | `openai-agents` | `Runner.run` → `agent` span                              |
| CrewAI        | `crewai`        | Crew kickoff → `agent`, tasks → `step`, tools → `tool_call` |

Each instrumentor is a safe no-op when its target package is not installed.

For out-of-process platforms (Dify, n8n), see [Integrations](../../docs/INTEGRATIONS.md).

## Evaluation

Run scored evaluations against the Splyntra evaluation service. The CLI exits non-zero on regression, making it suitable as a CI gate.

```python
from splyntra import eval as ev

ev.push_dataset("support-qa", [{"input": "...", "expected_output": "..."}])
result = ev.run(dataset_id, results=[{"input": "...", "actual": "..."}], gate=True)
```

```bash
splyntra eval push --name support-qa --file dataset.jsonl
splyntra eval run  --dataset <id> --file results.jsonl --gate
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
