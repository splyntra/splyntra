# @splyntra/sdk

Agent observability **and** security for TypeScript / JavaScript, built on
OpenTelemetry. Install it, add one line, and every agent step, LLM call, and tool
call shows up in Splyntra as a trace — annotated with a risk score for leaked
secrets, PII, and prompt injection.

Works in any Node.js ≥ 18 project: TypeScript or plain JavaScript, ESM or
CommonJS.

## Install

```bash
npm install @splyntra/sdk
# or: pnpm add @splyntra/sdk   /   yarn add @splyntra/sdk
```

## Quick start (one line)

Initialize once at process start. `instrument` auto-traces the listed
frameworks — no per-call code changes.

```ts
import { Splyntra } from "@splyntra/sdk";

new Splyntra({
  apiKey: "splyntra_dev_key",      // your Splyntra API key
  project: "my-app",
  endpoint: "http://localhost:4318", // your collector (default shown)
  framework: "langgraph",
  instrument: ["openai", "langgraph"],
});

// ...use the OpenAI SDK / LangGraph.js as usual — spans are captured automatically.
```

Plain JavaScript (CommonJS) is identical:

```js
const { Splyntra } = require("@splyntra/sdk");
new Splyntra({ apiKey: "splyntra_dev_key", project: "my-app", instrument: ["openai"] });
```

## Instrument your own functions

Auto-instrumentation covers supported frameworks. For your own agent/tool/LLM
functions there are two styles.

### Function wrappers — works in JS and TS

```ts
import { wrapAgent, wrapTool, wrapLLM } from "@splyntra/sdk";

const readCustomer = wrapTool(async (id: string) => db.get(id), "crm.read");

const callLLM = wrapLLM(
  async (prompt: string) => openai.chat.completions.create({ model: "gpt-4o", messages: [...] }),
  "gpt-4o",
  "openai",
);

const runAgent = wrapAgent(async (query: string) => {
  const c = await readCustomer("42");
  return callLLM(query);
}, "support_agent", "refund");

await runAgent("refund my order");
```

`wrapLLM` reads token usage from a returned object with a `usage` field
(`{ prompt_tokens, completion_tokens }`) for cost analytics.

### Decorators — TypeScript only

If you use classes and have `"experimentalDecorators": true` in your
`tsconfig.json`:

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

| Option            | Default                   | Description                                            |
|-------------------|---------------------------|--------------------------------------------------------|
| `apiKey`          | — (required)              | Splyntra API key (sent as a Bearer token).             |
| `project`         | — (required)              | Project slug.                                          |
| `endpoint`        | `http://localhost:4318`   | Collector base URL (no path).                          |
| `environment`     | `development`             | Deployment environment label.                          |
| `serviceName`     | `project`                 | OTel `service.name`.                                   |
| `framework`       | —                         | Framework label, shown on the Agents page.             |
| `redactByDefault` | `true`                    | Scrub secrets from spans **before** export.            |
| `instrument`      | `[]`                      | Frameworks to auto-instrument, e.g. `["openai"]`.      |

### Redaction by default

High-confidence secrets (AWS keys, JWTs, bearer tokens, API keys) are stripped
from span attributes **before they leave your process**. The collector redacts
again on ingest as defence-in-depth. Disable with `redactByDefault: false` (not
recommended).

## Clean shutdown

Spans are batched and flushed in the background. On a short-lived script, flush
before exit:

```ts
const splyntra = new Splyntra({ apiKey: "...", project: "my-app" });
// ...work...
await splyntra.shutdown();
```

(The SDK also flushes automatically on `SIGTERM` / `SIGINT`.)

## Supported auto-instrumentors

| Framework     | `instrument` name | Notes                                  |
|---------------|-------------------|----------------------------------------|
| OpenAI SDK    | `openai`          | Chat completions → `llm_call` spans.   |
| LangGraph.js  | `langgraph`       | Graph `invoke` → `agent` span.         |

Each is a safe no-op when its package isn't installed. More are demand-driven.

## License

Apache-2.0
