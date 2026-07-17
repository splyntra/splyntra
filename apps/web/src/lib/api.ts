// SPDX-License-Identifier: FSL-1.1-ALv2
// Use Next.js API proxy in production, direct collector URL in development
const API_BASE =
  typeof window !== "undefined"
    ? window.location.origin + "/api"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:4318";

const ACTIVE_PROJECT_KEY = "splyntra_active_project";

/** Active project id (empty = the API key's default project). */
export function getActiveProject(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || "";
  }
  return "";
}

export function setActiveProject(projectId: string): void {
  if (typeof window !== "undefined") {
    if (projectId) localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    else localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
}

/** Append the active (or supplied) project id as a query param when set. */
function withProject(url: string, projectId?: string): string {
  const pid = projectId ?? getActiveProject();
  if (!pid) return url;
  return url + (url.includes("?") ? "&" : "?") + `project_id=${encodeURIComponent(pid)}`;
}

// Exported so commercial dashboard screens (composed in at cloud-build time)
// can reuse the same authenticated fetch helpers.
export async function apiGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface TraceListResponse {
  traces: TraceListItem[];
  total: number;
  limit?: number;
  offset?: number;
}

// Source-domain scoping, shared across fleet views. "agent" = SDK agents only,
// "platform" = orchestrator runs only; omit for all. `platform` narrows to one id.
export type SourceScope = "agent" | "platform";

export interface TraceQueryOpts {
  limit?: number;
  offset?: number;
  agentId?: string;
  workflowId?: string;
  status?: string; // "ok" | "error"
  severity?: string; // "low" | "medium" | "high" | "critical"
  since?: number; // seconds
  source?: SourceScope;
  platform?: string;
}

export interface TraceListItem {
  trace_id: string;
  agent_id: string;
  platform: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  latency_ms: number;
  total_tokens: number;
  cost_usd: number;
  risk_score: number;
  risk_severity: string;
  detection_count: number;
  span_count: number;
  started_at: string;
  completed_at: string;
}

export interface TraceDetailResponse {
  trace_id: string;
  // Authoritative stored trace row (risk/agent/status/timing) — present when the
  // trace exists; the detail view prefers this over recomputing from spans.
  trace?: {
    agent_id: string;
    platform: string;
    workflow_id: string;
    workflow_name: string;
    status: string;
    latency_ms: number;
    total_tokens: number;
    cost_usd: number;
    risk_score: number;
    risk_severity: string;
    detection_count: number;
    span_count: number;
    started_at: string;
    completed_at: string;
  };
  spans: SpanItem[];
  detections: DetectionItem[];
}

export interface SpanItem {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  type: string;
  name: string;
  status: string;
  latency_ms: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  input_preview: string;
  output_preview: string;
  attributes: Record<string, string>;
  started_at: string;
}

export interface DetectionItem {
  trace_id: string;
  span_id: string;
  agent_id?: string;
  detector: string;
  category: string;
  severity: string;
  confidence: number;
  description: string;
  is_beta: number;
  detected_at: string;
}

export async function fetchTraces(opts: TraceQueryOpts = {}): Promise<TraceListResponse> {
  const p = new URLSearchParams();
  p.set("limit", String(opts.limit ?? 50));
  if (opts.offset) p.set("offset", String(opts.offset));
  if (opts.agentId) p.set("agent_id", opts.agentId);
  if (opts.workflowId) p.set("workflow_id", opts.workflowId);
  if (opts.status) p.set("status", opts.status);
  if (opts.severity) p.set("severity", opts.severity);
  if (opts.since) p.set("since", String(opts.since));
  if (opts.source) p.set("source", opts.source);
  if (opts.platform) p.set("platform", opts.platform);
  return apiGet<TraceListResponse>(withProject(`/v1/traces?${p.toString()}`));
}

export async function fetchTrace(traceId: string): Promise<TraceDetailResponse> {
  return apiGet<TraceDetailResponse>(withProject(`/v1/traces/${encodeURIComponent(traceId)}`));
}

// ─── Structured logs (Layer 1 Observability) ─────────────────────────────────
export interface LogListItem {
  timestamp: string;
  agent_id: string;
  trace_id: string;
  span_id: string;
  severity: string; // TRACE|DEBUG|INFO|WARN|ERROR|FATAL
  body: string;
  attributes: Record<string, string>;
}
export interface LogListResponse {
  logs: LogListItem[];
  total: number;
  limit?: number;
  offset?: number;
}
export interface LogQueryOpts {
  limit?: number;
  offset?: number;
  agentId?: string;
  traceId?: string;
  severity?: string; // min-severity
  search?: string;
  since?: number;
  source?: SourceScope;
  platform?: string;
}
export async function fetchLogs(opts: LogQueryOpts = {}): Promise<LogListResponse> {
  const p = new URLSearchParams();
  p.set("limit", String(opts.limit ?? 50));
  if (opts.offset) p.set("offset", String(opts.offset));
  if (opts.agentId) p.set("agent_id", opts.agentId);
  if (opts.traceId) p.set("trace_id", opts.traceId);
  if (opts.severity) p.set("severity", opts.severity);
  if (opts.search) p.set("search", opts.search);
  if (opts.since) p.set("since", String(opts.since));
  if (opts.source) p.set("source", opts.source);
  if (opts.platform) p.set("platform", opts.platform);
  return apiGet<LogListResponse>(withProject(`/v1/logs?${p.toString()}`));
}

// ─── Security incidents feed ─────────────────────────────────────────────────
export interface IncidentQueryOpts {
  limit?: number;
  offset?: number;
  agentId?: string; // scope the feed to one agent (per-agent Trust view)
  detector?: string; // "pii" | "secrets" | "injection"
  severity?: string; // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" (floor)
  since?: number; // seconds
  source?: SourceScope;
  platform?: string;
}
export interface IncidentListResponse {
  incidents: DetectionItem[];
  total: number;
  limit?: number;
  offset?: number;
}
export async function fetchIncidents(opts: IncidentQueryOpts = {}): Promise<IncidentListResponse> {
  const p = new URLSearchParams();
  p.set("limit", String(opts.limit ?? 50));
  if (opts.offset) p.set("offset", String(opts.offset));
  if (opts.agentId) p.set("agent_id", opts.agentId);
  if (opts.detector) p.set("detector", opts.detector);
  if (opts.severity) p.set("severity", opts.severity);
  if (opts.since) p.set("since", String(opts.since));
  if (opts.source) p.set("source", opts.source);
  if (opts.platform) p.set("platform", opts.platform);
  return apiGet<IncidentListResponse>(withProject(`/v1/security/incidents?${p.toString()}`));
}

// Aggregate rollup shown above the incidents feed (severity/detector/top-agent
// distributions over the same filter window).
export interface IncidentSummary {
  total: number;
  by_severity: Record<string, number>;
  by_detector: Record<string, number>;
  top_agents: { agent_id: string; count: number }[];
}
export async function fetchIncidentSummary(opts: IncidentQueryOpts = {}): Promise<IncidentSummary> {
  const p = new URLSearchParams();
  if (opts.agentId) p.set("agent_id", opts.agentId);
  if (opts.detector) p.set("detector", opts.detector);
  if (opts.severity) p.set("severity", opts.severity);
  if (opts.since) p.set("since", String(opts.since));
  if (opts.source) p.set("source", opts.source);
  if (opts.platform) p.set("platform", opts.platform);
  return apiGet<IncidentSummary>(withProject(`/v1/security/summary?${p.toString()}`));
}

function getApiKey(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem("splyntra_api_key") || "";
  }
  return process.env.SPLYNTRA_API_KEY || "";
}

