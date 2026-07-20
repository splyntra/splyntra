// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Server, ArrowLeft, Activity, AlertCircle, AlertTriangle, ShieldAlert, Clock, Wrench, CheckCircle2 } from "lucide-react";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui/primitives";
import { SourceBadge } from "@/components/ui/SourceBadge";
import { Select } from "@/components/ui/Select";
import { SearchInput } from "@/components/ui/SearchInput";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { useSpanMetrics } from "@/lib/hooks";
import { useOrgHref } from "@/lib/org-path";

const WINDOWS = [
  { label: "All time", value: 0 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
  { label: "Last 30d", value: 2592000 },
];

function fmtMs(ms: number): string {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

export default function McpServerDashboardPage() {
  const oh = useOrgHref();
  const params = useParams<{ server: string }>();
  const server = decodeURIComponent(params.server);
  const [windowSec, setWindowSec] = useState(0);
  const since = windowSec || undefined;

  // Server-level aggregate (one row) + per-tool breakdown within this server.
  const { data: agg, isLoading, isError } = useSpanMetrics({ group: "mcp_server", server, since });
  const summary = (agg?.groups || []).find((g) => (g.key || "unknown") === server) || null;
  const { data: toolsData } = useSpanMetrics({ group: "name", type: "tool_call", server, since });
  const tools = toolsData?.groups || [];
  const flaggedTools = tools.filter((t) => (t.flagged || 0) > 0).sort((a, b) => (b.flagged || 0) - (a.flagged || 0));

  const ttc = useTableControls(tools, {
    searchText: (t) => t.key || "",
    sortAccessors: {
      tool: (t) => (t.key || "").toLowerCase(),
      calls: (t) => t.count,
      failed: (t) => t.error_count,
      flagged: (t) => t.flagged || 0,
      avg: (t) => t.avg_ms,
      p95: (t) => t.p95_ms,
    },
    initialSort: { key: "calls", dir: "desc" },
    pageSize: 10,
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link href={oh("/mcp")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> MCP Servers
      </Link>
      <PageHeader
        icon={Server}
        title={server}
        badge={<SourceBadge source="mcp" />}
        subtitle="Per-server monitoring — call volume, failures, flagged calls, and latency by tool."
        action={
          <Select value={String(windowSec)} onValueChange={(v) => setWindowSec(Number(v))} ariaLabel="Time window" className="min-w-[150px]"
            options={WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))} />
        }
      />

      {isLoading && !summary ? (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}</div>
      ) : isError ? (
        <Card className="mb-6"><EmptyState icon={AlertTriangle} title="Couldn’t load this server">The collector is unavailable — check that it’s reachable, then retry.</EmptyState></Card>
      ) : !summary ? (
        <Card className="mb-6"><EmptyState icon={Server} title="No calls to this server in the selected window">Instrument your agent with <code className="font-mono">instrument=(&quot;mcp&quot;,)</code>, or widen the time range.</EmptyState></Card>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Calls" value={summary.count.toLocaleString()} icon={Activity} />
          <StatCard label="Failed" value={summary.error_count.toLocaleString()} icon={AlertCircle} accent={summary.error_count > 0 ? "text-red-600" : undefined} />
          <StatCard label="Violations" value={(summary.flagged || 0).toLocaleString()} icon={ShieldAlert} accent={(summary.flagged || 0) > 0 ? "text-amber-600" : undefined} />
          <StatCard label="p95 Latency" value={fmtMs(summary.p95_ms)} icon={Clock} />
        </div>
      )}

      {/* Tool breakdown */}
      <Card className="mb-6 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Tools</h2>
          </div>
          {tools.length > 0 && (
            <div className="flex items-center gap-2">
              <SearchInput value={ttc.q} onChange={ttc.setQ} placeholder="Search tools…" className="max-w-[180px]" />
              <ExportButton rows={ttc.filtered} filename={`${server}-tools`} sheetName="Tools" columns={[
                { header: "Tool", value: (t) => t.key || "" },
                { header: "Calls", value: (t) => t.count },
                { header: "Failed", value: (t) => t.error_count },
                { header: "Flagged", value: (t) => t.flagged || 0 },
                { header: "Avg (ms)", value: (t) => Math.round(t.avg_ms) },
                { header: "p95 (ms)", value: (t) => Math.round(t.p95_ms) },
              ]} />
            </div>
          )}
        </div>
        {tools.length === 0 ? (
          <EmptyState icon={Wrench} title="No tool calls yet">Tool-level breakdown appears as this server handles calls.</EmptyState>
        ) : ttc.total === 0 ? (
          <EmptyState icon={Wrench} title="No tools match your search">Try a different term.</EmptyState>
        ) : (
          <>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
              <tr>
                <SortableTh label="Tool" sortKey="tool" sort={ttc.sort} onSort={ttc.toggleSort} className="px-5 py-2.5" />
                <SortableTh label="Calls" sortKey="calls" sort={ttc.sort} onSort={ttc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="Failed" sortKey="failed" sort={ttc.sort} onSort={ttc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="Flagged" sortKey="flagged" sort={ttc.sort} onSort={ttc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="Avg" sortKey="avg" sort={ttc.sort} onSort={ttc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="p95" sortKey="p95" sort={ttc.sort} onSort={ttc.toggleSort} align="right" className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {ttc.view.map((t) => (
                <tr key={t.key} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                  <td className="px-5 py-2.5 font-medium text-gray-800 dark:text-gray-200">{t.key || "—"}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{t.count.toLocaleString()}</td>
                  <td className={`px-5 py-2.5 text-right tabular-nums ${t.error_count > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}>{t.error_count}</td>
                  <td className={`px-5 py-2.5 text-right tabular-nums ${(t.flagged || 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}`}>{t.flagged || 0}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMs(t.avg_ms)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMs(t.p95_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination page={ttc.page} pageCount={ttc.pageCount} pageSize={ttc.pageSize} total={ttc.total} onPage={ttc.setPage} onPageSize={ttc.setPageSize} unit="tool" />
          </>
        )}
      </Card>

      {/* Flagged tool calls */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <ShieldAlert className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Flagged tool calls</h2>
        </div>
        {flaggedTools.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No flagged calls">No security detections on this server’s tools.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {flaggedTools.map((t) => (
              <li key={t.key} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="font-medium text-gray-800 dark:text-gray-200">{t.key || "—"}</span>
                <span className="text-amber-600 dark:text-amber-400">{t.flagged} flagged / {t.count.toLocaleString()} calls</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
