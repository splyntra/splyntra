// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
// Per-platform orchestration activity for the Agent Platforms home. Reads the
// platform-scoped /v1/platforms endpoint (NOT the agent registry) so it shows
// only real platform runs — one row per platform, linking into its Workflow
// Operations dashboard.
import { useRouter } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { CatalogIcon } from "@/lib/catalog-icons";
import { usePlatforms, platformMeta, connectablePlatforms, successRate } from "@/lib/platforms";
import { Workflow, ChevronRight, AlertTriangle } from "lucide-react";
import { useOrgHref } from "@/lib/org-path";

function fmtMs(ms: number): string {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

export function PlatformActivity() {
  const oh = useOrgHref();
  const router = useRouter();
  const { data, isLoading, isError } = usePlatforms();
  const rows = data?.platforms || [];
  const connectable = connectablePlatforms();

  const tc = useTableControls(rows, {
    searchText: (r) => `${r.platform} ${platformMeta(r.platform).name}`,
    sortAccessors: {
      platform: (r) => platformMeta(r.platform).name.toLowerCase(),
      workflows: (r) => r.workflow_count,
      runs: (r) => r.run_count,
      success: (r) => successRate(r.run_count, r.error_count),
      runtime: (r) => r.avg_latency_ms,
      cost: (r) => r.total_cost,
      last: (r) => new Date(r.last_seen_at).getTime() || 0,
    },
    initialSort: { key: "runs", dir: "desc" },
    pageSize: 10,
  });

  return (
    <Card className="mb-8 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Platform activity</h2>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2">
            <SearchInput value={tc.q} onChange={tc.setQ} placeholder="Search platforms…" className="max-w-[200px]" />
            <ExportButton rows={tc.filtered} filename="platforms" sheetName="Platforms" columns={[
              { header: "Platform", value: (r) => platformMeta(r.platform).name },
              { header: "Workflows", value: (r) => r.workflow_count },
              { header: "Runs", value: (r) => r.run_count },
              { header: "Success %", value: (r) => successRate(r.run_count, r.error_count) },
              { header: "Avg Runtime (ms)", value: (r) => Math.round(r.avg_latency_ms) },
              { header: "Cost (USD)", value: (r) => r.total_cost },
              { header: "Last Activity", value: (r) => (r.last_seen_at ? new Date(r.last_seen_at).toISOString() : "") },
            ]} />
          </div>
        )}
      </div>
      {isLoading ? (
        <div className="h-32 animate-pulse bg-gray-50 dark:bg-gray-900/40" />
      ) : isError ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t load platform activity">
          The collector is unavailable — check that it’s reachable, then retry.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={Workflow} title="No platform activity yet">
          Connect a platform below — its workflow runs will appear here, separate from your agents.
        </EmptyState>
      ) : tc.total === 0 ? (
        <EmptyState icon={Workflow} title="No platforms match your search">Try a different term.</EmptyState>
      ) : (
        <>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
            <tr>
              <SortableTh label="Platform" sortKey="platform" sort={tc.sort} onSort={tc.toggleSort} className="px-5 py-2.5" />
              <SortableTh label="Workflows" sortKey="workflows" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Runs" sortKey="runs" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Success" sortKey="success" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Avg runtime" sortKey="runtime" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Cost" sortKey="cost" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <SortableTh label="Last activity" sortKey="last" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {tc.view.map((r) => {
              const meta = platformMeta(r.platform);
              const sr = successRate(r.run_count, r.error_count);
              const known = connectable.some((p) => p.id === r.platform);
              return (
                <tr
                  key={r.platform}
                  onClick={() => router.push(oh(`/platforms/${encodeURIComponent(r.platform)}`))}
                  className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/40"
                >
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2 font-medium text-gray-900 group-hover:text-splyntra-700 dark:text-white dark:group-hover:text-splyntra-300">
                      <CatalogIcon name={meta.icon} className="h-4 w-4 text-gray-400" /> {meta.name}
                      {!known && <Badge tone="muted">custom</Badge>}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.workflow_count}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.run_count.toLocaleString()}</td>
                  <td className={`px-5 py-3 text-right tabular-nums ${sr < 90 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{sr}%</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMs(r.avg_latency_ms)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">${r.total_cost.toFixed(2)}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-500">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "—"}</td>
                  <td className="px-3 py-3 text-right">
                    <span className="inline-flex text-gray-300 group-hover:text-splyntra-500"><ChevronRight className="h-4 w-4" /></span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <TablePagination page={tc.page} pageCount={tc.pageCount} pageSize={tc.pageSize} total={tc.total} onPage={tc.setPage} onPageSize={tc.setPageSize} unit="platform" />
        </>
      )}
    </Card>
  );
}
