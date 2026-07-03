// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchTraces,
  fetchTrace,
  fetchIncidents,
  IncidentQueryOpts,
  IncidentListResponse,
  fetchAgents,
  fetchCosts,
  fetchPricing,
  fetchBudgets,
  PricingResponse,
  BudgetsResponse,
  fetchProjects,
  fetchAlerts,
  fetchMetrics,
  fetchSpanMetrics,
  fetchAgentProfile,
  SpanMetricsOpts,
  SpanMetricsResponse,
  fetchDatasets,
  fetchEvalRuns,
  fetchEvalRun,
  EvalRunDetail,
  fetchKeys,
  EvalDataset,
  EvalRun,
  ApiKeyItem,
  TraceListResponse,
  TraceQueryOpts,
  TraceDetailResponse,
  AgentsResponse,
  CostsResponse,
  ProjectsResponse,
  AlertsResponse,
  MetricsResponse,
  MetricsQueryOpts,
  CostsQueryOpts,
} from "@/lib/api";
import { useProject } from "@/lib/project-context";

export function useTraces(opts: TraceQueryOpts = {}) {
  const { projectId } = useProject();
  return useQuery<TraceListResponse>({
    queryKey: ["traces", opts, projectId],
    queryFn: () => fetchTraces(opts),
    retry: 1,
  });
}

export function useSecurityIncidents(opts: IncidentQueryOpts = {}) {
  const { projectId } = useProject();
  return useQuery<IncidentListResponse>({
    queryKey: ["security-incidents", opts, projectId],
    queryFn: () => fetchIncidents(opts),
    retry: 1,
  });
}

export function useTrace(traceId: string) {
  const { projectId } = useProject();
  return useQuery<TraceDetailResponse>({
    queryKey: ["trace", traceId, projectId],
    queryFn: () => fetchTrace(traceId),
    enabled: !!traceId,
    retry: 1,
  });
}

export function useAgents(windowSec?: number) {
  const { projectId } = useProject();
  return useQuery<AgentsResponse>({
    queryKey: ["agents", windowSec, projectId],
    queryFn: () => fetchAgents(windowSec),
    retry: 1,
  });
}

// useCosts accepts either an agent id (per-agent Costs tab) or a full opts object
// (source/platform scoping for the fleet + platform cost views).
export function useCosts(arg?: string | CostsQueryOpts) {
  const { projectId } = useProject();
  const opts: CostsQueryOpts = typeof arg === "string" ? { agentId: arg } : arg ?? {};
  return useQuery<CostsResponse>({
    queryKey: ["costs", opts, projectId],
    queryFn: () => fetchCosts(opts),
    retry: 1,
  });
}

export function useBudgets() {
  return useQuery<BudgetsResponse>({
    queryKey: ["budgets"],
    queryFn: () => fetchBudgets(),
    retry: 1,
  });
}

export function usePricing(enabled = true) {
  return useQuery<PricingResponse>({
    queryKey: ["pricing"],
    queryFn: () => fetchPricing(),
    enabled,
    retry: 1,
  });
}

export function useAgentProfile(agentId: string, enabled = true) {
  const { projectId } = useProject();
  return useQuery<import("@/lib/api").AgentProfile>({
    queryKey: ["agent-profile", agentId, projectId],
    queryFn: () => fetchAgentProfile(agentId),
    enabled: enabled && !!agentId,
    retry: 0,
  });
}

export function useSpanMetrics(opts: SpanMetricsOpts = {}) {
  const { projectId } = useProject();
  return useQuery<SpanMetricsResponse>({
    queryKey: ["span-metrics", opts, projectId],
    queryFn: () => fetchSpanMetrics(opts),
    retry: 1,
  });
}

export function useMetrics(opts: MetricsQueryOpts = {}, enabled = true) {
  const { projectId } = useProject();
  return useQuery<MetricsResponse>({
    queryKey: ["metrics", opts, projectId],
    queryFn: () => fetchMetrics(opts),
    enabled,
    retry: 1,
  });
}

export function useDatasets() {
  return useQuery<{ datasets: EvalDataset[] }>({
    queryKey: ["eval-datasets"],
    queryFn: () => fetchDatasets(),
    retry: 1,
  });
}

export function useEvalRuns(datasetId?: string) {
  return useQuery<{ runs: EvalRun[] }>({
    queryKey: ["eval-runs", datasetId ?? "all"],
    queryFn: () => fetchEvalRuns(datasetId),
    retry: 1,
  });
}

export function useEvalRun(runId: string | null) {
  return useQuery<EvalRunDetail>({
    queryKey: ["eval-run", runId],
    queryFn: () => fetchEvalRun(runId!),
    enabled: !!runId,
    retry: 1,
  });
}

export function useKeys() {
  return useQuery<{ keys: ApiKeyItem[] }>({
    queryKey: ["keys"],
    queryFn: () => fetchKeys(),
    retry: 1,
  });
}


export function useProjects() {
  return useQuery<ProjectsResponse>({
    queryKey: ["projects"],
    queryFn: () => fetchProjects(),
    retry: 1,
    refetchInterval: false,
  });
}

export function useAlerts() {
  const { projectId } = useProject();
  return useQuery<AlertsResponse>({
    queryKey: ["alerts", projectId],
    queryFn: () => fetchAlerts(),
    retry: 1,
  });
}
