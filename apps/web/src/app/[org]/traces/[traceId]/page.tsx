// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useParams } from "next/navigation";
import { useTrace } from "@/lib/hooks";
import { TraceViewer } from "@/components/trace/TraceViewer";
import { Trace, Span, Detection } from "@/types/trace";
import { TraceDetailResponse, SpanItem, DetectionItem } from "@/lib/api";
import Link from "next/link";
import { ArrowLeft, FileSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { useOrgHref } from "@/lib/org-path";

// Map API response to the Trace type expected by TraceViewer
function apiToTrace(traceId: string, data: TraceDetailResponse): Trace {
  const spans: Span[] = (data.spans || []).map((s: SpanItem) => ({
    spanId: s.span_id,
    parentSpanId: s.parent_span_id || undefined,
    type: (s.type as Span["type"]) || "step",
    name: s.name,
    status: (s.status as "ok" | "error") || "ok",
    latencyMs: s.latency_ms,
    tokens: s.prompt_tokens
      ? {
          promptTokens: s.prompt_tokens,
          completionTokens: s.completion_tokens,
          totalTokens: s.prompt_tokens + s.completion_tokens,
          model: s.model || "unknown",
          costUsd: s.cost_usd,
        }
      : undefined,
    input: s.input_preview ? { content: s.input_preview } : undefined,
    output: s.output_preview ? { content: s.output_preview } : undefined,
    detections: (data.detections || [])
      .filter((d: DetectionItem) => d.span_id === s.span_id)
      .map(mapDetection),
    startedAt: s.started_at,
  }));

  const detections: Detection[] = (data.detections || []).map(mapDetection);

  const totalLatency = spans.length > 0 ? Math.max(...spans.map((s) => s.latencyMs)) : 0;
  const totalTokens = spans.reduce(
    (sum, s) => sum + (s.tokens?.totalTokens || 0),
    0
  );
  const totalCost = spans.reduce((sum, s) => sum + (s.tokens?.costUsd || 0), 0);
  const maxSeverity = getMaxSeverity(detections);
  const riskScore = computeRiskScore(detections);

  // Prefer the stored trace row (authoritative — matches the list view) and fall
  // back to span-derived values only when it isn't present.
  const t = data.trace;
  return {
    traceId,
    agentId: t?.agent_id || spans[0]?.name || "unknown",
    platform: t?.platform || "",
    workflowId: t?.workflow_id || undefined,
    workflowName: t?.workflow_name || undefined,
    status: (t?.status as Trace["status"]) || (spans.some((s) => s.status === "error") ? "error" : "ok"),
    latencyMs: t?.latency_ms ?? totalLatency,
    totalTokens: t?.total_tokens ?? totalTokens,
    costUsd: t?.cost_usd ?? totalCost,
    riskScore: t?.risk_score ?? riskScore,
    riskSeverity: (t?.risk_severity as Trace["riskSeverity"]) || maxSeverity,
    detections,
    spans,
    startedAt: t?.started_at || spans[0]?.startedAt || new Date().toISOString(),
    completedAt: t?.completed_at || spans[0]?.startedAt || new Date().toISOString(),
    orgId: "",
    projectId: "",
    environment: "",
  };
}

function mapDetection(d: DetectionItem): Detection {
  return {
    detector: d.detector as Detection["detector"],
    category: d.category,
    severity: d.severity as Detection["severity"],
    confidence: d.confidence,
    description: d.description,
    beta: d.is_beta === 1,
    spanId: d.span_id,
  };
}

function getMaxSeverity(detections: Detection[]): Trace["riskSeverity"] {
  const order: Trace["riskSeverity"][] = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
  let max = 0;
  for (const d of detections) {
    const idx = order.indexOf(d.severity);
    if (idx > max) max = idx;
  }
  return order[max];
}

function computeRiskScore(detections: Detection[]): number {
  const weights: Record<string, number> = { LOW: 10, MEDIUM: 25, HIGH: 50, CRITICAL: 90 };
  let score = 0;
  for (const d of detections) {
    score += (weights[d.severity] || 0) * d.confidence;
  }
  return Math.min(Math.round(score), 100);
}

export default function TraceDetailPage() {
  const oh = useOrgHref();
  const params = useParams();
  const traceId = params.traceId as string;
  const { data, isLoading, error } = useTrace(traceId);

  // A trace exists if the stored trace row is present OR it has spans. A trace
  // with zero spans is still a real trace (summary only) — not "not found".
  const hasTrace = !!data && (!!data.trace || (data.spans?.length || 0) > 0);
  const noSpans = hasTrace && (data!.spans?.length || 0) === 0;
  const trace = hasTrace ? apiToTrace(traceId, data!) : null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4">
        <Link
          href={oh("/traces")}
          className="inline-flex items-center gap-1.5 text-sm text-splyntra-600 hover:text-splyntra-700 hover:underline dark:text-splyntra-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to traces
        </Link>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading trace…</div>
      ) : trace ? (
        <>
          {noSpans && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              This trace has no recorded spans yet — showing the trace summary only.
            </div>
          )}
          <TraceViewer trace={trace} />
        </>
      ) : (
        <EmptyState icon={FileSearch} title="Trace not found">
          {error ? "Could not reach the collector." : `No trace with id ${traceId} in this project.`}
          <code className="mt-2 block text-xs text-gray-400">{traceId}</code>
        </EmptyState>
      )}
    </div>
  );
}
