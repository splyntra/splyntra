// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import {
  Workflow, ArrowLeft, Activity, CheckCircle2, Clock, AlertTriangle, DollarSign, Coins, Boxes, ChevronRight, GitBranch,
} from "lucide-react";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { SourceBadge } from "@/components/ui/SourceBadge";
import { Select } from "@/components/ui/Select";
import { SearchInput } from "@/components/ui/SearchInput";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { CatalogIcon } from "@/lib/catalog-icons";
import { usePlatform, platformMeta, successRate } from "@/lib/platforms";
import { useSpanMetrics, useMetrics } from "@/lib/hooks";
import { WorkflowItem } from "@/lib/api";
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

export default function PlatformDashboardPage() {
  const oh = useOrgHref();
  const params = useParams<{ platform: string }>();
  const router = useRouter();
  const platform = decodeURIComponent(params.platform);
  const meta = platformMeta(platform);
  const [windowSec, setWindowSec] = useState(0);

  const { data, isLoading, isError } = usePlatform(platform, windowSec || undefined);
  // Treat an unknown platform (present but all-zero) the same as "no data".
  const rawOverview = data?.overview || null;
  const overview = rawOverview && rawOverview.run_count === 0 ? null : rawOverview;
  const workflows = data?.workflows || [];

  // Node analytics: spans within this platform's runs, grouped by node/span name.
  const { data: spanData } = useSpanMetrics({ platform, group: "name", since: windowSec || undefined });
  const nodes = spanData?.groups || [];
  const failing = nodes.filter((n) => n.error_count > 0).sort((a, b) => b.error_count - a.error_count);

  // Throughput timeline (runs over time), platform-scoped.
  const { data: metricsData } = useMetrics({ platform, windowSec: windowSec || 604800, intervalSec: 3600 });
  const points = (metricsData?.points || []).map((p) => ({
    t: new Date(p.bucket).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }),
    runs: p.trace_count,
    errors: p.error_count,
  }));

  const sr = overview ? successRate(overview.run_count, overview.error_count) : 0;
  const versions = Array.from(new Set(workflows.map((w) => w.version).filter(Boolean)));

  const wtc = useTableControls(workflows, {
    searchText: (w) => `${w.workflow_name || ""} ${w.workflow_id}`,
    sortAccessors: {
      workflow: (w) => (w.workflow_name || w.workflow_id).toLowerCase(),
      runs: (w) => w.run_count,
      success: (w) => successRate(w.run_count, w.error_count),
      runtime: (w) => w.avg_latency_ms,
      tokens: (w) => w.total_tokens,
      cost: (w) => w.total_cost,
    },
    initialSort: { key: "runs", dir: "desc" },
    pageSize: 10,
  });
  const ntc = useTableControls(nodes, {
    searchText: (n) => n.key || "",
    sortAccessors: {
      node: (n) => (n.key || "").toLowerCase(),
      calls: (n) => n.count,
      failures: (n) => n.error_count,
      avg: (n) => n.avg_ms,
      p95: (n) => n.p95_ms,
    },
    initialSort: { key: "calls", dir: "desc" },
    pageSize: 10,
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href={oh("/platforms")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Agent Platforms
      </Link>
      <PageHeader
        icon={Workflow}
        title={meta.name}
        badge={<SourceBadge source="platform" />}
        subtitle="Workflow operations — runs, node performance, and failures for this orchestration platform."
        action={
          <Select value={String(windowSec)} onValueChange={(v) => setWindowSec(Number(v))} ariaLabel="Time window" className="min-w-[150px]"
            options={WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))} />
        }
      />

      {/* Overview KPIs */}
      {isLoading && !overview ? (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}</div>
      ) : isError ? (
        <Card className="mb-6"><EmptyState icon={AlertTriangle} title="Couldn’t load this platform">The collector is unavailable — check that it’s reachable, then retry.</EmptyState></Card>
      ) : !overview ? (
        <Card className="mb-6"><EmptyState icon={Workflow} title="No runs for this platform in the selected window">Connect it from the <Link href={oh("/platforms/connect")} className="text-splyntra-600 hover:underline">connect wizard</Link>, or widen the time range.</EmptyState></Card>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard label="Total Runs" value={overview.run_count.toLocaleString()} icon={Activity} />
          <StatCard label="Success Rate" value={`${sr}%`} icon={CheckCircle2} accent={sr < 90 ? "text-amber-600" : "text-emerald-600"} />
          <StatCard label="Avg Runtime" value={fmtMs(overview.avg_latency_ms)} icon={Clock} />
          <StatCard label="Failed Runs" value={overview.error_count.toLocaleString()} icon={AlertTriangle} accent={overview.error_count > 0 ? "text-red-600" : undefined} />
          <StatCard label="Cost" value={`$${overview.total_cost.toFixed(2)}`} icon={DollarSign} />
        </div>
      )}

      {/* Throughput timeline */}
      {points.length > 1 && (
        <Card className="mb-6 p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Run throughput</h2>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points}>
                <defs>
                  <linearGradient id="runsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fontSize: 10 }} stroke="#9ca3af" minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" allowDecimals={false} width={28} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Area type="monotone" dataKey="runs" stroke="#f59e0b" strokeWidth={2} fill="url(#runsGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Workflow list */}
      <SectionCard
        title="Workflows"
        icon={Boxes}
        action={workflows.length > 0 ? (
          <div className="flex items-center gap-2">
            <SearchInput value={wtc.q} onChange={wtc.setQ} placeholder="Search workflows…" className="max-w-[200px]" />
            <ExportButton rows={wtc.filtered} filename={`${platform}-workflows`} sheetName="Workflows" columns={[
              { header: "Workflow", value: (w: WorkflowItem) => w.workflow_name || w.workflow_id },
              { header: "Version", value: (w: WorkflowItem) => w.version || "" },
              { header: "Runs", value: (w: WorkflowItem) => w.run_count },
              { header: "Success %", value: (w: WorkflowItem) => successRate(w.run_count, w.error_count) },
              { header: "Avg Runtime (ms)", value: (w: WorkflowItem) => Math.round(w.avg_latency_ms) },
              { header: "Tokens", value: (w: WorkflowItem) => w.total_tokens },
              { header: "Cost (USD)", value: (w: WorkflowItem) => w.total_cost },
            ]} />
          </div>
        ) : undefined}
      >
        {workflows.length === 0 ? (
          <EmptyState icon={Boxes} title="No workflows yet">Runs will group by workflow as they arrive.</EmptyState>
        ) : wtc.total === 0 ? (
          <EmptyState icon={Boxes} title="No workflows match your search">Try a different term.</EmptyState>
        ) : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
              <tr>
                <SortableTh label="Workflow" sortKey="workflow" sort={wtc.sort} onSort={wtc.toggleSort} className="px-5 py-2.5" />
                <SortableTh label="Runs" sortKey="runs" sort={wtc.sort} onSort={wtc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="Success" sortKey="success" sort={wtc.sort} onSort={wtc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="Avg runtime" sortKey="runtime" sort={wtc.sort} onSort={wtc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="Tokens" sortKey="tokens" sort={wtc.sort} onSort={wtc.toggleSort} align="right" className="px-5 py-2.5" />
                <SortableTh label="Cost" sortKey="cost" sort={wtc.sort} onSort={wtc.toggleSort} align="right" className="px-5 py-2.5" />
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {wtc.view.map((wf: WorkflowItem) => {
                const wsr = successRate(wf.run_count, wf.error_count);
                const href = `/platforms/${encodeURIComponent(platform)}/workflows/${encodeURIComponent(wf.workflow_id)}`;
                return (
                  <tr key={wf.workflow_id} onClick={() => router.push(oh(href))} className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/40">
                    <td className="px-5 py-3">
                      <span className="font-medium text-gray-900 group-hover:text-splyntra-700 dark:text-white dark:group-hover:text-splyntra-300">
                        {wf.workflow_name || wf.workflow_id}
                      </span>
                      {wf.version && <span className="ml-2"><Badge tone="neutral">v{wf.version}</Badge></span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{wf.run_count.toLocaleString()}</td>
                    <td className={`px-5 py-3 text-right tabular-nums ${wsr < 90 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{wsr}%</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMs(wf.avg_latency_ms)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{wf.total_tokens.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">${wf.total_cost.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right"><span className="inline-flex text-gray-300 group-hover:text-splyntra-500"><ChevronRight className="h-4 w-4" /></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <TablePagination page={wtc.page} pageCount={wtc.pageCount} pageSize={wtc.pageSize} total={wtc.total} onPage={wtc.setPage} onPageSize={wtc.setPageSize} unit="workflow" />
          </>
        )}
      </SectionCard>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Node analytics */}
        <SectionCard
          title="Node analytics"
          icon={Activity}
          action={nodes.length > 0 ? (
            <div className="flex items-center gap-2">
              <SearchInput value={ntc.q} onChange={ntc.setQ} placeholder="Search nodes…" className="max-w-[160px]" />
              <ExportButton rows={ntc.filtered} filename={`${platform}-nodes`} sheetName="Nodes" columns={[
                { header: "Node", value: (n) => n.key || "" },
                { header: "Calls", value: (n) => n.count },
                { header: "Failures", value: (n) => n.error_count },
                { header: "Avg (ms)", value: (n) => Math.round(n.avg_ms) },
                { header: "p95 (ms)", value: (n) => Math.round(n.p95_ms) },
              ]} />
            </div>
          ) : undefined}
        >
          {nodes.length === 0 ? (
            <EmptyState icon={Activity} title="No node data">Per-node timing appears when runs include a node breakdown.</EmptyState>
          ) : ntc.total === 0 ? (
            <EmptyState icon={Activity} title="No nodes match your search">Try a different term.</EmptyState>
          ) : (
            <>
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <tr>
                  <SortableTh label="Node" sortKey="node" sort={ntc.sort} onSort={ntc.toggleSort} className="px-5 py-2" />
                  <SortableTh label="Calls" sortKey="calls" sort={ntc.sort} onSort={ntc.toggleSort} align="right" className="px-5 py-2" />
                  <SortableTh label="Failures" sortKey="failures" sort={ntc.sort} onSort={ntc.toggleSort} align="right" className="px-5 py-2" />
                  <SortableTh label="Avg" sortKey="avg" sort={ntc.sort} onSort={ntc.toggleSort} align="right" className="px-5 py-2" />
                  <SortableTh label="p95" sortKey="p95" sort={ntc.sort} onSort={ntc.toggleSort} align="right" className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {ntc.view.map((n) => (
                  <tr key={n.key} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                    <td className="px-5 py-2 font-medium text-gray-800 dark:text-gray-200">{n.key || "—"}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{n.count.toLocaleString()}</td>
                    <td className={`px-5 py-2 text-right tabular-nums ${n.error_count > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}>{n.error_count}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMs(n.avg_ms)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtMs(n.p95_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination page={ntc.page} pageCount={ntc.pageCount} pageSize={ntc.pageSize} total={ntc.total} onPage={ntc.setPage} onPageSize={ntc.setPageSize} unit="node" />
            </>
          )}
        </SectionCard>

        {/* Failure analysis */}
        <SectionCard title="Failure analysis" icon={AlertTriangle}>
          {failing.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No failing nodes">Every node in the selected window succeeded.</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {failing.slice(0, 12).map((n) => {
                const rate = n.count > 0 ? Math.round((n.error_count / n.count) * 100) : 0;
                return (
                  <li key={n.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate font-medium text-gray-800 dark:text-gray-200">{n.key || "—"}</span>
                    <span className="flex shrink-0 items-center gap-3 text-xs">
                      <span className="text-red-600 dark:text-red-400">{n.error_count} failed</span>
                      <span className="w-24"><span className="block h-1.5 rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-1.5 rounded-full bg-red-500" style={{ width: `${rate}%` }} /></span></span>
                      <span className="w-9 text-right tabular-nums text-gray-500">{rate}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Versions */}
      {versions.length > 0 && (
        <Card className="mt-6 p-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white"><GitBranch className="h-4 w-4 text-gray-400" /> Workflow versions</h2>
          <div className="flex flex-wrap gap-1.5">{versions.map((v) => <Badge key={v} tone="neutral">v{v}</Badge>)}</div>
        </Card>
      )}
    </div>
  );
}

function SectionCard({ title, icon: Icon, action, children }: { title: string; icon: typeof Activity; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}