// ─── Agents API ─────────────────────────────────────────────────────────────

export interface AgentItem {
  agent_id: string;
  name?: string;
  framework?: string;
  trace_count: number;
  error_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_tokens: number;
  total_cost: number;
  detection_count: number;
  avg_risk: number;
  last_seen_at: string;
}

export interface AgentsResponse {
  agents: AgentItem[];
  total: number;
}

export async function fetchAgents(windowSec?: number): Promise<AgentsResponse> {
  const q = windowSec ? `?window=${windowSec}` : "";
  return apiGet<AgentsResponse>(withProject(`/v1/agents${q}`));
}

// ─── Agent Platforms API (orchestrators) ──────────────────────────────────────

// PlatformItem is one platform's run-level aggregate (Agent Platforms home). This
// is the platform-domain analog of AgentItem; the API returns only platform runs.
export interface PlatformItem {
  platform: string;
  run_count: number;
  error_count: number;
  workflow_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_tokens: number;
  total_cost: number;
  last_seen_at: string;
}

export interface PlatformsResponse {
  platforms: PlatformItem[];
  total: number;
}

// WorkflowItem is one workflow within a platform (Workflow Operations list).
export interface WorkflowItem {
  workflow_id: string;
  workflow_name: string;
  version: string;
  run_count: number;
  error_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_tokens: number;
  total_cost: number;
  last_seen_at: string;
}

