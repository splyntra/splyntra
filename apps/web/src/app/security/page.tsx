// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSecurityIncidents, useSecuritySummary } from "@/lib/hooks";
import { DetectionItem, SourceScope } from "@/lib/api";
import { ShieldAlert, ExternalLink } from "lucide-react";
import { PageHeader, Card, EmptyState, SeverityBadge } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { SourceFilter } from "@/components/ui/SourceFilter";
import { ExportButton } from "@/components/ui/ExportButton";
import { ServerPagination } from "@/components/ui/DataTable";
const TIME_RANGES = [
  { label: "All time", value: 0 },
  { label: "Last hour", value: 3600 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
];
// Every detector the security engine can emit — keep in sync with apps/security.
const DETECTOR_LABEL: Record<string, string> = {
  pii: "PII",
  secrets: "Secret",
  injection: "Injection",
  moderation: "Moderation",
  tool_guard: "Tool guard",
};
const DETECTOR_OPTIONS = [
  { value: "", label: "All detectors" },
  { value: "pii", label: "PII" },
  { value: "secrets", label: "Secrets" },
  { value: "injection", label: "Prompt injection" },
  { value: "moderation", label: "Moderation" },
  { value: "tool_guard", label: "Tool guard" },
];
const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const SEV_TONE: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-yellow-400",
};

export default function SecurityPage() {
  const [detector, setDetector] = useState("");
  const [severity, setSeverity] = useState("");
  const [since, setSince] = useState(0);
  const [source, setSource] = useState<"" | SourceScope>("");
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setOffset(0);
  }, [detector, severity, since, source]);

  const filterOpts = useMemo(
    () => ({ detector: detector || undefined, severity: severity || undefined, since: since || undefined, source: source || undefined }),
    [detector, severity, since, source]
  );
  const opts = useMemo(() => ({ limit: pageSize, offset, ...filterOpts }), [offset, pageSize, filterOpts]);
  const { data, isLoading, error } = useSecurityIncidents(opts);
  const { data: summary } = useSecuritySummary(filterOpts);
  const incidents: DetectionItem[] = data?.incidents || [];
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        icon={ShieldAlert}
        title="Security"
        subtitle="Detected incidents across your agents — prompt injection, secret exposure, PII leakage, content moderation, and unsafe tool calls."
      />
      {error && !isLoading && (
        <p className="mb-4 text-xs text-red-500">Could not reach the collector. Check that the stack is running.</p>
      )}

      {/* Summary strip — the shape of risk before the raw feed. */}
      {summary && summary.total > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">By severity</div>
            <div className="mt-2 space-y-1.5">
              {SEV_ORDER.filter((s) => (summary.by_severity[s] || 0) > 0).map((s) => {
                const n = summary.by_severity[s] || 0;
                const pct = Math.round((n / summary.total) * 100);
                return (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-gray-500">{s[0] + s.slice(1).toLowerCase()}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div className={`h-full rounded-full ${SEV_TONE[s]}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums text-gray-600 dark:text-gray-400">{n}</span>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">By detector</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(summary.by_detector)
                .sort((a, b) => b[1] - a[1])
                .map(([det, n]) => (
                  <span key={det} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] dark:bg-gray-800">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{DETECTOR_LABEL[det] || det}</span>
                    <span className="tabular-nums text-gray-500">{n}</span>
                  </span>
                ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Top agents</div>
            <div className="mt-2 space-y-1">
              {summary.top_agents.length === 0 ? (
                <span className="text-xs text-gray-400">No agent attribution</span>
              ) : (
                summary.top_agents.map((a) => (
                  <div key={a.agent_id} className="flex items-center justify-between gap-2 text-xs">
                    <Link href={`/agents/${encodeURIComponent(a.agent_id)}`} className="truncate font-medium text-gray-700 hover:text-gray-900 hover:underline dark:text-gray-300 dark:hover:text-white">
                      {a.agent_id}
                    </Link>
                    <span className="tabular-nums text-gray-500">{a.count}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={detector}
          onValueChange={setDetector}
          size="sm"
          ariaLabel="Filter by detector"
          className="min-w-[150px]"
          options={DETECTOR_OPTIONS}
        />
        <Select
          value={severity}
          onValueChange={setSeverity}
          size="sm"
          ariaLabel="Filter by severity"
          className="min-w-[140px]"
          options={[
            { value: "", label: "Any severity" },
            { value: "LOW", label: "Low+" },
            { value: "MEDIUM", label: "Medium+" },
            { value: "HIGH", label: "High+" },
            { value: "CRITICAL", label: "Critical" },
          ]}
        />
        <Select
          value={String(since)}
          onValueChange={(v) => setSince(Number(v))}
          size="sm"
          ariaLabel="Time range"
          className="min-w-[130px]"
          options={TIME_RANGES.map((t) => ({ value: String(t.value), label: t.label }))}
        />
        <SourceFilter value={source} onChange={setSource} />
        <ExportButton rows={incidents} filename="security-incidents" sheetName="Incidents" columns={[
          { header: "Detected", value: (d: DetectionItem) => new Date(d.detected_at).toISOString() },
          { header: "Detector", value: (d: DetectionItem) => DETECTOR_LABEL[d.detector] || d.detector },
          { header: "Category", value: (d: DetectionItem) => d.category },
          { header: "Severity", value: (d: DetectionItem) => d.severity },
          { header: "Confidence", value: (d: DetectionItem) => d.confidence },
          { header: "Description", value: (d: DetectionItem) => d.description },
          { header: "Agent", value: (d: DetectionItem) => d.agent_id || "" },
          { header: "Trace ID", value: (d: DetectionItem) => d.trace_id },
        ]} />
        <span className="ml-auto text-xs text-gray-500 tabular-nums">
          {total.toLocaleString()} incident{total === 1 ? "" : "s"}
        </span>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading incidents…</div>
        ) : incidents.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No security incidents">
            Nothing detected for this filter. Incidents appear here when the security engine flags a trace.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <tr className="[&>th]:px-5 [&>th]:py-3 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
                  <th>Severity</th>
                  <th>Detector</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Agent</th>
                  <th className="text-right">Confidence</th>
                  <th>Trace</th>
                  <th className="text-right">Detected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {incidents.map((d, i) => (
                  <tr key={`${d.trace_id}-${d.span_id}-${i}`} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40">
                    <td className="px-5 py-3.5"><SeverityBadge severity={d.severity} /></td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          {DETECTOR_LABEL[d.detector] || d.detector}
                        </span>
                        {d.is_beta === 1 && <span className="text-[10px] font-semibold uppercase text-amber-600">beta</span>}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-600 dark:text-gray-400">{d.category}</td>
                    <td className="max-w-[280px] truncate px-5 py-3.5 text-gray-700 dark:text-gray-300" title={d.description}>{d.description}</td>
                    <td className="px-5 py-3.5">
                      {d.agent_id ? (
                        <Link href={`/agents/${encodeURIComponent(d.agent_id)}`} className="font-medium text-gray-700 hover:text-gray-900 hover:underline dark:text-gray-300 dark:hover:text-white">
                          {d.agent_id}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-500">{Math.round((d.confidence || 0) * 100)}%</td>
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/traces/${d.trace_id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        {d.trace_id.slice(0, 12)}… <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-right text-[12px] text-gray-500">{new Date(d.detected_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ServerPagination total={total} limit={pageSize} offset={offset} onOffset={setOffset} onLimit={setPageSize} unit="incident" />
    </div>
  );
}
