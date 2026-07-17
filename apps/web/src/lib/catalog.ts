// SPDX-License-Identifier: FSL-1.1-ALv2
// The Splyntra integrations catalog — the whole AI-agent ecosystem, organized by
// category with an honest support TIER on every entry:
//   native  — Splyntra ships the instrumentor/receiver
//   auto    — works via the user's OTel export (gen_ai.*/db.*) or an OpenAI-compatible base_url
//   cost    — model pricing is live (combines with native/auto)
//   planned — roadmap; the tile shows a "request" CTA, never a fake setup
// Connection helpers live in ./connect and are reused by the wizard / directory pages.
import { ingestBaseUrl, codeSnippets, webhookUrl, testIntegration } from "@/lib/connect";

export type Category = "framework" | "provider" | "platform" | "vectordb" | "database" | "mcp";
export type Method = "sdk" | "provider-compat" | "webhook" | "otlp" | "mcp";
export type Tier = "native" | "auto" | "cost" | "planned";

export interface Integration {
  id: string;
  name: string;
  category: Category;
  method: Method;
  tier: Tier[]; // one or more (e.g. ["native","cost"])
  icon: string; // lucide-react icon name (resolved via the page ICONS map)
  blurb: string;
  instrument?: string; // sdk/mcp: the SDK instrument() name
  baseUrl?: string; // provider-compat: OpenAI-compatible endpoint
  webhook?: string; // webhook: platform id → /v1/integrations/<id>
  docsHref?: string;
}

export interface CategoryDef {
  id: Category;
  label: string;
  icon: string;
  blurb: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "framework", label: "Agent Frameworks", icon: "Boxes", blurb: "In-process SDK auto-instrumentation." },
  { id: "provider", label: "LLM Providers", icon: "Sparkles", blurb: "Model-level cost + latency tracking." },
  { id: "platform", label: "Agent Platforms", icon: "Workflow", blurb: "Hosted / no-code agent builders (webhook)." },
  { id: "vectordb", label: "Vector Databases", icon: "Database", blurb: "RAG retrieval latency, hits, failures." },
  { id: "database", label: "Databases", icon: "Database", blurb: "Agent DB tool-call visibility." },
  { id: "mcp", label: "MCP Servers", icon: "Server", blurb: "Model Context Protocol tools — latency, failures, violations." },
];

const DOCS = "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md";