export interface PlatformDetailResponse {
  platform: string;
  overview: PlatformItem | null;
  workflows: WorkflowItem[];
}

export async function fetchPlatforms(windowSec?: number): Promise<PlatformsResponse> {
  const q = windowSec ? `?window=${windowSec}` : "";
  return apiGet<PlatformsResponse>(withProject(`/v1/platforms${q}`));
}

export async function fetchPlatform(platform: string, windowSec?: number): Promise<PlatformDetailResponse> {
  const q = windowSec ? `?window=${windowSec}` : "";
  return apiGet<PlatformDetailResponse>(withProject(`/v1/platforms/${encodeURIComponent(platform)}${q}`));
}

// ─── Agent profiles (Connect wizard) ──────────────────────────────────────────
export interface AgentProfile {
  agent_id: string;
  name: string;
  frameworks: string[];
  providers: string[];
  vectordbs: string[];
  databases: string[];
  guard_mode: string;
  detectors: string[];
  alerts_enabled: boolean;
  api_key_id?: string;
}
export interface CreateAgentBody {
  name: string;
  agent_id?: string;
  frameworks?: string[];
  providers?: string[];
  vectordbs?: string[];
  databases?: string[];
  guard_mode?: string;
  detectors?: string[];
  alerts_enabled?: boolean;
}
export interface CreateAgentResult {
  agent_id: string;
  api_key: string; // shown once
  profile: AgentProfile;
}
export async function createAgent(body: CreateAgentBody): Promise<CreateAgentResult> {
  return apiSend(withProject(`/v1/agents`), "POST", body);
}
export async function fetchAgentProfile(agentId: string): Promise<AgentProfile> {
  return apiGet<AgentProfile>(withProject(`/v1/agents/${encodeURIComponent(agentId)}/profile`));
}
export async function updateAgentProfile(agentId: string, body: CreateAgentBody): Promise<void> {
  await apiSend(withProject(`/v1/agents/${encodeURIComponent(agentId)}/profile`), "PATCH", body);
}

// ─── Costs API ──────────────────────────────────────────────────────────────

export interface CostModelItem {
  model: string;
  call_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost: number;
  avg_cost_per_call: number;
}

export interface CostSummary {
  total_cost: number;
  total_calls: number;
  total_tokens: number;
  avg_cost_per_call: number;
}

export interface ProjectCostItem {
  project_id: string;
  call_count: number;
  total_tokens: number;
  total_cost: number;
}

export interface WorkflowCostItem {
  workflow_id: string;
  call_count: number;
  total_tokens: number;
  total_cost: number;
}
export interface CostsResponse {
  models: CostModelItem[];
  summary: CostSummary;
  by_project: ProjectCostItem[];
  by_workflow: WorkflowCostItem[];
}

export interface CostsQueryOpts {
  agentId?: string;
  source?: SourceScope;
  platform?: string;
}
export async function fetchCosts(opts: CostsQueryOpts = {}): Promise<CostsResponse> {
  const p = new URLSearchParams();
  if (opts.agentId) p.set("agent_id", opts.agentId);
  if (opts.source) p.set("source", opts.source);
  if (opts.platform) p.set("platform", opts.platform);
  const qs = p.toString();
  return apiGet<CostsResponse>(withProject(`/v1/costs${qs ? `?${qs}` : ""}`));
}

