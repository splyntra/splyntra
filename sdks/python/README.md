# Splyntra Python SDK

Agent observability **and** security for Python, built on OpenTelemetry. Install
it, add one line, and every agent step, LLM call, and tool call shows up in
Splyntra as a trace — annotated with a risk score for leaked secrets, PII, and
prompt injection.

## Install

```bash
pip install splyntra

# with framework auto-instrumentation:
pip install "splyntra[langgraph,openai]"
# extras: langgraph, openai, openai-agents, crewai
```

## Quick start (one line)

Initialize once at startup. `instrument` auto-traces the listed frameworks — no
per-call code changes.

```python
from splyntra import Splyntra

Splyntra(
    api_key="splyntra_dev_key",
    project="my-app",
    endpoint="http://localhost:4318",   # your collector (default shown)
    framework="langgraph",               # surfaced on the Agents page
    instrument=("langgraph", "openai"),  # auto-trace these frameworks
)

# ...run your LangGraph / OpenAI agent as usual — spans are captured automatically.
```

Auto-instrument separately (e.g. after configuring the client elsewhere):

```python
from splyntra import instrument

instrument()                 # auto-detect every installed framework
instrument("langgraph")      # or enable a specific one
```

## Instrument your own functions (decorators)

For your own agent/tool/LLM functions, decorate them. Sync and async are both
supported.

```python
from splyntra import trace_agent, trace_tool, trace_llm

@trace_agent(name="support_agent", workflow="refund")
def run(query: str):
    customer = read_customer("42")
    return call_llm(query)

@trace_tool(name="crm.read")
def read_customer(id: str): ...

@trace_llm(model="gpt-4o", provider="openai")
def call_llm(prompt: str) -> dict:
    # return a dict with a "usage" key for token/cost analytics
    ...
```

## Configuration

| Argument            | Default                 | Description                                       |
|---------------------|-------------------------|---------------------------------------------------|
| `api_key`           | — (required)            | Splyntra API key (sent as a Bearer token).        |
| `project`           | — (required)            | Project slug.                                     |
| `endpoint`          | `http://localhost:4318` | Collector base URL (no path).                     |
| `environment`       | `development`           | Deployment environment label.                     |
| `service_name`      | `project`               | OTel `service.name`.                              |
| `framework`         | `None`                  | Framework label, shown on the Agents page.        |
| `redact_by_default` | `True`                  | Scrub secrets from spans **before** export.       |
| `instrument`        | `None`                  | Tuple of frameworks to auto-instrument.           |

### Redaction by default

High-confidence secrets (AWS keys, JWTs, bearer tokens, API keys) are stripped
from span attributes **before they leave your process**. The collector redacts
again on ingest as defence-in-depth. Disable with `redact_by_default=False`
(not recommended).

## Supported auto-instrumentors

| Framework        | `instrument` name | Notes                                        |
|------------------|-------------------|----------------------------------------------|
| OpenAI SDK       | `openai`          | Chat completions → `llm_call` spans.         |
| LangGraph        | `langgraph`       | Graph run → `agent` span, nodes → `step`.    |
| OpenAI Agents    | `openai-agents`   | `Runner.run` → `agent` span.                 |
| CrewAI           | `crewai`          | Crew kickoff → `agent`, tasks → `step`, tools → `tool_call`. |

Each is a safe no-op when its package isn't installed. More are demand-driven.
(Dify and n8n run out-of-process — see [docs/INTEGRATIONS.md](../../docs/INTEGRATIONS.md).)

## Evaluation (CI gates)

Push datasets and run scored evaluations against the Splyntra evaluation service;
the CLI exits non-zero on a regression so it can gate a CI release:

```python
from splyntra import eval as ev
ev.push_dataset("support-qa", [{"input": "...", "expected_output": "..."}])
res = ev.run(dataset_id, results=[{"input": "...", "actual": "..."}], gate=True)
```

```bash
splyntra eval push --name support-qa --file dataset.jsonl
splyntra eval run  --dataset <id> --file results.jsonl --gate   # exit 1 on regression
```

## Governance (delegation + ledger)

Ask whether an agent may act, and record consequential actions to the immutable
ledger:

```python
from splyntra import authorize, log_action

d = authorize("payments.refund", agent_id="support_agent", context={"amount": 80})
if d["decision"] == "allow":
    ...                       # proceed
elif d["decision"] == "needs_approval":
    ...                       # a human approves in the dashboard
log_action("refund", actor="support_agent", resource="order_42", metadata={"amount": 80})
```

## Examples

```bash
python examples/langgraph_quickstart.py   # LangGraph, end-to-end
python examples/crewai_quickstart.py      # CrewAI crew
python examples/quickstart.py             # decorator-based, framework-free
python examples/security_demo.py          # deliberately leaks secrets + PII
```

## License

Apache-2.0
