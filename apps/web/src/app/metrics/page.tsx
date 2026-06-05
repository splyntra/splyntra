// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { LineChart as LineChartIcon, Clock, Activity, AlertTriangle, Coins } from "lucide-react";
import { useMetrics } from "@/lib/hooks";
import { MetricPoint } from "@/lib/api";
import { PageHeader, Card, StatCard } from "@/components/ui/primitives";

const WINDOWS: { label: string; window: number; interval: number }[] = [
  { label: "1h", window: 3600, interval: 60 },
  { label: "24h", window: 86400, interval: 300 },
  { label: "7d", window: 604800, interval: 3600 },
];

export default function MetricsPage() {
  const [w, setW] = useState(WINDOWS[1]);
  const { data, isLoading, error } = useMetrics(w.window, w.interval);

  const points: MetricPoint[] = data?.points || [];
  const rows = points.map((p) => ({
    t: new Date(p.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    avg: Math.round(p.avg_latency_ms),
    p95: Math.round(p.p95_latency_ms),
    throughput: p.trace_count,
    errorRate: p.trace_count > 0 ? +((p.error_count / p.trace_count) * 100).toFixed(1) : 0,
    tokens: p.total_tokens,
    cost: +p.total_cost.toFixed(4),
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
                    ? "bg-splyntra-600 text-white"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {error && !isLoading && (
        <p className="-mt-2 mb-4 text-xs text-red-500">Could not reach the collector.</p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Runs" value={totals.traces.toLocaleString()} icon={Activity} />
        <StatCard label="Error Rate" value={`${errorRate}%`} icon={AlertTriangle} accent={totals.errors > 0 ? "text-red-600" : undefined} />
        <StatCard label="Tokens" value={totals.tokens.toLocaleString()} icon={Coins} />
        <StatCard label="Spend" value={`$${totals.cost.toFixed(2)}`} icon={Clock} />
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
              <Line type="monotone" dataKey="avg" name="avg" stroke="#4c6ef5" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="p95" name="p95" stroke="#f59f00" dot={false} strokeWidth={2} />
            </LineChart>
          </ChartCard>
          <ChartCard title="Throughput (runs)">
            <BarChart data={rows}>
              {grid()}
              <Bar dataKey="throughput" name="runs" fill="#4c6ef5" radius={[2, 2, 0, 0]} />
            </BarChart>
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
      <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="#9ca3af" />
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