// ─── Model pricing (admin) ───────────────────────────────────────────────────
export interface ModelPriceRow {
  model: string;
  prompt_per_1k: number;
  completion_per_1k: number;
  updated_at: string;
}
export interface PricingResponse {
  prices: ModelPriceRow[];
  unpriced: string[] | null;
}
export async function fetchPricing(): Promise<PricingResponse> {
  return apiGet<PricingResponse>(`/v1/pricing`);
}
export async function upsertPricing(input: { model: string; prompt_per_1k: number; completion_per_1k: number }): Promise<void> {
  await apiSend(`/v1/pricing`, "PUT", input);
}
export async function deletePricing(model: string): Promise<void> {
  await apiSend(`/v1/pricing/${encodeURIComponent(model)}`, "DELETE");
}

// ─── Budgets ─────────────────────────────────────────────────────────────────
export interface BudgetView {
  id: string;
  project_id: string;
  monthly_limit_usd: number;
  spent_usd: number;
  forecast_usd: number;
  pct_used: number;
}
export interface BudgetsResponse {
  budgets: BudgetView[];
}
export async function fetchBudgets(): Promise<BudgetsResponse> {
  return apiGet<BudgetsResponse>(`/v1/budgets`);
}
export async function upsertBudget(input: { project_id?: string; monthly_limit_usd: number }): Promise<void> {
  await apiSend(`/v1/budgets`, "PUT", input);
}
export async function deleteBudget(id: string): Promise<void> {
  await apiSend(`/v1/budgets/${encodeURIComponent(id)}`, "DELETE");
}

// ─── Evaluation API (separate service, proxied via /api/eval) ───────────────

const EVAL_BASE =
  typeof window !== "undefined" ? window.location.origin + "/api/eval" : process.env.EVAL_URL || "http://localhost:8002";

export interface EvalDataset {
  id: string;
  name: string;
  slug: string;
  description: string;
  latest_version: number;
  item_count: number;
  created_at: string;
}

export interface EvalRun {
  id: string;
  dataset_id: string;
  version?: number;
  agent_id?: string | null;
  model?: string | null;
  score: number;
  item_count: number;
  passed: boolean;
  regression: boolean;
  per_scorer: Record<string, number>;
  created_at: string;
}

export interface LeaderboardRow {
  agent_id: string;
  model: string;
  runs: number;
  best_score: number;
  latest_score: number;
  pass_rate: number;
  last_run_at: string;
}
export async function fetchEvalLeaderboard(datasetId?: string): Promise<{ leaderboard: LeaderboardRow[] }> {
  return evalGet(`/v1/evaluations/leaderboard${datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : ""}`);
}

