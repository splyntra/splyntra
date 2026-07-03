// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSecurityIncidents } from "@/lib/hooks";
import { DetectionItem, SourceScope } from "@/lib/api";
import { ShieldAlert, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { PageHeader, Card, EmptyState, SeverityBadge } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { SourceFilter } from "@/components/ui/SourceFilter";

const PAGE = 25;
const TIME_RANGES = [
  { label: "All time", value: 0 },
  { label: "Last hour", value: 3600 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
];
const DETECTOR_LABEL: Record<string, string> = { pii: "PII", secrets: "Secret", injection: "Injection" };


export default function SecurityPage() {
  const [detector, setDetector] = useState("");
  const [severity, setSeverity] = useState("");
  const [since, setSince] = useState(0);
  const [source, setSource] = useState<"" | SourceScope>("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(0);
  }, [detector, severity, since, source]);

  const opts = useMemo(
    () => ({ limit: PAGE, offset, detector: detector || undefined, severity: severity || undefined, since: since || undefined, source: source || undefined }),
    [offset, detector, severity, since, source]
  );
  const { data, isLoading, error } = useSecurityIncidents(opts);
  const incidents: DetectionItem[] = data?.incidents || [];
  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE, total);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        icon={ShieldAlert}
        title="Security"
        subtitle="Detected incidents across your agents — prompt injection, secret exposure, and PII leakage."
      />
      {error && !isLoading && (
        <p className="mb-4 text-xs text-red-500">Could not reach the collector. Check that the stack is running.</p>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={detector}
          onValueChange={setDetector}
          size="sm"
          ariaLabel="Filter by detector"
          className="min-w-[150px]"
          options={[
            { value: "", label: "All detectors" },
            { value: "pii", label: "PII" },
            { value: "secrets", label: "Secrets" },
            { value: "injection", label: "Prompt injection" },
          ]}
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
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <tr className="[&>th]:px-5 [&>th]:py-3 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
                  <th>Severity</th>
                  <th>Detector</th>
                  <th>Category</th>
                  <th>Description</th>
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
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-500">{Math.round((d.confidence || 0) * 100)}%</td>
                    <td className="px-5 py-3.5">
                      <a
                        href={`/traces/${d.trace_id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        {d.trace_id.slice(0, 12)}… <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="px-5 py-3.5 text-right text-[12px] text-gray-500">{new Date(d.detected_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {total > 0 && (offset > 0 || pageEnd < total) && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500 tabular-nums">
            Showing {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button disabled={pageEnd >= total} onClick={() => setOffset(offset + PAGE)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
