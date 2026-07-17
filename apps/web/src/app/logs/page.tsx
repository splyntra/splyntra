// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useMemo, useState } from "react";
import { useLogs } from "@/lib/hooks";
import { SourceScope } from "@/lib/api";
import { LogList } from "@/components/log/LogList";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { SearchInput } from "@/components/ui/SearchInput";
import { SourceFilter } from "@/components/ui/SourceFilter";
import { ExportButton } from "@/components/ui/ExportButton";
import { ServerPagination } from "@/components/ui/DataTable";
import { ExportColumn } from "@/lib/export";
import { LogListItem } from "@/lib/api";
import { ScrollText } from "lucide-react";

const LOG_EXPORT_COLUMNS: ExportColumn<LogListItem>[] = [
  { header: "Time", value: (l) => new Date(l.timestamp).toISOString() },
  { header: "Severity", value: (l) => l.severity },
  { header: "Agent", value: (l) => l.agent_id },
  { header: "Message", value: (l) => l.body },
  { header: "Trace ID", value: (l) => l.trace_id },
  { header: "Span ID", value: (l) => l.span_id },
];

const TIME_RANGES = [
  { label: "All time", value: 0 },
  { label: "Last hour", value: 3600 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
];
const SEVERITIES = [
  { value: "", label: "All levels" },
  { value: "DEBUG", label: "Debug+" },
  { value: "INFO", label: "Info+" },
  { value: "WARN", label: "Warn+" },
  { value: "ERROR", label: "Error+" },
  { value: "FATAL", label: "Fatal" },
];

export default function LogsPage() {
  const [severity, setSeverity] = useState("");
  const [since, setSince] = useState(0);
  const [source, setSource] = useState<"" | SourceScope>("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => setOffset(0), [severity, since, source, search]);

  const opts = useMemo(
    () => ({
      limit: pageSize,
      offset,
      severity: severity || undefined,
      since: since || undefined,
      source: source || undefined,
      search: search.trim() || undefined,
    }),
    [offset, pageSize, severity, since, source, search]
  );

  const { data, isLoading, error } = useLogs(opts);
  const logs = data?.logs || [];
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader icon={ScrollText} title="Logs" subtitle="Structured, trace-correlated agent logs — searchable, severity-filtered, and redacted." />
      {error && !isLoading && (
        <p className="mb-4 text-xs text-red-500">Could not reach the collector. Check that the stack is running.</p>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search log messages…" className="max-w-xs" />
        <Select value={severity} onValueChange={setSeverity} size="sm" ariaLabel="Filter by severity" className="min-w-[130px]" options={SEVERITIES} />
        <Select value={String(since)} onValueChange={(v) => setSince(Number(v))} size="sm" ariaLabel="Time range" className="min-w-[130px]" options={TIME_RANGES.map((t) => ({ value: String(t.value), label: t.label }))} />
        <SourceFilter value={source} onChange={setSource} />
        <ExportButton rows={logs} columns={LOG_EXPORT_COLUMNS} filename="logs" sheetName="Logs" />
        <span className="ml-auto text-xs text-gray-500 tabular-nums">{total.toLocaleString()} log{total === 1 ? "" : "s"}</span>
      </div>

      {isLoading ? <TableSkeleton rows={8} cols={5} /> : <LogList logs={logs} />}

      <ServerPagination total={total} limit={pageSize} offset={offset} onOffset={setOffset} onLimit={setPageSize} unit="log" />
    </div>
  );
}
