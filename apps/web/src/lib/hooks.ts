// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchTraces,
  fetchTrace,
  fetchAgents,
  fetchCosts,
  fetchProjects,
  fetchAlerts,
  fetchMetrics,
  fetchDatasets,
  fetchEvalRuns,
  fetchKeys,
  EvalDataset,
  EvalRun,
  ApiKeyItem,
  TraceListResponse,
  TraceDetailResponse,
  AgentsResponse,
  CostsResponse,
  ProjectsResponse,
  AlertsResponse,
  MetricsResponse,
} from "@/lib/api";
import { useProject } from "@/lib/project-context";

export function useTraces(limit = 50) {
  const { projectId } = useProject();
  return useQuery<TraceListResponse>({
    queryKey: ["traces", limit, projectId],
    queryFn: () => fetchTraces(limit),
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

export function useAgents() {
  const { projectId } = useProject();
  return useQuery<AgentsResponse>({
    queryKey: ["agents", projectId],
    queryFn: () => fetchAgents(),
    retry: 1,
  });
}

export function useCosts() {
  const { projectId } = useProject();
  return useQuery<CostsResponse>({
    queryKey: ["costs", projectId],
    queryFn: () => fetchCosts(),
    retry: 1,
  });
}

export function useMetrics(windowSec = 86400, intervalSec = 300) {
  const { projectId } = useProject();
  return useQuery<MetricsResponse>({
    queryKey: ["metrics", windowSec, intervalSec, projectId],
    queryFn: () => fetchMetrics(windowSec, intervalSec),
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
