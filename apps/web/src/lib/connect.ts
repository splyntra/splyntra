// SPDX-License-Identifier: FSL-1.1-ALv2
// Metadata + helpers for the Connect page: the frameworks (code / in-process
// SDK) and no-code platforms (webhook), plus a "test connection" helper that
// posts a sample payload through the dashboard proxy so users can verify the
// pipeline before wiring their real source.
import { apiSend } from "@/lib/api";

// ─── Code: in-process SDK frameworks ─────────────────────────────────────────

export interface Framework {
  id: string; // SDK `instrument` name
  label: string;
  blurb: string;
  icon: string; // lucide-react icon name, resolved by the page's icon map
}

export const FRAMEWORKS: Framework[] = [
  { id: "openai", label: "OpenAI", blurb: "Chat Completions auto-instrumented.", icon: "Sparkles" },
  { id: "anthropic", label: "Anthropic", blurb: "Claude Messages API auto-instrumented.", icon: "BrainCircuit" },
  { id: "ollama", label: "Ollama", blurb: "Local models (chat / generate).", icon: "Cpu" },
  { id: "langgraph", label: "LangGraph", blurb: "Compiled-graph invoke spans.", icon: "GitBranch" },
  { id: "crewai", label: "CrewAI", blurb: "Crew / task / tool spans.", icon: "Users" },
  { id: "openai-agents", label: "OpenAI Agents", blurb: "Runner.run agent spans.", icon: "Bot" },
  { id: "mcp", label: "MCP", blurb: "Model Context Protocol tool calls.", icon: "Plug" },
];

/** The public ingest endpoint an external source posts to (NOT the dashboard proxy). */
export function ingestBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4318";
  return raw.replace(/\/+$/, "");
}

/** Python + TypeScript one-line SDK setup snippets for a framework. When `guard`
 * is true, the snippet enables the inline guardrail (blocks prompt-injection /
 * redacts secrets before the model call). */
export function codeSnippets(framework: string, project: string, guard = false): { python: string; typescript: string } {
  const endpoint = ingestBaseUrl();
  const proj = project || "my-app";
  const pyGuard = guard ? `    guard="block",   # block injection / redact secrets pre-flight\n` : "";
  const tsGuard = guard ? `  guard: "block",    // block injection / redact secrets pre-flight\n` : "";
  return {
    python:
      `# pip install splyntra\n` +
      `from splyntra import Splyntra\n\n` +
      `Splyntra(\n` +
      `    api_key="YOUR_INGEST_KEY",\n` +
      `    project="${proj}",\n` +
      `    endpoint="${endpoint}",\n` +
      `    instrument=("${framework}",),\n` +
      pyGuard +
      `)\n` +
      `# then use ${framework} as usual — calls are traced automatically.`,
    typescript:
      `// npm install @splyntra/sdk\n` +
      `import { Splyntra } from "@splyntra/sdk";\n\n` +
      `new Splyntra({\n` +
      `  apiKey: "YOUR_INGEST_KEY",\n` +
      `  project: "${proj}",\n` +
      `  endpoint: "${endpoint}",\n` +
      `  instrument: ["${framework}"],\n` +
      tsGuard +
      `});\n` +
      `// then use ${framework} as usual — calls are traced automatically.`,
  };
}

// ─── No-code: webhook platforms ──────────────────────────────────────────────

export interface Platform {
  id: "dify" | "n8n" | "flowise" | "bedrock" | "vertex" | "openclaw";
  label: string;
  blurb: string;
  steps: string[];
  docsHref: string;
  icon: string; // lucide-react icon name
  kind: "webhook" | "otlp"; // otlp = native OTLP is the primary path (webhook optional)
}

