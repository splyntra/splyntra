// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTraces } from "@/lib/hooks";
import { TraceList } from "@/components/trace/TraceList";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { SourceFilter } from "@/components/ui/SourceFilter";
import { SourceScope } from "@/lib/api";
import { Activity, X, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE = 25;
const TIME_RANGES = [
  { label: "All time", value: 0 },
  { label: "Last hour", value: 3600 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
];


export default function TracesPage() {
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [since, setSince] = useState(0);
  const [agentId, setAgentId] = useState("");
  const [source, setSource] = useState<"" | SourceScope>("");
  const [offset, setOffset] = useState(0);

  // Drill-down from the agents page arrives via ?agent_id=… (read client-side to
  // avoid a Suspense boundary for the whole route).
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("agent_id");
    if (a) setAgentId(a);
  }, []);

  // Any filter change resets pagination to the first page.
  useEffect(() => {
    setOffset(0);
  }, [status, severity, since, agentId, source]);

  const opts = useMemo(
    () => ({
      limit: PAGE,
      offset,
      status: status || undefined,
      severity: severity || undefined,
      since: since || undefined,
      agentId: agentId || undefined,
      source: source || undefined,
    }),
    [offset, status, severity, since, agentId, source]
  );

  const { data, isLoading, error } = useTraces(opts);
  const traces = data?.traces || [];
  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE, total);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader icon={Activity} title="Traces" subtitle="Agent execution traces with unified risk scoring" />
      {error && !isLoading && (
        <p className="mb-4 text-xs text-red-500">Could not reach the collector. Check that the stack is running.</p>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {agentId && (
          <button
            onClick={() => setAgentId("")}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-gray-900"
            title="Clear agent filter"
          >
            agent: {agentId}
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <Select
          value={status}
          onValueChange={setStatus}
          size="sm"
          ariaLabel="Filter by status"
          className="min-w-[130px]"
          options={[
            { value: "", label: "All statuses" },
            { value: "ok", label: "OK" },
            { value: "error", label: "Error" },
          ]}
        />
        <Select
          value={severity}
          onValueChange={setSeverity}
          size="sm"
          ariaLabel="Filter by risk"
          className="min-w-[130px]"
          options={[
            { value: "", label: "Any risk" },
            { value: "low", label: "Low+" },
            { value: "medium", label: "Medium+" },
            { value: "high", label: "High+" },
            { value: "critical", label: "Critical" },
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
        {!agentId && <SourceFilter value={source} onChange={setSource} />}
        <span className="ml-auto text-xs text-gray-500 tabular-nums">
          {total.toLocaleString()} trace{total === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading ? <TableSkeleton rows={5} cols={8} /> : <TraceList traces={traces} showSource />}

      {/* Pagination */}
      {total > 0 && (offset > 0 || pageEnd < total) && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500 tabular-nums">
            Showing {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              disabled={pageEnd >= total}
              onClick={() => setOffset(offset + PAGE)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