export const CATALOG: Integration[] = [
  // ── Agent frameworks (SDK) ──────────────────────────────────────────────
  { id: "openai", name: "OpenAI", category: "framework", method: "sdk", tier: ["native", "cost"], icon: "Sparkles", blurb: "Chat Completions auto-instrumented.", instrument: "openai" },
  { id: "anthropic", name: "Anthropic", category: "framework", method: "sdk", tier: ["native", "cost"], icon: "BrainCircuit", blurb: "Claude Messages API auto-instrumented.", instrument: "anthropic" },
  { id: "ollama", name: "Ollama", category: "framework", method: "sdk", tier: ["native"], icon: "Cpu", blurb: "Local models (chat / generate).", instrument: "ollama" },
  { id: "langgraph", name: "LangGraph", category: "framework", method: "sdk", tier: ["native"], icon: "GitBranch", blurb: "Compiled-graph invoke spans.", instrument: "langgraph" },
  { id: "crewai", name: "CrewAI", category: "framework", method: "sdk", tier: ["native"], icon: "Users", blurb: "Crew / task / tool spans.", instrument: "crewai" },
  { id: "openai-agents", name: "OpenAI Agents", category: "framework", method: "sdk", tier: ["native"], icon: "Bot", blurb: "Runner.run agent spans.", instrument: "openai-agents" },
  { id: "llamaindex", name: "LlamaIndex", category: "framework", method: "sdk", tier: ["native"], icon: "Boxes", blurb: "Query engine + workflow + retrieval spans.", instrument: "llamaindex" },
  { id: "pydantic-ai", name: "Pydantic AI", category: "framework", method: "sdk", tier: ["native"], icon: "Bot", blurb: "Agent.run agent + tool spans.", instrument: "pydantic-ai" },
  { id: "google-adk", name: "Google ADK", category: "framework", method: "sdk", tier: ["native"], icon: "Bot", blurb: "Agent Development Kit runner spans.", instrument: "google-adk" },
  { id: "autogen", name: "AutoGen", category: "framework", method: "sdk", tier: ["planned"], icon: "Users", blurb: "Microsoft AutoGen multi-agent." },
  { id: "mastra", name: "Mastra", category: "framework", method: "sdk", tier: ["planned"], icon: "GitBranch", blurb: "TypeScript agent framework." },
  { id: "semantic-kernel", name: "Semantic Kernel", category: "framework", method: "sdk", tier: ["planned"], icon: "Boxes", blurb: "Microsoft SK planners + plugins." },
  { id: "haystack", name: "Haystack Agents", category: "framework", method: "sdk", tier: ["planned"], icon: "Boxes", blurb: "deepset Haystack pipelines." },

  // ── LLM providers (OpenAI-compatible → provider-compat; cost-tracked) ────
  { id: "gemini", name: "Google Gemini", category: "provider", method: "provider-compat", tier: ["auto", "cost"], icon: "Sparkles", blurb: "Gemini models — cost + latency.", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "xai", name: "xAI Grok", category: "provider", method: "provider-compat", tier: ["native", "cost"], icon: "Sparkles", blurb: "Grok via OpenAI-compatible API.", baseUrl: "https://api.x.ai/v1", instrument: "openai" },
  { id: "mistral", name: "Mistral", category: "provider", method: "provider-compat", tier: ["native", "cost"], icon: "Sparkles", blurb: "Mistral models — cost + latency.", baseUrl: "https://api.mistral.ai/v1", instrument: "openai" },
  { id: "cohere", name: "Cohere", category: "provider", method: "provider-compat", tier: ["auto", "cost"], icon: "Sparkles", blurb: "Command models — cost tracking.", baseUrl: "https://api.cohere.ai/compatibility/v1" },
  { id: "together", name: "Together AI", category: "provider", method: "provider-compat", tier: ["native", "cost"], icon: "Sparkles", blurb: "Open models — OpenAI-compatible.", baseUrl: "https://api.together.xyz/v1", instrument: "openai" },
  { id: "fireworks", name: "Fireworks AI", category: "provider", method: "provider-compat", tier: ["native", "cost"], icon: "Sparkles", blurb: "Fast open-model inference.", baseUrl: "https://api.fireworks.ai/inference/v1", instrument: "openai" },
  { id: "groq", name: "Groq", category: "provider", method: "provider-compat", tier: ["native", "cost"], icon: "Cpu", blurb: "Ultra-low-latency inference.", baseUrl: "https://api.groq.com/openai/v1", instrument: "openai" },
  { id: "deepseek", name: "DeepSeek", category: "provider", method: "provider-compat", tier: ["native", "cost"], icon: "Sparkles", blurb: "DeepSeek chat / reasoner.", baseUrl: "https://api.deepseek.com/v1", instrument: "openai" },
  { id: "openrouter", name: "OpenRouter", category: "provider", method: "provider-compat", tier: ["native", "cost"], icon: "Share2", blurb: "Any model via one gateway.", baseUrl: "https://openrouter.ai/api/v1", instrument: "openai" },

  // ── Agent platforms (webhook / OTLP) ─────────────────────────────────────
  { id: "dify", name: "Dify", category: "platform", method: "webhook", tier: ["native"], icon: "Boxes", blurb: "Hosted LLM-app / workflow builder.", webhook: "dify", docsHref: `${DOCS}#dify-webhook` },
  { id: "n8n", name: "n8n", category: "platform", method: "webhook", tier: ["native"], icon: "Workflow", blurb: "Workflow automation.", webhook: "n8n", docsHref: `${DOCS}#n8n-webhook` },
  { id: "flowise", name: "Flowise", category: "platform", method: "webhook", tier: ["native"], icon: "Share2", blurb: "Low-code LLM flow builder.", webhook: "flowise", docsHref: `${DOCS}#flowise-webhook` },
  { id: "langflow", name: "Langflow", category: "platform", method: "webhook", tier: ["native"], icon: "Workflow", blurb: "Visual agent/flow builder.", webhook: "langflow", docsHref: `${DOCS}#langflow-webhook` },
  { id: "bedrock", name: "AWS Bedrock AgentCore", category: "platform", method: "otlp", tier: ["native"], icon: "Cloud", blurb: "Native OTLP, or forward a run summary.", webhook: "bedrock", docsHref: `${DOCS}#bedrock-webhook` },
  { id: "vertex", name: "Google Vertex Agent Engine", category: "platform", method: "otlp", tier: ["native"], icon: "Cloud", blurb: "Native OTLP, or forward a run summary.", webhook: "vertex", docsHref: `${DOCS}#vertex-webhook` },
  { id: "openclaw", name: "OpenClaw", category: "platform", method: "webhook", tier: ["native"], icon: "MessagesSquare", blurb: "Self-hosted multi-channel agent gateway.", webhook: "openclaw", docsHref: `${DOCS}#openclaw-webhook` },
  { id: "botpress", name: "Botpress", category: "platform", method: "webhook", tier: ["planned"], icon: "MessagesSquare", blurb: "Conversational agent platform." },
  { id: "azure-foundry", name: "Azure AI Foundry Agents", category: "platform", method: "otlp", tier: ["planned"], icon: "Cloud", blurb: "Azure AI Foundry agent service." },

  // ── Vector databases (retrieval; chroma native, rest via OTLP) ───────────
  { id: "chroma", name: "Chroma", category: "vectordb", method: "sdk", tier: ["native"], icon: "Database", blurb: "Retrieval spans (query latency, hits).", instrument: "chroma" },
  { id: "pinecone", name: "Pinecone", category: "vectordb", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Vector search via OTel semconv." },
  { id: "weaviate", name: "Weaviate", category: "vectordb", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Vector search via OTel semconv." },
  { id: "qdrant", name: "Qdrant", category: "vectordb", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Vector search via OTel semconv." },
  { id: "milvus", name: "Milvus", category: "vectordb", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Vector search via OTel semconv." },
  { id: "pgvector", name: "pgvector", category: "vectordb", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Postgres vector search." },
  { id: "elasticsearch", name: "Elasticsearch", category: "vectordb", method: "otlp", tier: ["auto"], icon: "Search", blurb: "Hybrid / vector retrieval." },
  { id: "redis-vector", name: "Redis Vector", category: "vectordb", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Redis vector search." },

  // ── Databases (db tool-calls; via OTel semconv) ──────────────────────────
  { id: "postgresql", name: "PostgreSQL", category: "database", method: "otlp", tier: ["auto"], icon: "Database", blurb: "DB tool-call spans + dangerous-SQL detection." },
  { id: "mysql", name: "MySQL", category: "database", method: "otlp", tier: ["auto"], icon: "Database", blurb: "DB tool-call spans." },
  { id: "mongodb", name: "MongoDB", category: "database", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Document DB tool-call spans." },
  { id: "redis", name: "Redis", category: "database", method: "otlp", tier: ["auto"], icon: "Database", blurb: "Cache / KV tool-call spans." },
  { id: "neo4j", name: "Neo4j", category: "database", method: "otlp", tier: ["auto"], icon: "Share2", blurb: "Graph DB tool-call spans." },

  // ── MCP servers (all covered by the one MCP instrumentor) ────────────────
  { id: "mcp-github", name: "GitHub MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "GitBranch", blurb: "Repos, issues, PRs as agent tools.", instrument: "mcp" },
  { id: "mcp-slack", name: "Slack MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "MessagesSquare", blurb: "Slack messaging tools.", instrument: "mcp" },
  { id: "mcp-gdrive", name: "Google Drive MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "Cloud", blurb: "Drive file tools.", instrument: "mcp" },
  { id: "mcp-notion", name: "Notion MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "Boxes", blurb: "Notion pages / DB tools.", instrument: "mcp" },
  { id: "mcp-jira", name: "Jira MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "Workflow", blurb: "Jira issue tools.", instrument: "mcp" },
  { id: "mcp-filesystem", name: "Filesystem MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "Server", blurb: "Local filesystem tools.", instrument: "mcp" },
  { id: "mcp-browser", name: "Browser MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "Search", blurb: "Headless browser tools.", instrument: "mcp" },
  { id: "mcp-postgres", name: "PostgreSQL MCP", category: "mcp", method: "mcp", tier: ["native"], icon: "Database", blurb: "Postgres query tools.", instrument: "mcp" },
];

// Per-platform connect recipes: ordered steps + a representative payload shown
// inline in the connect drawer (so users don't have to leave for docs).
export interface Recipe {
  steps: string[];
  payload: unknown;
}
const NODES_EXAMPLE = [
  { name: "Retriever", type: "tool", elapsed_ms: 90, status: "success" },
  { name: "LLM", type: "llm", model: "gpt-4o", prompt_tokens: 210, completion_tokens: 55, elapsed_ms: 410, status: "success" },
];
export const PLATFORM_RECIPES: Record<string, Recipe> = {
  dify: {
    steps: [
      "Open your Dify app → Workflow, and add an HTTP Request node as the final step.",
      "Set method POST and the URL to the endpoint above; add header Authorization: Bearer <your ingest key>.",
      "Set the body to the workflow_finished payload below. Map {{#sys.*#}} to your run's variables; add a nodes[] array for a per-step waterfall (optional).",
      "Publish the workflow and run it once — then click Test connection above to confirm the pipeline.",
    ],
    payload: { event: "workflow_finished", workflow_run_id: "{{#sys.workflow_run_id#}}", data: { workflow_id: "{{#sys.workflow_id#}}", status: "succeeded", elapsed_time: 1.2, total_tokens: 265 }, nodes: NODES_EXAMPLE },
  },
  n8n: {
    steps: [
      "Install the Splyntra community node (Settings → Community Nodes → n8n-nodes-splyntra), or add a final Code + HTTP Request node.",
      "In the node's Splyntra credential, set the collector base URL + your ingest key.",
      "Assemble the { workflow, execution_id, status, nodes[] } run summary and POST it to the endpoint above.",
      "Execute the workflow, then click Test connection to verify.",
    ],
    payload: { workflow: { id: "wf_42", name: "Support Agent" }, execution_id: "exec_123", status: "success", nodes: NODES_EXAMPLE },
  },
  flowise: {
    steps: [
      "In your Flowise chatflow, add an HTTP node (or a Custom Tool) as the final step.",
      "POST to the endpoint above with header Authorization: Bearer <your ingest key>.",
      "Send the { chatflow_id, name, session_id, status, nodes[] } summary below; session_id becomes the trace id.",
      "Run the chatflow, then click Test connection to verify.",
    ],
    payload: { chatflow_id: "cf_1", name: "RAG Bot", session_id: "sess_9", status: "success", nodes: NODES_EXAMPLE },
  },
  langflow: {
    steps: [
      "Add an API Request component (or a custom Python component) at the end of your Langflow flow.",
      "POST to the endpoint above with header Authorization: Bearer <your ingest key>.",
      "Send the { flow_id, name, session_id, status, nodes[] } summary below.",
      "Run the flow, then click Test connection to verify.",
    ],
    payload: { flow_id: "flow_1", name: "rag-flow", session_id: "sess_lf", status: "success", nodes: NODES_EXAMPLE },
  },
  bedrock: {
    steps: [
      "Preferred: set OTEL_EXPORTER_OTLP_ENDPOINT to the collector and OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <key> — Bedrock AgentCore's gen_ai.* spans ingest with no glue.",
      "Otherwise, add a Lambda subscribed to your agent's CloudWatch invocation logs.",
      "Have the Lambda POST the { agent_name, session_id, status, nodes[] } summary below to the endpoint above (Bearer key).",
      "Invoke the agent, then click Test connection to verify.",
    ],
    payload: { agent_name: "support-agent", agent_id: "ABC123", session_id: "sess_br", status: "success", elapsed_time: 1.4, total_tokens: 380, nodes: NODES_EXAMPLE },
  },
  vertex: {
    steps: [
      "Preferred: point Vertex Agent Engine's OTLP exporter at the collector (Authorization: Bearer <key>) — gen_ai.* spans ingest natively.",
      "Otherwise, add a Cloud Function triggered on the engine's execution logs.",
      "Have it POST the { app_name, session_id, status, nodes[] } summary below to the endpoint above (Bearer key).",
      "Run the agent, then click Test connection to verify.",
    ],
    payload: { app_name: "planner", reasoning_engine_id: "re_9", session_id: "sess_vx", status: "ok", nodes: NODES_EXAMPLE },
  },
  openclaw: {
    steps: [
      "Install the Splyntra OpenClaw plugin (openclaw-plugin-splyntra) into your gateway's plugins.",
      "In OpenClaw config set plugins.splyntra.endpoint + apiKey (or SPLYNTRA_ENDPOINT / SPLYNTRA_API_KEY).",
      "It hooks message:sent and POSTs the { session_id, agent, status, nodes[] } summary automatically.",
      "Send a message through a channel, then click Test connection to verify.",
    ],
    payload: { session_id: "sess_1", agent: "coder", channel: "telegram", status: "success", elapsed_time: 0.9, nodes: NODES_EXAMPLE },
  },
};
export function platformRecipe(id: string): Recipe | undefined {
  return PLATFORM_RECIPES[id];
}

// withWorkflowName returns a copy of a platform's sample payload with its
// workflow-identity field set to the user's chosen name, so the recipe the
// connect wizard shows (payload + cURL) reflects their real workflow. The field
// that carries the workflow name differs per platform, hence the switch.
export function withWorkflowName(platformId: string, payload: unknown, name: string): unknown {
  const n = name.trim();
  if (!n) return payload;
  const p = JSON.parse(JSON.stringify(payload)) as Record<string, any>;
  switch (platformId) {
    case "dify":
      if (p.data) p.data.workflow_id = n;
      break;
    case "n8n":
      if (p.workflow) p.workflow.name = n;
      break;
    case "flowise":
    case "langflow":
      p.name = n;
      break;
    case "bedrock":
      p.agent_name = n;
      break;
    case "vertex":
      p.app_name = n;
      break;
    case "openclaw":
      p.agent = n;
      break;
  }
  return p;
}

// ── lookups + helpers ────────────────────────────────────────────────────
export function byCategory(cat: Category): Integration[] {
  return CATALOG.filter((i) => i.category === cat);
}
export function findIntegration(id: string): Integration | undefined {
  return CATALOG.find((i) => i.id === id);
}
export function searchCatalog(query: string, cat?: Category | "all"): Integration[] {
  const q = query.trim().toLowerCase();
  return CATALOG.filter((i) => {
    if (cat && cat !== "all" && i.category !== cat) return false;
    if (!q) return true;
    return i.name.toLowerCase().includes(q) || i.blurb.toLowerCase().includes(q) || i.id.includes(q);
  });
}

export const TIER_LABEL: Record<Tier, string> = {
  native: "Native",
  auto: "Auto / OTLP",
  cost: "Cost-tracked",
  planned: "Planned",
};

export type GuardMode = "off" | "monitor" | "block";

// connectCode builds the agent's connect snippet: SDK init with service_name =
// agent_id (so traces attribute to it), the minted key, the chosen instrument
// list, guard mode, and base_url notes for any OpenAI-compatible providers.
export function connectCode(opts: {
  agentId: string;
  apiKey?: string;
  instruments: string[];
  guard: GuardMode;
  providerBaseUrls?: { name: string; url: string }[];
}): { python: string; typescript: string } {
  const endpoint = ingestBaseUrl();
  const key = opts.apiKey || "YOUR_INGEST_KEY";
  const insts = Array.from(new Set(opts.instruments.filter(Boolean)));
  const pyInst = insts.map((i) => `"${i}"`).join(", ") + (insts.length === 1 ? "," : "");
  const tsInst = insts.map((i) => `"${i}"`).join(", ");
  const pyGuard = opts.guard !== "off" ? `    guard="${opts.guard}",\n` : "";
  const tsGuard = opts.guard !== "off" ? `  guard: "${opts.guard}",\n` : "";
  const notes = (opts.providerBaseUrls || []).map((p) => `# ${p.name}: point your OpenAI client at base_url="${p.url}"`).join("\n");
  const noteBlock = notes ? notes + "\n" : "";
  const tsNotes = (opts.providerBaseUrls || []).map((p) => `// ${p.name}: set baseURL "${p.url}" on your OpenAI client`).join("\n");
  return {
    python:
      `# pip install splyntra\n` +
      `from splyntra import Splyntra\n\n` +
      noteBlock +
      `Splyntra(\n` +
      `    api_key="${key}",\n` +
      `    project="${opts.agentId}",\n` +
      `    service_name="${opts.agentId}",   # this agent's id in Splyntra\n` +
      `    endpoint="${endpoint}",\n` +
      `    instrument=(${pyInst}),\n` +
      pyGuard +
      `)`,
    typescript:
      `// npm install @splyntra/sdk\n` +
      `import { Splyntra } from "@splyntra/sdk";\n\n` +
      (tsNotes ? tsNotes + "\n\n" : "") +
      `new Splyntra({\n` +
      `  apiKey: "${key}",\n` +
      `  project: "${opts.agentId}",\n` +
      `  serviceName: "${opts.agentId}",\n` +
      `  endpoint: "${endpoint}",\n` +
      `  instrument: [${tsInst}],\n` +
      tsGuard +
      `});`,
  };
}

// Re-export connection helpers so pages import everything from the catalog.
export { ingestBaseUrl, codeSnippets, webhookUrl, testIntegration };
