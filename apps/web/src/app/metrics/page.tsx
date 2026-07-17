// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { LineChart as LineChartIcon, Activity, AlertTriangle, Coins, DollarSign } from "lucide-react";
import { useMetrics, useAgents, useCosts } from "@/lib/hooks";
import { MetricPoint } from "@/lib/api";
import { PageHeader, Card, StatCard } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { SourceFilter } from "@/components/ui/SourceFilter";
import { SourceScope } from "@/lib/api";

const WINDOWS: { label: string; window: number; interval: number }[] = [
  { label: "1h", window: 3600, interval: 60 },
  { label: "24h", window: 86400, interval: 300 },
  { label: "7d", window: 604800, interval: 3600 },
];


function fmtBucket(iso: string, windowSec: number): string {
  const d = new Date(iso);
  return windowSec >= 2 * 86400
    ? d.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MetricsPage() {
  const [w, setW] = useState(WINDOWS[1]);
  const [agentId, setAgentId] = useState("");
  const [model, setModel] = useState("");
  const [source, setSource] = useState<"" | SourceScope>("");
  const [compare, setCompare] = useState(false);

  const base = { windowSec: w.window, intervalSec: w.interval, agentId: agentId || undefined, model: model || undefined, source: source || undefined };
  const { data, isLoading, error } = useMetrics(base);
  const { data: prevData } = useMetrics({ ...base, offsetSec: w.window }, compare);
  const { data: agentsData } = useAgents();
  const { data: costsData } = useCosts();

  const points: MetricPoint[] = data?.points || [];
  const prev: MetricPoint[] = prevData?.points || [];

  const rows = points.map((p, i) => ({
    t: fmtBucket(p.bucket, w.window),
    avg: Math.round(p.avg_latency_ms),
    p50: Math.round(p.p50_latency_ms),
    p95: Math.round(p.p95_latency_ms),
    p99: Math.round(p.p99_latency_ms),
    throughput: p.trace_count,
    errorRate: p.trace_count > 0 ? +((p.error_count / p.trace_count) * 100).toFixed(1) : 0,
    cost: +p.total_cost.toFixed(4),
    prevAvg: compare ? (prev[i] ? Math.round(prev[i].avg_latency_ms) : null) : undefined,
    prevThroughput: compare ? (prev[i]?.trace_count ?? null) : undefined,
  }));

  const totals = points.reduce(
    (a, p) => ({
      traces: a.traces + p.trace_count,
      errors: a.errors + p.error_count,
      tokens: a.tokens + p.total_tokens,
      cost: a.cost + p.total_cost,
    }),
    { traces: 0, errors: 0, tokens: 0, cost: 0 }
  );
  const errorRate = totals.traces > 0 ? ((totals.errors / totals.traces) * 100).toFixed(1) : "0.0";

  const agents = useMemo(() => agentsData?.agents || [], [agentsData]);
  const models = useMemo(() => costsData?.models || [], [costsData]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        icon={LineChartIcon}
        title="Metrics"
        subtitle="Latency, throughput, error rate, and spend over time"
        action={
          <div className="flex gap-1 rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
            {WINDOWS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setW(opt)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  w.label === opt.label
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Slice + compare controls */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select
          value={agentId}
          onValueChange={setAgentId}
          size="sm"
          ariaLabel="Filter by agent"
          className="min-w-[150px]"
          options={[{ value: "", label: "All agents" }, ...agents.map((a) => ({ value: a.agent_id, label: a.name || a.agent_id }))]}
        />
        <Select
          value={model}
          onValueChange={setModel}
          size="sm"
          ariaLabel="Filter by model"
          className="min-w-[150px]"
          options={[{ value: "", label: "All models" }, ...models.map((m) => ({ value: m.model, label: m.model }))]}
        />
        {!agentId && <SourceFilter value={source} onChange={setSource} />}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-gray-900 dark:accent-white" />
          Compare to previous period
        </label>
      </div>

      {error && !isLoading && <p className="-mt-2 mb-4 text-xs text-red-500">Could not reach the collector.</p>}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Runs" value={totals.traces.toLocaleString()} icon={Activity} />
        <StatCard label="Error Rate" value={`${errorRate}%`} icon={AlertTriangle} accent={totals.errors > 0 ? "text-red-600" : undefined} />
        <StatCard label="Tokens" value={totals.tokens.toLocaleString()} icon={Coins} />
        <StatCard label="Spend" value={`$${totals.cost.toFixed(2)}`} icon={DollarSign} />
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-500">Loading metrics…</div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-gray-500">No metrics in this window yet — send some traces.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Latency (ms)">
            <LineChart data={rows}>
              {grid()}
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="p50" name="p50" stroke="#868e96" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="avg" name="avg" stroke="#4c6ef5" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="p95" name="p95" stroke="#f59f00" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="p99" name="p99" stroke="#e8590c" dot={false} strokeWidth={1.5} />
              {compare && <Line type="monotone" dataKey="prevAvg" name="avg (prev)" stroke="#adb5bd" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />}
            </LineChart>
          </ChartCard>
          <ChartCard title="Throughput (runs)">
            <ComposedChart data={rows}>
              {grid()}
              {compare && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Bar dataKey="throughput" name="runs" fill="#4c6ef5" radius={[2, 2, 0, 0]} />
              {compare && <Line type="monotone" dataKey="prevThroughput" name="runs (prev)" stroke="#adb5bd" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />}
            </ComposedChart>
          </ChartCard>
          <ChartCard title="Error rate (%)">
            <AreaChart data={rows}>
              {grid()}
              <Area type="monotone" dataKey="errorRate" name="error %" stroke="#fa5252" fill="#ffc9c9" />
            </AreaChart>
          </ChartCard>
          <ChartCard title="Spend ($)">
            <AreaChart data={rows}>
              {grid()}
              <Area type="monotone" dataKey="cost" name="cost" stroke="#37b24d" fill="#b2f2bb" />
            </AreaChart>
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function grid() {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
      <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="#9ca3af" minTickGap={24} />
      <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" width={40} />
      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
    </>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </Card>
  );
}
