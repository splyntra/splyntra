// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trace types - the core data model surfaced in the dashboard.
 */

export interface Trace {
  traceId: string;
  agentId: string;
  platform?: string; // '' = SDK agent; else platform id (dify/n8n/…)
  workflowId?: string;
  workflowName?: string;
  status: "ok" | "error";
  latencyMs: number;
  totalTokens: number;
  costUsd: number;
  riskScore: number;
  riskSeverity: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detections: Detection[];
  spans: Span[];
  startedAt: string;
  completedAt: string;
  orgId: string;
  projectId: string;
  environment: string;
}

export interface Span {
  spanId: string;
  parentSpanId?: string;
  type: "agent" | "llm_call" | "tool_call" | "step";
  name: string;
  status: "ok" | "error";
  latencyMs: number;
  tokens?: TokenUsage;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  detections: Detection[];
  startedAt: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  costUsd: number;
}

export interface Detection {
  detector: "pii" | "secrets" | "injection";
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: number;
  description: string;
  beta: boolean;
  spanId?: string;
}