export const PLATFORMS: Platform[] = [
  {
    id: "dify",
    label: "Dify",
    blurb: "Hosted LLM-app / workflow builder.",
    steps: [
      "In your Dify workflow, add an HTTP Request node at the end.",
      "POST the workflow_finished payload (optionally with a nodes[] array) to the URL below.",
      "Send the API key as a Bearer token in the Authorization header.",
    ],
    docsHref: "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md#dify-webhook",
    icon: "Boxes",
    kind: "webhook",
  },
  {
    id: "n8n",
    label: "n8n",
    blurb: "Workflow automation.",
    steps: [
      "Install the Splyntra community node (or add a final Code + HTTP Request node).",
      "Assemble the { workflow, execution_id, status, nodes[] } summary and POST it to the URL below.",
      "Send the API key as a Bearer token.",
    ],
    docsHref: "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md#n8n-webhook",
    icon: "Workflow",
    kind: "webhook",
  },
  {
    id: "flowise",
    label: "Flowise",
    blurb: "Low-code LLM flow builder.",
    steps: [
      "Add an HTTP node (or custom tool) at the end of your chatflow.",
      "POST the { chatflow_id, name, session_id, status, nodes[] } summary to the URL below.",
      "Send the API key as a Bearer token.",
    ],
    docsHref: "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md#flowise-webhook",
    icon: "Share2",
    kind: "webhook",
  },
  {
    id: "bedrock",
    label: "AWS Bedrock AgentCore",
    blurb: "Native OTLP works out of the box; or forward a run summary.",
    steps: [
      "Preferred: point your OTLP exporter at /v1/traces — gen_ai.* spans ingest with no glue.",
      "Or: a Lambda forwards a { agent_name, session_id, status, nodes[] } summary to the URL below.",
      "Send the API key as a Bearer token.",
    ],
    docsHref: "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md#bedrock-webhook",
    icon: "Cloud",
    kind: "otlp",
  },
  {
    id: "vertex",
    label: "Google Vertex Agent Engine",
    blurb: "Native OTLP works out of the box; or forward a run summary.",
    steps: [
      "Preferred: point your OTLP exporter at /v1/traces — gen_ai.* spans ingest with no glue.",
      "Or: a Cloud Function forwards an { app_name, session_id, status, nodes[] } summary to the URL below.",
      "Send the API key as a Bearer token.",
    ],
    docsHref: "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md#vertex-webhook",
    icon: "Cloud",
    kind: "otlp",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    blurb: "Self-hosted multi-channel agent gateway.",
    steps: [
      "Install the Splyntra OpenClaw plugin (or add a message:sent hook that assembles the run).",
      "It POSTs a { session_id, agent, status, nodes[] } summary to the URL below when a session completes.",
      "Set the Splyntra endpoint + ingest key in the plugin config (Bearer token).",
    ],
    docsHref: "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md#openclaw-webhook",
    icon: "MessagesSquare",
    kind: "webhook",
  },
];

/** The webhook URL a no-code platform posts to for a given integration. */
export function webhookUrl(platform: string): string {
  return `${ingestBaseUrl()}/v1/integrations/${platform}`;
}

// Sample payloads used by "Test connection" — small but realistic (an llm_call
// + tool_call with tokens) so the resulting trace shows a waterfall + cost.
function sampleNodes() {
  return [
    { id: "n1", name: "classify", type: "llm", model: "gpt-4o-mini", prompt_tokens: 180, completion_tokens: 40, elapsed_ms: 240, status: "succeeded", input: "Test request from the Connect page", output: "billing" },
    { id: "n2", name: "lookup", type: "tool", elapsed_ms: 120, status: "succeeded" },
  ];
}

function samplePayload(platform: string, tag: string): unknown {
  const nodes = sampleNodes();
  switch (platform) {
    case "dify":
      return { event: "workflow_finished", workflow_run_id: tag, data: { workflow_id: "connect-test", status: "succeeded", elapsed_time: 0.4, total_tokens: 220 }, nodes };
    case "n8n":
      return { workflow: { id: "connect-test", name: "Connect Test" }, execution_id: tag, status: "success", nodes };
    case "flowise":
      return { chatflow_id: "connect-test", name: "Connect Test", session_id: tag, status: "success", nodes };
    case "bedrock":
      return { agent_name: "Connect Test", session_id: tag, status: "success", elapsed_time: 0.4, nodes };
    case "vertex":
      return { app_name: "Connect Test", session_id: tag, status: "success", elapsed_time: 0.4, nodes };
    case "openclaw":
      return { agent: "Connect Test", session_id: tag, channel: "test", status: "success", elapsed_time: 0.4, nodes };
    default:
      return {};
  }
}

export interface TestResult {
  accepted: number;
  spans: number;
  trace_id: string;
}

/**
 * POST a sample payload through the dashboard proxy to verify the integration
 * endpoint + pipeline end-to-end. Returns the created trace id.
 */
export async function testIntegration(platform: string): Promise<TestResult> {
  const tag = `connect-test-${platform}-${Math.random().toString(36).slice(2, 8)}`;
  return (await apiSend(`/v1/integrations/${platform}`, "POST", samplePayload(platform, tag))) as TestResult;
}
