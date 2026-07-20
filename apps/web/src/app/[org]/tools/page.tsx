// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import Link from "next/link";
import { Wrench, Database, Server, Activity, AlertTriangle, ShieldAlert, ArrowUpRight } from "lucide-react";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui/primitives";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { SourceFilter } from "@/components/ui/SourceFilter";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { useSpanMetrics } from "@/lib/hooks";
import { SpanMetricGroup, SourceScope } from "@/lib/api";
import { useOrgHref } from "@/lib/org-path";

const WINDOWS = [
  { label: "All time", value: 0 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
  { label: "Last 30d", value: 2592000 },
];

function MetricTable({ title, icon: Icon, rows, keyLabel, loading, error }: { title: string; icon: typeof Wrench; rows: SpanMetricGroup[]; keyLabel: string; loading: boolean; error?: boolean }) {
  const tc = useTableControls(rows, {
    searchText: (r) => r.key || "unknown",
    sortAccessors: {
      key: (r) => (r.key || "unknown").toLowerCase(),
      calls: (r) => r.count,
      failed: (r) => r.error_count,
      flagged: (r) => r.flagged || 0,
      avg: (r) => r.avg_ms,
      p95: (r) => r.p95_ms,
    },
    initialSort: { key: "calls", dir: "desc" },
    pageSize: 8,
  });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2">
            <SearchInput value={tc.q} onChange={tc.setQ} placeholder={`Search ${title.toLowerCase()}…`} className="max-w-[200px]" />
            <ExportButton rows={tc.filtered} columns={[
              { header: keyLabel, value: (r: SpanMetricGroup) => r.key || "unknown" },
              { header: "Calls", value: (r: SpanMetricGroup) => r.count },
              { header: "Failed", value: (r: SpanMetricGroup) => r.error_count },
              { header: "Flagged", value: (r: SpanMetricGroup) => r.flagged || 0 },
              { header: "Avg (ms)", value: (r: SpanMetricGroup) => Math.round(r.avg_ms) },
              { header: "p95 (ms)", value: (r: SpanMetricGroup) => Math.round(r.p95_ms) },
            ]} filename={title.toLowerCase().replace(/[^a-z0-9]+/g, "-")} sheetName={title.slice(0, 31)} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-32 animate-pulse bg-gray-50 dark:bg-gray-900/40" />
      ) : error ? (
        <EmptyState icon={AlertTriangle} title={`Couldn’t load ${title.toLowerCase()}`}>The collector is unavailable — check that it’s reachable, then retry.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={Icon} title={`No ${title.toLowerCase()} yet`}>Instrument your agent to see these calls with latency, failures, and flagged (risky) calls.</EmptyState>
      ) : tc.total === 0 ? (
        <EmptyState icon={Icon} title="No matches">Try a different search term.</EmptyState>
      ) : (
        <>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
            <tr>
              <SortableTh label={keyLabel} sortKey="key" sort={tc.sort} onSort={tc.toggleSort} className="px-5 py-2.5" />
              <SortableTh label="Calls" sortKey="calls" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Failed" sortKey="failed" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Flagged" sortKey="flagged" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Avg" sortKey="avg" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="p95" sortKey="p95" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {tc.view.map((r) => (
              <tr key={r.key || "unknown"} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                <td className="px-5 py-2.5 font-medium text-gray-900 dark:text-white">{r.key || "unknown"}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.count.toLocaleString()}</td>
                <td className={`px-5 py-2.5 text-right tabular-nums ${r.error_count > 0 ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>{r.error_count}</td>
                <td className={`px-5 py-2.5 text-right tabular-nums ${(r.flagged || 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-500"}`}>{r.flagged || 0}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">{Math.round(r.avg_ms)}ms</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">{Math.round(r.p95_ms)}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <TablePagination page={tc.page} pageCount={tc.pageCount} pageSize={tc.pageSize} total={tc.total} onPage={tc.setPage} onPageSize={tc.setPageSize} unit="row" />
        </>
      )}
    </Card>
  );
}

export default function ToolsPage() {
  const oh = useOrgHref();
  // Defaults to the Agents domain so agent tooling isn't blended with platform
  // workflow-node calls (platforms have their own node analytics). Switchable.
  const [windowSec, setWindowSec] = useState(0);
  const [source, setSource] = useState<"" | SourceScope>("agent");
  const since = windowSec || undefined;
  const src = source || undefined;

  const tools = useSpanMetrics({ type: "tool_call", group: "name", since, source: src });
  const retrieval = useSpanMetrics({ type: "retrieval", group: "name", since, source: src });
  const vector = useSpanMetrics({ type: "vector_search", group: "name", since, source: src });

  const toolRows = tools.data?.groups || [];
  const retrievalRows = [...(retrieval.data?.groups || []), ...(vector.data?.groups || [])];
  const loading = tools.isLoading || retrieval.isLoading || vector.isLoading;

  // Fleet summary across all tool + retrieval operations.
  const all = [...toolRows, ...retrievalRows];
  const totalCalls = all.reduce((s, r) => s + r.count, 0);
  const totalFailed = all.reduce((s, r) => s + r.error_count, 0);
  const totalFlagged = all.reduce((s, r) => s + (r.flagged || 0), 0);
  const failRate = totalCalls > 0 ? (totalFailed / totalCalls) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        icon={Wrench}
        title="Tools & Retrieval"
        subtitle="Tool calls, RAG retrieval, and vector search across your fleet — latency, failures, and flagged (risky) calls."
        action={
          <div className="flex items-center gap-2">
            <SourceFilter value={source} onChange={setSource} size="md" />
            <Select value={String(windowSec)} onValueChange={(v) => setWindowSec(Number(v))} ariaLabel="Time window" className="min-w-[150px]"
              options={WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))} />
          </div>
        }
      />

      {/* Fleet KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Tool calls" value={loading ? "—" : totalCalls.toLocaleString()} icon={Activity} />
        <StatCard label="Failure rate" value={loading ? "—" : `${failRate.toFixed(1)}%`} icon={AlertTriangle} accent={failRate >= 5 ? "text-red-600 dark:text-red-400" : undefined} />
        <StatCard label="Flagged" value={loading ? "—" : totalFlagged.toLocaleString()} icon={ShieldAlert} accent={totalFlagged > 0 ? "text-amber-600 dark:text-amber-400" : undefined} />
        <StatCard label="Distinct operations" value={loading ? "—" : all.length.toLocaleString()} icon={Wrench} />
      </div>

      <div className="space-y-6">
        <MetricTable title="Tools" icon={Wrench} rows={toolRows} keyLabel="Tool" loading={tools.isLoading} error={tools.isError} />
        <MetricTable title="Retrieval & Vector search" icon={Database} rows={retrievalRows} keyLabel="Operation" loading={retrieval.isLoading || vector.isLoading} error={retrieval.isError || vector.isError} />

        {/* MCP has its own domain now — point there instead of duplicating the table. */}
        <Link href={oh("/mcp")} className="group flex items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white px-5 py-4 shadow-card outline-none transition-all hover:border-splyntra-300 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"><Server className="h-4 w-4" /></span>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">MCP Servers</div>
              <div className="text-[12px] text-gray-500">Per-server calls, failures, flagged calls, and tool latency live in their own section.</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-splyntra-600 group-hover:underline dark:text-splyntra-300">Open MCP Servers <ArrowUpRight className="h-3.5 w-3.5" /></span>
        </Link>
      </div>
    </div>
  );
}
