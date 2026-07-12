<p align="center">
  <img src="https://avatars.githubusercontent.com/u/291030557?s=200" alt="Splyntra" width="64" />
</p>

# @splyntra/sdk

[![npm](https://img.shields.io/npm/v/@splyntra/sdk)](https://www.npmjs.com/package/@splyntra/sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

Unified observability and security for AI agents in TypeScript and JavaScript. Built on OpenTelemetry, the Splyntra SDK captures every agent step, LLM call, and tool invocation as a structured trace — enriched with real-time risk scoring for leaked secrets, PII exposure, and prompt injection.

Compatible with Node.js ≥ 18, TypeScript or plain JavaScript, ESM or CommonJS.

## Installation

```bash
npm install @splyntra/sdk
```

```bash
pnpm add @splyntra/sdk
# or
yarn add @splyntra/sdk
```

## Getting Started

Initialize once at process start. The `instrument` array enables automatic tracing for supported frameworks — no per-call changes required.

```ts
import { Splyntra } from "@splyntra/sdk";

new Splyntra({
  apiKey: "splyntra_dev_key",
  project: "my-app",
  endpoint: "http://localhost:4318",
  framework: "langgraph",
  instrument: ["openai", "langgraph"],
});

// Use the OpenAI SDK / LangGraph.js as usual — spans are captured automatically.
```

**CommonJS:**

```js
const { Splyntra } = require("@splyntra/sdk");

new Splyntra({
  apiKey: "splyntra_dev_key",
  project: "my-app",
  instrument: ["openai"],
});
```

## Manual Instrumentation

For custom functions beyond auto-instrumented frameworks, two approaches are available.

### Function Wrappers (TypeScript & JavaScript)

```ts
import { wrapAgent, wrapTool, wrapLLM } from "@splyntra/sdk";

const readCustomer = wrapTool(
  async (id: string) => db.get(id),
  "crm.read",
);

const callLLM = wrapLLM(
  async (prompt: string) =>
    openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: prompt }] }),
  "gpt-4o",
  "openai",
);

const runAgent = wrapAgent(
  async (query: string) => {
    const customer = await readCustomer("42");
    return callLLM(query);
  },
  "support_agent",
  "refund",
);

await runAgent("refund my order");
```

`wrapLLM` reads token usage from a returned object with a `usage` field (`{ prompt_tokens, completion_tokens }`) for cost analytics.

### Decorators (TypeScript only)

Requires `"experimentalDecorators": true` in `tsconfig.json`:

```ts
import { traceAgent, traceTool, traceLLM } from "@splyntra/sdk";

class SupportAgent {
  @traceAgent("support_agent", "refund")
  async run(query: string) { /* ... */ }

  @traceTool("crm.read")
  async readCustomer(id: string) { /* ... */ }

  @traceLLM("gpt-4o", "openai")
  async complete(prompt: string) { /* ... */ }
}
```

## Configuration

| Option            | Default                 | Description                                    |
|-------------------|-------------------------|------------------------------------------------|
| `apiKey`          | *required*              | Splyntra API key (sent as Bearer token)        |
| `project`         | *required*              | Project slug                                   |
| `endpoint`        | `http://localhost:4318` | Collector base URL                             |
| `environment`     | `development`           | Deployment environment label                   |
| `serviceName`     | value of `project`      | OpenTelemetry `service.name` resource          |
| `framework`       | —                       | Framework label shown on the Agents page       |
| `redactByDefault` | `true`                  | Strip secrets from spans before export         |
| `instrument`      | `[]`                    | Frameworks to auto-instrument                  |

## Client-Side Redaction

High-confidence secrets (AWS keys, JWTs, bearer tokens, API keys) are stripped from span attributes **before they leave your process**. The collector applies a second pass on ingest as defence-in-depth.

Disable with `redactByDefault: false` (not recommended for production).

## Graceful Shutdown

Spans are batched and flushed asynchronously. For short-lived scripts, flush before exit:

```ts
const splyntra = new Splyntra({ apiKey: "...", project: "my-app" });

// ...work...

await splyntra.shutdown();
```

The SDK also registers handlers on `SIGTERM` and `SIGINT` for automatic flush.

## Supported Frameworks

| Framework      | `instrument` name | Span mapping                                     |
|----------------|-------------------|--------------------------------------------------|
| OpenAI SDK     | `openai`          | Chat completions → `llm_call` spans              |
| Anthropic SDK  | `anthropic`       | Messages → `llm_call` spans                       |
| Ollama         | `ollama`          | Generate/chat → `llm_call` spans                  |
| LangGraph.js   | `langgraph`       | Graph `invoke` → `agent` span                     |
| CrewAI.js      | `crewai`          | Crew/Task/Tool → `agent`/`step`/`tool_call`       |
| OpenAI Agents  | `openai-agents`   | Agent runs → `agent`/`tool_call`                  |
| MCP            | `mcp`             | `tools/call` → `tool_call` (server, tool, args)   |
| LlamaIndex.TS  | `llamaindex`      | Query engine → `agent`; retriever → `retrieval`   |
| Chroma         | `chroma`          | Collection query/get → `vector_search`            |

Each instrumentor is a safe no-op when its target package is not installed.

## Structured Logs

Emit trace-correlated logs to the same collector (auto-attached to the active span, redacted like spans):

```ts
import { log } from "@splyntra/sdk";

log.info("charged card", { amount: 42 });
log.warn("rate limited", { server: "stripe" });
log.error("payment failed", { code: "card_declined" });
```

## Governance

Ask the control plane whether an agent may act, and record consequential actions to the tamper-evident ledger (served by Splyntra Cloud):

```ts
import { authorize, logAction } from "@splyntra/sdk";

const d = await authorize("payments.refund", { agentId: "support", context: { amount: 80 } });
if (d.decision === "allow") { /* proceed */ }
else if (d.decision === "needs_approval") { /* wait for a human */ }

await logAction("payments.refund", { actor: "support", resource: "order_123", metadata: { amount: 80 } });
```

## Evaluation

Push datasets and gate CI on regressions — programmatically or via the `splyntra` CLI (installed with this package):

```ts
import { pushDataset, runEval } from "@splyntra/sdk";

await pushDataset("support-qa", [{ input: "capital of France?", expected_output: "Paris" }]);
const res = await runEval(datasetId, [{ input: "capital of France?", actual: "Paris" }], { gate: true });
if (!res.passed) process.exit(1); // regression
```

```bash
# In CI (SPLYNTRA_API_KEY + SPLYNTRA_EVAL_ENDPOINT set):
splyntra eval push --name support-qa --file dataset.jsonl
splyntra eval run  --dataset <id> --file results.jsonl --scorers exact_match,groundedness --gate
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
