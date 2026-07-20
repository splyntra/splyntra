// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
// Per-MCP-server monitoring (latency / failed calls / flagged calls).
// Wired to /v1/metrics/spans (grouped by mcp.server.name) in W8; until data
// exists it shows an empty state.
import { useRouter } from "next/navigation";
import { Server, ChevronRight, AlertTriangle } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/primitives";
import { SearchInput } from "@/components/ui/SearchInput";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { useSpanMetrics } from "@/lib/hooks";
import { useOrgHref } from "@/lib/org-path";

export function McpServerMetrics() {
  const oh = useOrgHref();
  const router = useRouter();
  const { data, isLoading, isError } = useSpanMetrics({ group: "mcp_server" });
  const rows = data?.groups || [];

  const tc = useTableControls(rows, {
    searchText: (r) => r.key || "unknown",
    sortAccessors: {
      server: (r) => (r.key || "unknown").toLowerCase(),
      calls: (r) => r.count,
      failed: (r) => r.error_count,
      flagged: (r) => r.flagged || 0,
      p95: (r) => r.p95_ms,
    },
    initialSort: { key: "calls", dir: "desc" },
    pageSize: 10,
  });

  if (isLoading) return <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;
  if (isError) {
    return (
      <Card>
        <EmptyState icon={AlertTriangle} title="Couldn’t load MCP activity">
          The collector is unavailable — check that it’s reachable, then retry.
        </EmptyState>
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={Server} title="No MCP activity yet">
          Instrument your agent with <code className="font-mono">instrument=(&quot;mcp&quot;,)</code>; each server’s latency,
          failed calls, and flagged (permission-violation) calls appear here.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Servers</h2>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={tc.q} onChange={tc.setQ} placeholder="Search servers…" className="max-w-[200px]" />
          <ExportButton rows={tc.filtered} filename="mcp-servers" sheetName="MCP Servers" columns={[
            { header: "Server", value: (r) => r.key || "unknown" },
            { header: "Calls", value: (r) => r.count },
            { header: "Failed", value: (r) => r.error_count },
            { header: "Flagged", value: (r) => r.flagged || 0 },
            { header: "p95 (ms)", value: (r) => Math.round(r.p95_ms) },
          ]} />
        </div>
      </div>
      {tc.total === 0 ? (
        <EmptyState icon={Server} title="No servers match your search">Try a different term.</EmptyState>
      ) : (
      <>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
          <tr>
            <SortableTh label="MCP Server" sortKey="server" sort={tc.sort} onSort={tc.toggleSort} className="px-5 py-3" />
            <SortableTh label="Calls" sortKey="calls" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-3" />
            <SortableTh label="Failed" sortKey="failed" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-3" />
            <SortableTh label="Flagged" sortKey="flagged" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-3" />
            <SortableTh label="p95" sortKey="p95" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-3" />
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {tc.view.map((r) => {
            const server = r.key || "unknown";
            return (
              <tr key={r.key} onClick={() => router.push(oh(`/mcp/${encodeURIComponent(server)}`))} className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/40">
                <td className="px-5 py-3">
                  <span className="font-medium text-gray-900 group-hover:text-splyntra-700 dark:text-white dark:group-hover:text-splyntra-300">{server}</span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.count.toLocaleString()}</td>
                <td className={`px-5 py-3 text-right tabular-nums ${r.error_count > 0 ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>{r.error_count}</td>
                <td className={`px-5 py-3 text-right tabular-nums ${(r.flagged || 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-500"}`}>{r.flagged || 0}</td>
                <td className="px-5 py-3 text-right tabular-nums text-gray-500">{Math.round(r.p95_ms)}ms</td>
                <td className="px-3 py-3 text-right"><span className="inline-flex text-gray-300 group-hover:text-splyntra-500"><ChevronRight className="h-4 w-4" /></span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TablePagination page={tc.page} pageCount={tc.pageCount} pageSize={tc.pageSize} total={tc.total} onPage={tc.setPage} onPageSize={tc.setPageSize} unit="server" />
      </>
      )}
    </Card>
  );
}
