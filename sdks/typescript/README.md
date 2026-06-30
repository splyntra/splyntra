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

| Framework    | `instrument` name | Span mapping                                |
|--------------|-------------------|---------------------------------------------|
| OpenAI SDK   | `openai`          | Chat completions → `llm_call` spans         |
| LangGraph.js | `langgraph`       | Graph `invoke` → `agent` span               |

Each instrumentor is a safe no-op when its target package is not installed.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
