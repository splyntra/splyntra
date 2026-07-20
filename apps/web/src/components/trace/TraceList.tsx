// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState, ReactNode } from "react";
import { TraceListItem } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Inbox, ChevronRight } from "lucide-react";
import { Card, EmptyState, StatusPill, RiskBadge, severityFromScore } from "@/components/ui/primitives";
import { SourceBadge, sourceOf } from "@/components/ui/SourceBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { useTableControls, SortableTh, TablePagination, SortState } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { ExportColumn } from "@/lib/export";
import { useOrgHref } from "@/lib/org-path";

// Trace export columns, shared by TraceList's toolbar and the fleet Traces page.
export const TRACE_EXPORT_COLUMNS: ExportColumn<TraceListItem>[] = [
  { header: "Trace ID", value: (t) => t.trace_id },
  { header: "Source", value: (t) => (t.platform ? "platform" : "agent") },
  { header: "Agent / Workflow", value: (t) => (t.platform ? t.workflow_name || t.agent_id : t.agent_id) },
  { header: "Platform", value: (t) => t.platform || "" },
  { header: "Status", value: (t) => t.status },
  { header: "Latency (ms)", value: (t) => t.latency_ms },
  { header: "Tokens", value: (t) => t.total_tokens },
  { header: "Cost (USD)", value: (t) => t.cost_usd },
  { header: "Risk", value: (t) => t.risk_score },
  { header: "Severity", value: (t) => t.risk_severity },
  { header: "Started", value: (t) => new Date(t.started_at).toISOString() },
];

interface TraceListProps {
  traces: TraceListItem[];
  /** Show a per-row Agent/Platform source badge (fleet + platform views). */
  showSource?: boolean;
  /** Enable the in-table toolbar: search + status filter + sortable columns + pagination. */
  controls?: boolean;
  pageSize?: number;
  /** Message shown when there are no traces at all (context-specific). */
  emptyTitle?: string;
  emptyChildren?: ReactNode;
}

export function TraceList({ traces, showSource = false, controls = false, pageSize = 12, emptyTitle, emptyChildren }: TraceListProps) {
  const oh = useOrgHref();
  const router = useRouter();
  const [status, setStatus] = useState("");

  const statusFiltered = useMemo(
    () => (status ? traces.filter((t) => t.status === status) : traces),
    [traces, status]
  );
  const tc = useTableControls(statusFiltered, {
    searchText: (t) => `${t.trace_id} ${t.agent_id} ${t.workflow_name || ""}`,
    sortAccessors: {
      agent: (t) => (t.platform ? t.workflow_name || t.agent_id : t.agent_id).toLowerCase(),
      status: (t) => t.status,
      latency: (t) => t.latency_ms,
      tokens: (t) => t.total_tokens,
      cost: (t) => t.cost_usd,
      risk: (t) => t.risk_score,
      time: (t) => new Date(t.started_at).getTime() || 0,
    },
    initialSort: { key: "time", dir: "desc" },
    pageSize,
  });

  // Empty when there are genuinely no traces (not merely filtered out).
  if (traces.length === 0) {
    return (
      <Card>
        <EmptyState icon={Inbox} title={emptyTitle || "No traces yet"}>
          {emptyChildren || (
            <>
              Run an instrumented agent to see traces appear here.
              <pre className="mt-3 inline-block rounded-lg bg-gray-100 p-3 text-left text-xs dark:bg-gray-800">
                {`pip install splyntra\npython examples/quickstart.py`}
              </pre>
            </>
          )}
        </EmptyState>
      </Card>
    );
  }

  const rows = controls ? tc.view : traces;
  const noMatch = controls && tc.total === 0;

  return (
    <Card className="overflow-hidden">
      {controls && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <SearchInput value={tc.q} onChange={tc.setQ} placeholder="Search by trace, agent, or workflow…" className="max-w-xs" />
          <div className="flex items-center gap-2">
            <Select
              value={status}
              onValueChange={setStatus}
              size="sm"
              ariaLabel="Filter by status"
              className="min-w-[120px]"
              options={[
                { value: "", label: "All statuses" },
                { value: "ok", label: "OK" },
                { value: "error", label: "Error" },
              ]}
            />
            <ExportButton rows={tc.filtered} columns={TRACE_EXPORT_COLUMNS} filename="traces" sheetName="Traces" />
          </div>
        </div>
      )}
      {noMatch ? (
        <EmptyState icon={Inbox} title="No traces match your filters">Try a different search term or status.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/80 text-left dark:border-gray-800 dark:bg-gray-900/50">
              <tr>
                <HeadCell label="Trace" sortKey="trace" controls={false} sort={tc.sort} onSort={tc.toggleSort} />
                {showSource && <HeadCell label="Source" sortKey="source" controls={false} sort={tc.sort} onSort={tc.toggleSort} />}
                <HeadCell label="Agent" sortKey="agent" controls={controls} sort={tc.sort} onSort={tc.toggleSort} />
                <HeadCell label="Status" sortKey="status" controls={controls} sort={tc.sort} onSort={tc.toggleSort} />
                <HeadCell label="Latency" sortKey="latency" controls={controls} sort={tc.sort} onSort={tc.toggleSort} align="right" />
                <HeadCell label="Tokens" sortKey="tokens" controls={controls} sort={tc.sort} onSort={tc.toggleSort} align="right" />
                <HeadCell label="Cost" sortKey="cost" controls={controls} sort={tc.sort} onSort={tc.toggleSort} align="right" />
                <HeadCell label="Risk" sortKey="risk" controls={controls} sort={tc.sort} onSort={tc.toggleSort} align="right" />
                <HeadCell label="Time" sortKey="time" controls={controls} sort={tc.sort} onSort={tc.toggleSort} align="right" />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((trace) => (
                <tr
                  key={trace.trace_id}
                  onClick={() => router.push(oh(`/traces/${trace.trace_id}`))}
                  className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{trace.trace_id.slice(0, 12)}…</td>
                  {showSource && (
                    <td className="px-4 py-3"><SourceBadge source={sourceOf(trace.platform)} /></td>
                  )}
                  <td className="px-4 py-3 font-medium">{trace.platform ? trace.workflow_name || trace.agent_id : trace.agent_id}</td>
                  <td className="px-4 py-3"><StatusPill status={trace.status} /></td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{trace.latency_ms}ms</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{trace.total_tokens.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">${trace.cost_usd.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right">
                    <RiskBadge score={trace.risk_score} severity={trace.risk_severity || severityFromScore(trace.risk_score)} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">{new Date(trace.started_at).toLocaleTimeString()}</td>
                  <td className="px-2 text-gray-300 dark:text-gray-600">
                    <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {controls && <TablePagination page={tc.page} pageCount={tc.pageCount} pageSize={tc.pageSize} total={tc.total} onPage={tc.setPage} onPageSize={tc.setPageSize} unit="trace" />}
        </>
      )}
    </Card>
  );
}

// A header cell that is sortable (clickable) only when the table has controls and
// the column has a sort accessor; otherwise a plain label. Keeps one consistent
// header style across both the fleet (plain) and per-agent (sortable) tables.
function HeadCell({
  label,
  sortKey,
  controls,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: string;
  controls: boolean;
  sort: SortState | null;
  onSort: (key: string) => void;
  align?: "left" | "right";
}) {
  if (controls) return <SortableTh label={label} sortKey={sortKey} sort={sort} onSort={onSort} align={align} />;
  return (
    <th className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 ${align === "right" ? "text-right" : "text-left"}`}>
      {label}
    </th>
  );
}
