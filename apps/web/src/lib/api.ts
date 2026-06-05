// SPDX-License-Identifier: AGPL-3.0-only
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
}

export interface TraceListItem {
  trace_id: string;
  agent_id: string;
  workflow_id: string;
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
  detector: string;
  category: string;
  severity: string;
  confidence: number;
  description: string;
  is_beta: number;
  detected_at: string;
}

export async function fetchTraces(limit = 50): Promise<TraceListResponse> {
  return apiGet<TraceListResponse>(withProject(`/v1/traces?limit=${limit}`));
}

export async function fetchTrace(traceId: string): Promise<TraceDetailResponse> {
  return apiGet<TraceDetailResponse>(withProject(`/v1/traces/${encodeURIComponent(traceId)}`));
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
  last_seen_at: string;
}

export interface AgentsResponse {
  agents: AgentItem[];
  total: number;
}

export async function fetchAgents(): Promise<AgentsResponse> {
  return apiGet<AgentsResponse>(withProject(`/v1/agents`));
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

export interface CostsResponse {
  models: CostModelItem[];
  summary: CostSummary;
  by_project: ProjectCostItem[];
}

export async function fetchCosts(): Promise<CostsResponse> {
  return apiGet<CostsResponse>(withProject(`/v1/costs`));
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
  score: number;
  item_count: number;
  passed: boolean;
  regression: boolean;
  per_scorer: Record<string, number>;
  created_at: string;
}

async function evalGet<T>(path: string): Promise<T> {
  const res = await fetch(`${EVAL_BASE}${path}`, {
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
  p95_latency_ms: number;
  total_tokens: number;
  total_cost: number;
}

export interface MetricsResponse {
  points: MetricPoint[];
  window: number;
  interval: number;
}

export async function fetchMetrics(windowSec = 86400, intervalSec = 300): Promise<MetricsResponse> {
  return apiGet<MetricsResponse>(withProject(`/v1/metrics?window=${windowSec}&interval=${intervalSec}`));
}

// ─── Projects API ─────────────────────────────────────────────────────────

export interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  environment: string;
  created_at: string;
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

export async function deleteAlert(alertId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/alerts/${encodeURIComponent(alertId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete alert: ${res.status}`);
}