async function evalGet<T>(path: string): Promise<T> {
  // Scope to the active project (mirrors withProject for the collector) so the
  // dashboard's project switcher applies to evaluation data too. The evaluation
  // service honors ?project_id= within the authenticated org, exactly like the
  // collector's effectiveProject.
  const res = await fetch(`${EVAL_BASE}${withProject(path)}`, {
    headers: { Authorization: `Bearer ${getApiKey()}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Eval request failed: ${res.status}`);
  return res.json();
}

export async function fetchDatasets(): Promise<{ datasets: EvalDataset[] }> {
  return evalGet(`/v1/datasets`);
}

export async function fetchEvalRuns(datasetId?: string): Promise<{ runs: EvalRun[] }> {
  return evalGet(`/v1/evaluations${datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : ""}`);
}

export interface EvalResultItem {
  idx: number;
  input: string;
  expected: string;
  actual: string;
  passed: boolean;
  scores: Record<string, number>;
}
export interface EvalRunDetail {
  run: EvalRun;
  items: EvalResultItem[];
}
export async function fetchEvalRun(runId: string): Promise<EvalRunDetail> {
  return evalGet(`/v1/evaluations/${encodeURIComponent(runId)}`);
}

// Eval writes go through the /api/eval proxy (which enforces role ≥ member for
// non-GET) and are project-scoped, exactly like evalGet.
async function evalSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${EVAL_BASE}${withProject(path)}`, {
    method,
    headers: { Authorization: `Bearer ${getApiKey()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `Eval request failed: ${res.status}`);
  return res.json().catch(() => ({} as T));
}

// ─── Scorers catalog (for the Run-evaluation scorer picker) ───────────────────
export interface Scorer {
  name: string;
  description: string;
  kind: "deterministic" | "plugin";
  needs_context: boolean;
}
export async function fetchScorers(): Promise<{ scorers: Scorer[] }> {
  return evalGet(`/v1/scorers`);
}

// ─── Dataset authoring + detail ───────────────────────────────────────────────
export interface DatasetItemRow {
  input: string;
  expected_output?: string;
  expected_tool_calls?: string[];
  context?: string;
}
export interface DatasetVersion {
  version: number;
  item_count: number;
  object_key: string;
  created_at: string;
}
export interface DatasetInfo {
  id: string;
  name: string;
  slug: string;
  description: string;
  created_at: string;
}
export interface DatasetDetail {
  dataset: DatasetInfo;
  versions: DatasetVersion[];
  baseline: { run_id: string; score: number } | null;
  items: DatasetItemRow[];
}
export async function fetchDataset(id: string): Promise<DatasetDetail> {
  return evalGet(`/v1/datasets/${encodeURIComponent(id)}`);
}
export async function createDataset(input: { name: string; description?: string; items: DatasetItemRow[] }): Promise<{ dataset_id: string; slug: string; version: number; item_count: number }> {
  return evalSend(`/v1/datasets`, "POST", input);
}

// ─── Run an evaluation from the UI ────────────────────────────────────────────
export interface RunResultInput {
  input: string;
  actual: string;
  expected?: string;
  tool_calls?: string[];
  context?: string;
  latency_ms?: number;
  cost_usd?: number;
}
export interface RunEvalResult {
  run_id: string;
  version: number;
  score: number;
  per_scorer: Record<string, number>;
  baseline: number | null;
  regression: boolean;
  passed: boolean;
  matched_dataset_items: number;
  item_count: number;
}
export async function runEvaluation(input: {
  dataset_id: string;
  scorers: string[];
  results: RunResultInput[];
  set_baseline?: boolean;
  gate?: boolean;
  version?: number;
  agent_id?: string;
  model?: string;
}): Promise<RunEvalResult> {
  return evalSend(`/v1/evaluations/run`, "POST", input);
}
export async function setRunBaseline(runId: string): Promise<void> {
  await evalSend(`/v1/evaluations/${encodeURIComponent(runId)}/baseline`, "POST");
}

export async function apiSend(path: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${getApiKey()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) throw new Error(`Request failed: ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ─── Metrics API ─────────────────────────────────────────────────────────────

export interface MetricPoint {
  bucket: string;
  trace_count: number;
  error_count: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  total_tokens: number;
  total_cost: number;
}

export interface MetricsResponse {
  points: MetricPoint[];
  window: number;
  interval: number;
}

export interface MetricsQueryOpts {
  windowSec?: number;
  intervalSec?: number;
  offsetSec?: number; // shift window back (period-over-period comparison)
  agentId?: string;
  model?: string;
  source?: SourceScope;
  platform?: string;
}
// ─── Span metrics (Tools & Retrieval / MCP servers) ───────────────────────────
export interface SpanMetricGroup {
  key: string; // tool/span name or mcp.server.name
  count: number;
  error_count: number;
  flagged?: number; // detections on these spans (permission violations / risk)
  avg_ms: number;
  p95_ms: number;
}
export interface SpanMetricsResponse {
  groups: SpanMetricGroup[];
}
export interface SpanMetricsOpts {
  type?: string; // tool_call | retrieval | vector_search | db
  group?: "name" | "mcp_server";
  since?: number;
  server?: string; // narrow to one MCP server (mcp.server.name)
  source?: SourceScope;
  platform?: string;
}
export async function fetchSpanMetrics(opts: SpanMetricsOpts = {}): Promise<SpanMetricsResponse> {
  const p = new URLSearchParams();
  if (opts.type) p.set("type", opts.type);
  if (opts.group) p.set("group", opts.group);
  if (opts.since) p.set("since", String(opts.since));
  if (opts.server) p.set("server", opts.server);
  if (opts.source) p.set("source", opts.source);
  if (opts.platform) p.set("platform", opts.platform);
  return apiGet<SpanMetricsResponse>(withProject(`/v1/metrics/spans?${p.toString()}`));
}

export async function fetchMetrics(opts: MetricsQueryOpts = {}): Promise<MetricsResponse> {
  const p = new URLSearchParams();
  p.set("window", String(opts.windowSec ?? 86400));
  p.set("interval", String(opts.intervalSec ?? 300));
  if (opts.offsetSec) p.set("offset", String(opts.offsetSec));
  if (opts.agentId) p.set("agent_id", opts.agentId);
  if (opts.model) p.set("model", opts.model);
  if (opts.source) p.set("source", opts.source);
  if (opts.platform) p.set("platform", opts.platform);
  return apiGet<MetricsResponse>(withProject(`/v1/metrics?${p.toString()}`));
}

// ─── Projects API ─────────────────────────────────────────────────────────

export interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  environment: string;
  created_at: string;
  archived_at: string | null;
}

export interface ProjectsResponse {
  projects: ProjectItem[];
  total: number;
}

export async function fetchProjects(): Promise<ProjectsResponse> {
  return apiGet<ProjectsResponse>(`/v1/projects`);
}

export async function createProject(input: {
  name: string;
  slug?: string;
  environment?: string;
}): Promise<ProjectItem> {
  return apiSend(`/v1/projects`, "POST", input);
}

// Rename and/or archive a project (both fields optional).
export async function updateProject(
  id: string,
  patch: { name?: string; archived?: boolean }
): Promise<void> {
  await apiSend(`/v1/projects/${encodeURIComponent(id)}`, "PATCH", patch);
}

// Hard-delete a project and purge its trace data. Irreversible.
export async function deleteProject(id: string): Promise<void> {
  await apiSend(`/v1/projects/${encodeURIComponent(id)}`, "DELETE");
}

// ─── API keys (provisioning; requires an admin-scoped key) ───────────────────

export interface ApiKeyItem {
  id: string;
  name: string;
  project_id: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export async function fetchKeys(): Promise<{ keys: ApiKeyItem[] }> {
  return apiGet<{ keys: ApiKeyItem[] }>(`/v1/keys`);
}

// Returns the plaintext key exactly once (in `key`).
export async function createKey(input: {
  name: string;
  project_id?: string;
  scopes?: string[];
}): Promise<{ key: string; meta: ApiKeyItem }> {
  return apiSend(`/v1/keys`, "POST", input);
}

export async function revokeKey(id: string): Promise<void> {
  await apiSend(`/v1/keys/${encodeURIComponent(id)}`, "DELETE");
}

export async function rotateKey(id: string): Promise<{ key: string }> {
  return apiSend(`/v1/keys/${encodeURIComponent(id)}/rotate`, "POST");
}

// ─── Alerts API ─────────────────────────────────────────────────────────────

export interface AlertItem {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  channels: string[];
  is_active: boolean;
  created_at: string;
}

export interface AlertEventItem {
  id: string;
  alert_id: string;
  alert_name: string;
  trace_id: string;
  risk_score: number;
  severity: string;
  fired_at: string;
}

export interface AlertsResponse {
  alerts: AlertItem[];
  events: AlertEventItem[];
}

export async function fetchAlerts(): Promise<AlertsResponse> {
  return apiGet<AlertsResponse>(withProject(`/v1/alerts`));
}

export interface CreateAlertInput {
  name: string;
  type: string;
  project_id?: string;
  config: Record<string, unknown>;
  channels: string[];
}

export async function createAlert(input: CreateAlertInput): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/v1/alerts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create alert: ${res.status}`);
  return res.json();
}

export interface UpdateAlertInput {
  name?: string;
  type?: string; // sent to bound config validation server-side; not persisted
  config?: Record<string, unknown>;
  channels?: string[];
  is_active?: boolean;
}

export async function updateAlert(alertId: string, patch: UpdateAlertInput): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/alerts/${encodeURIComponent(alertId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok && res.status !== 204) {
    let msg = `Failed to update alert: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
}

export async function deleteAlert(alertId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/alerts/${encodeURIComponent(alertId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete alert: ${res.status}`);
}
