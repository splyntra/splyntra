// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TraceViewer - The crown jewel of the dashboard.
 * Shows execution trace + risk score in one unified view.
 * Supports agent replay: step-by-step reconstruction of any run.
 */

"use client";

import { useState } from "react";
import {
  Bot,
  BrainCircuit,
  Wrench,
  ArrowRight,
  CornerDownRight,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Clock,
  DollarSign,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { Trace, Span, Detection } from "@/types/trace";
import { Card, RiskBadge, SeverityBadge, StatusPill } from "@/components/ui/primitives";
import { SourceBadge, sourceOf } from "@/components/ui/SourceBadge";

interface TraceViewerProps {
  trace: Trace;
}

export function TraceViewer({ trace }: TraceViewerProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <div className="flex items-center gap-2">
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {trace.traceId}
            </code>
            <StatusPill status={trace.status} />
            <SourceBadge source={sourceOf(trace.platform)} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Bot className="h-4 w-4 text-gray-400" />
            <span className="font-medium">{trace.platform ? trace.workflowName || trace.workflowId || trace.agentId : trace.agentId}</span>
            {trace.platform && trace.workflowId && (
              <span className="text-gray-400">· workflow: {trace.workflowId}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <Metric icon={Clock} label="Latency" value={`${trace.latencyMs}ms`} />
          <Metric icon={DollarSign} label="Cost" value={`$${trace.costUsd.toFixed(4)}`} />
          <Metric icon={Coins} label="Tokens" value={trace.totalTokens.toLocaleString()} />
          <RiskBadge score={trace.riskScore} severity={trace.riskSeverity} />
        </div>
      </Card>

      {/* Detections Panel */}
      {trace.detections.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
            <ShieldAlert className="h-4 w-4" />
            Security Detections ({trace.detections.length})
          </h3>
          <div className="space-y-1.5">
            {trace.detections.map((d, i) => (
              <DetectionRow key={i} detection={d} />
            ))}
          </div>
        </div>
      )}

      {/* Span Waterfall (Replay View) */}
      <Card>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Execution Steps (Replay)</h3>
          <span className="text-xs text-gray-500">{trace.spans.length} steps · click to expand</span>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {trace.spans.map((span, idx) => (
            <SpanRow key={span.spanId} span={span} traceLatency={trace.latencyMs} stepNumber={idx + 1} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function SpanRow({ span, traceLatency, stepNumber }: { span: Span; traceLatency: number; stepNumber: number }) {
  const [expanded, setExpanded] = useState(false);
  const widthPct = Math.max((span.latencyMs / Math.max(traceLatency, 1)) * 100, 2);
  const flagged = span.detections.length > 0;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div>
      <div
        className="flex items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex w-1/3 items-center gap-2">
          <span className="w-5 text-xs tabular-nums text-gray-400">{stepNumber}.</span>
          <SpanTypeIcon type={span.type} />
          <span className="truncate text-sm font-medium">{span.name}</span>
          {span.parentSpanId && <CornerDownRight className="h-3 w-3 shrink-0 text-gray-400" />}
        </div>
        <div className="flex-1 px-4">
          <div className="relative h-2 rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className={`h-full rounded-full ${
                flagged ? "bg-red-400" : span.status === "error" ? "bg-orange-400" : "bg-splyntra-500"
              }`}
              style={{ width: `${widthPct}%` }}
            />
          </div>
        </div>
        <div className="w-20 text-right text-xs tabular-nums text-gray-500">{span.latencyMs}ms</div>
        {flagged && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-red-600">
            <ShieldAlert className="h-3.5 w-3.5" /> flagged
          </span>
        )}
        <Chevron className="ml-2 h-4 w-4 text-gray-400" />
      </div>

      {/* Expanded detail panel for replay */}
      {expanded && (
        <div className="border-t border-dashed border-gray-200 bg-gray-50 px-4 pb-3 dark:border-gray-700 dark:bg-gray-800/40">
          <div className="grid grid-cols-2 gap-4 py-3 text-xs md:grid-cols-4">
            <Detail label="Type" value={<span className="font-medium">{span.type}</span>} />
            <Detail label="Status" value={<StatusPill status={span.status} />} />
            <Detail label="Duration" value={<span className="font-medium">{span.latencyMs}ms</span>} />
            <Detail label="Span ID" value={<code className="text-gray-600 dark:text-gray-300">{span.spanId.slice(0, 12)}</code>} />
          </div>

          {span.tokens && (
            <div className="mt-1 rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                <BrainCircuit className="h-3.5 w-3.5 text-splyntra-500" /> LLM Usage
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <div><span className="text-gray-500">Model:</span> <span className="font-mono">{span.tokens.model}</span></div>
                <div><span className="text-gray-500">Prompt:</span> {span.tokens.promptTokens.toLocaleString()}</div>
                <div><span className="text-gray-500">Completion:</span> {span.tokens.completionTokens.toLocaleString()}</div>
                <div><span className="text-gray-500">Cost:</span> ${span.tokens.costUsd.toFixed(5)}</div>
              </div>
            </div>
          )}

          {span.detections.length > 0 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 dark:border-red-800 dark:bg-red-900/20">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
                <ShieldAlert className="h-3.5 w-3.5" /> Security Findings
              </div>
              <div className="space-y-1.5">
                {span.detections.map((d, i) => (
                  <DetectionRow key={i} detection={d} />
                ))}
              </div>
            </div>
          )}

          {span.input && Object.keys(span.input).length > 0 && <CodeBlock label="Input" value={span.input} />}
          {span.output && Object.keys(span.output).length > 0 && <CodeBlock label="Output" value={span.output} />}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="block text-gray-500">{label}</span>
      {value}
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">{label}</div>
      <pre className="max-h-32 overflow-auto rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-900">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function DetectionRow({ detection }: { detection: Detection }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <SeverityBadge severity={detection.severity} />
      <span className="text-gray-700 dark:text-gray-300">{detection.description}</span>
      <span
        className={`rounded px-1 text-[10px] font-medium uppercase ${
          detection.beta
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        }`}
      >
        {detection.beta ? "beta" : "reliable"}
      </span>
      <span className="ml-auto text-xs tabular-nums text-gray-400">
        {Math.round(detection.confidence * 100)}% confidence
      </span>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-xs text-gray-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const SPAN_ICON: Record<string, LucideIcon> = {
  agent: Bot,
  llm_call: BrainCircuit,
  tool_call: Wrench,
  step: ArrowRight,
};

function SpanTypeIcon({ type }: { type: string }) {
  const Icon = SPAN_ICON[type] || ArrowRight;
  return <Icon className="h-4 w-4 shrink-0 text-splyntra-500" />;
}
