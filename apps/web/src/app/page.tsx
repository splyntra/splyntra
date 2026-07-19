// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  Bot,
  DollarSign,
  Bell,
  ArrowRight,
  ArrowUpRight,
  LineChart as LineChartIcon,
  ClipboardCheck,
  ShieldAlert,
  AlertTriangle,
  Gauge,
  Clock,
  Workflow,
  Server,
  FileDown,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { exportWorkbook, ExportSheet } from "@/lib/export";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Card,
  StatCard,
  RiskBadge,
  SeverityBadge,
  EmptyState,
  severityFromScore,
  type Severity,
} from "@/components/ui/primitives";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useMetrics, useCosts, useAgents, useTraces, useSecurityIncidents, useSpanMetrics } from "@/lib/hooks";
import { usePlanFeature } from "@/lib/slots";
import { usePlatforms } from "@/lib/platforms";

// ─── formatting helpers ──────────────────────────────────────────────────────

const fmtNum = (n: number) =>
  Number.isFinite(n) ? new Intl.NumberFormat("en-US").format(Math.round(n)) : "0";
const fmtUSD = (n: number) => {
  if (!Number.isFinite(n)) return "$0";
  return n >= 1
    ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : `$${n.toFixed(n >= 0.01 ? 3 : 5)}`;
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const isLive = (iso: string, withinSec = 600) =>
  Date.now() - new Date(iso).getTime() < withinSec * 1000;

// Semantic severity colors (mirror tailwind `risk.*`), keyed by primitive Severity.
const SEV_COLOR: Record<Severity, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ef4444",
  MEDIUM: "#f59e0b",
  LOW: "#10b981",
  NONE: "#d1d5db",
};
const SEV_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"];

function normSeverity(raw: string, score: number): Severity {
  const up = (raw || "").toUpperCase();
  return (up as Severity) in SEV_COLOR ? (up as Severity) : severityFromScore(score);
}

// Focus ring shared by the interactive list rows (keyboard accessibility).
const ROW_FOCUS =
  "rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:focus-visible:ring-splyntra-500";

// ─── shared chart/state pieces ────────────────────────────────────────────────

// Dark-mode-aware tooltip (recharts' inline styles can't see the theme class).
interface TipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: { fill?: string };
}
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800">
      {label != null && label !== "" && (
        <div className="mb-1 font-medium text-gray-500 dark:text-gray-400">{label}</div>
      )}
      {payload.map((p, i) => (
        <div
          key={p.dataKey ?? p.name ?? i}
          className="flex items-center gap-2 tabular-nums text-gray-700 dark:text-gray-200"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color || p.payload?.fill || "#9ca3af" }}
            aria-hidden
          />
          <span className="capitalize">{String(p.name ?? "").toLowerCase()}</span>
          <span className="ml-auto pl-3 font-semibold">{fmtNum(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

function LoadError({ what }: { what: string }) {
  return (
    <EmptyState icon={AlertTriangle} title="Couldn’t load data">
      {what} is unavailable — check that the collector is reachable, then retry.
    </EmptyState>
  );
}

// Top-level domain card: one per data plane (Agents / Platforms / MCP), color-keyed
// to the SourceBadge palette so the three domains are instantly recognizable.
const DOMAIN_TONE: Record<"brand" | "amber" | "neutral", string> = {
  brand: "bg-splyntra-50 text-splyntra-600 dark:bg-splyntra-950/40 dark:text-splyntra-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  neutral: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300",
};
function DomainCard({ href, icon: Icon, label, value, sub, tone, loading }: {
  href: string; icon: LucideIcon; label: string; value: string; sub: string; tone: "brand" | "amber" | "neutral"; loading?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group relative flex items-center gap-4 rounded-xl border border-gray-200/80 bg-white p-5 shadow-card outline-none transition-all hover:border-splyntra-300 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:border-gray-800 dark:bg-gray-900"
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${DOMAIN_TONE[tone]}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        {loading ? (
          <div className="h-7 w-12 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        ) : (
          <div className="text-2xl font-bold tabular-nums leading-tight text-gray-900 dark:text-white">{value}</div>
        )}
        <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{label}</div>
        <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>
      </div>
      <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </Link>
  );
}

function SectionHeader({ title, href, cta }: { title: string; href: string; cta: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded text-xs text-gray-400 outline-none hover:text-splyntra-600 focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:hover:text-splyntra-300"
      >
        {cta} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  // The home overview is the Agents fleet view: scope KPIs/feed to agent runs so
  // orchestrator (platform) runs — which have their own home at /platforms —
  // don't inflate the numbers here.
  const metrics = useMetrics({ windowSec: 86400, intervalSec: 3600, source: "agent" });
  const costs = useCosts({ source: "agent" });
  const agents = useAgents(86400);
  const traces = useTraces({ limit: 100, source: "agent" });
  // Security detection is Pro+; on lower plans skip the request (it would 403)
  // — the activity feed simply omits security items rather than erroring.
  const incidents = useSecurityIncidents({ limit: 6, source: "agent" }, usePlanFeature("secret_pii_detection"));

  // The three product domains, for the top-level domain row.
  const platforms = usePlatforms();
  const mcpServers = useSpanMetrics({ group: "mcp_server" });

  const points = metrics.data?.points ?? [];
  const traceRows = traces.data?.traces ?? [];

  const domains = useMemo(() => {
    const platformRows = platforms.data?.platforms ?? [];
    const serverRows = mcpServers.data?.groups ?? [];
    return {
      agents: { count: agents.data?.total ?? 0, runs: agents.data?.agents.reduce((a, x) => a + x.trace_count, 0) ?? 0 },
      platforms: { count: platformRows.length, runs: platformRows.reduce((a, p) => a + p.run_count, 0) },
      mcp: { count: serverRows.length, calls: serverRows.reduce((a, s) => a + s.count, 0) },
    };
  }, [agents.data, platforms.data, mcpServers.data]);

  // KPI aggregates over the 24h window.
  const kpi = useMemo(() => {
    const totalTraces = points.reduce((a, p) => a + p.trace_count, 0);
    const totalErrors = points.reduce((a, p) => a + p.error_count, 0);
    const p95 = points.reduce((a, p) => Math.max(a, p.p95_latency_ms), 0);
    return {
      totalTraces,
      totalErrors,
      errRate: totalTraces ? (totalErrors / totalTraces) * 100 : 0,
      p95,
      spend: costs.data?.summary.total_cost ?? 0,
    };
  }, [points, costs.data]);

  // Throughput series for the area chart.
  const series = useMemo(
    () =>
      points.map((p) => ({
        t: new Date(p.bucket).toLocaleTimeString("en-US", { hour: "numeric" }),
        traces: p.trace_count,
        errors: p.error_count,
      })),
    [points]
  );

  // Risk-severity distribution across recent traces (the donut).
  const severityDist = useMemo(() => {
    const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
    for (const t of traceRows) counts[normSeverity(t.risk_severity, t.risk_score)]++;
    return SEV_ORDER.map((s) => ({ name: s, value: counts[s] })).filter((d) => d.value > 0);
  }, [traceRows]);
  const riskyCount = traceRows.filter((t) => t.risk_score >= 50).length;

  // Active agents: most-active first (the windowed query already scopes to 24h).
  const activeAgents = useMemo(
    () => [...(agents.data?.agents ?? [])].sort((a, b) => b.trace_count - a.trace_count).slice(0, 6),
    [agents.data]
  );

  // Unified recent-activity feed: traces + security detections, newest first.
  const feed = useMemo(() => {
    const items = [
      ...traceRows.slice(0, 12).map((t) => ({
        kind: "trace" as const,
        time: t.started_at,
        traceId: t.trace_id,
        label: t.agent_id || "unknown agent",
        severity: normSeverity(t.risk_severity, t.risk_score),
        detail: `${t.span_count} spans · ${Math.round(t.latency_ms)}ms`,
      })),
      ...(incidents.data?.incidents ?? []).map((d) => ({
        kind: "incident" as const,
        time: d.detected_at,
        traceId: d.trace_id,
        label: d.category || d.detector,
        severity: (d.severity || "").toUpperCase() as Severity,
        detail: d.description || d.detector,
      })),
    ];
    return items
      .filter((i) => i.time)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);
  }, [traceRows, incidents.data]);

  const connected = !metrics.isError && !traces.isError;
  const loading = metrics.isLoading || traces.isLoading;

  // ── Detailed fleet report (multi-sheet Excel) ──────────────────────────────
  const [reportBusy, setReportBusy] = useState(false);
  async function generateReport() {
    if (reportBusy) return;
    setReportBusy(true);
    try {
      const agentsAll = agents.data?.agents ?? [];
      const modelsAll = costs.data?.models ?? [];
      const incidentsAll = incidents.data?.incidents ?? [];
      const sheets: ExportSheet<any>[] = [
        {
          name: "Overview",
          columns: [
            { header: "Metric", value: (r: { m: string; v: string | number }) => r.m },
            { header: "Value", value: (r: { m: string; v: string | number }) => r.v },
          ],
          rows: [
            { m: "Report generated", v: new Date().toISOString() },
            { m: "Window", v: "Last 24 hours" },
            { m: "Traces (24h)", v: kpi.totalTraces },
            { m: "Errors (24h)", v: kpi.totalErrors },
            { m: "Error rate (%)", v: +kpi.errRate.toFixed(1) },
            { m: "p95 latency (ms)", v: Math.round(kpi.p95) },
            { m: "Total spend (USD)", v: +kpi.spend.toFixed(2) },
            { m: "Agents (active 24h)", v: domains.agents.count },
            { m: "Agent runs (24h)", v: domains.agents.runs },
            { m: "Platforms", v: domains.platforms.count },
            { m: "Platform workflow runs", v: domains.platforms.runs },
            { m: "MCP servers", v: domains.mcp.count },
            { m: "MCP tool calls", v: domains.mcp.calls },
            { m: "High-risk traces", v: riskyCount },
          ],
        },
        {
          name: "Agents",
          columns: [
            { header: "Agent", value: (a) => a.name || a.agent_id },
            { header: "Framework", value: (a) => a.framework || "" },
            { header: "Runs", value: (a) => a.trace_count },
            { header: "Errors", value: (a) => a.error_count },
            { header: "P95 (ms)", value: (a) => Math.round(a.p95_latency_ms) },
            { header: "Cost (USD)", value: (a) => a.total_cost },
            { header: "Avg Risk", value: (a) => Math.round(a.avg_risk || 0) },
            { header: "Last Seen", value: (a) => new Date(a.last_seen_at).toISOString() },
          ],
          rows: agentsAll,
        },
        {
          name: "Recent traces",
          columns: [
            { header: "Trace ID", value: (t) => t.trace_id },
            { header: "Agent", value: (t) => t.agent_id },
            { header: "Status", value: (t) => t.status },
            { header: "Latency (ms)", value: (t) => t.latency_ms },
            { header: "Tokens", value: (t) => t.total_tokens },
            { header: "Cost (USD)", value: (t) => t.cost_usd },
            { header: "Risk", value: (t) => t.risk_score },
            { header: "Started", value: (t) => new Date(t.started_at).toISOString() },
          ],
          rows: traceRows,
        },
        {
          name: "Security",
          columns: [
            { header: "Detected", value: (d) => new Date(d.detected_at).toISOString() },
            { header: "Detector", value: (d) => d.detector },
            { header: "Category", value: (d) => d.category },
            { header: "Severity", value: (d) => d.severity },
            { header: "Description", value: (d) => d.description },
            { header: "Trace ID", value: (d) => d.trace_id },
          ],
          rows: incidentsAll,
        },
        {
          name: "Cost by model",
          columns: [
            { header: "Model", value: (m) => m.model },
            { header: "Calls", value: (m) => m.call_count },
            { header: "Prompt Tokens", value: (m) => m.total_prompt_tokens },
            { header: "Completion Tokens", value: (m) => m.total_completion_tokens },
            { header: "Total Cost (USD)", value: (m) => m.total_cost },
          ],
          rows: modelsAll,
        },
        {
          name: "Throughput (24h)",
          columns: [
            { header: "Hour", value: (p) => new Date(p.bucket).toLocaleString() },
            { header: "Traces", value: (p) => p.trace_count },
            { header: "Errors", value: (p) => p.error_count },
          ],
          rows: points,
        },
      ];
      await exportWorkbook("splyntra-report", sheets);
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Overview</h1>
          <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
            Your agents, platforms, and MCP servers at a glance — activity, cost, and safety.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={generateReport}
            disabled={reportBusy}
            title="Generate a detailed fleet report (multi-sheet Excel)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Generate report
          </button>
          <span
            role="status"
            aria-live="polite"
            title="Live collector connection status"
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium shadow-sm ${
              connected
                ? "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-900 dark:bg-gray-900 dark:text-emerald-300"
                : "border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-gray-900 dark:text-red-300"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                connected ? "animate-pulse bg-emerald-500 shadow-sm shadow-emerald-500/50" : "bg-red-500"
              }`}
            />
            {loading ? "Connecting…" : connected ? "Collector connected · OTLP :4318" : "Collector unreachable"}
          </span>
        </div>
      </div>

      {/* Domains — the three separated data planes */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DomainCard
          href="/agents" icon={Bot} tone="brand" label="Agents"
          value={fmtNum(domains.agents.count)}
          sub={`${fmtNum(domains.agents.runs)} runs · 24h`}
          loading={agents.isLoading}
        />
        <DomainCard
          href="/platforms" icon={Workflow} tone="amber" label="Agent Platforms"
          value={fmtNum(domains.platforms.count)}
          sub={`${fmtNum(domains.platforms.runs)} workflow runs`}
          loading={platforms.isLoading}
        />
        <DomainCard
          href="/mcp" icon={Server} tone="neutral" label="MCP Servers"
          value={fmtNum(domains.mcp.count)}
          sub={`${fmtNum(domains.mcp.calls)} tool calls`}
          loading={mcpServers.isLoading}
        />
      </div>

      {/* KPI row — scoped to agents (platforms have their own home) */}
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Agents · last 24 hours</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Traces · 24h" value={fmtNum(kpi.totalTraces)} icon={Activity} />
        <StatCard
          label="Error rate · 24h"
          value={`${kpi.errRate.toFixed(1)}%`}
          icon={AlertTriangle}
          accent={kpi.errRate >= 5 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}
        />
        <StatCard label="p95 latency · 24h" value={`${fmtNum(kpi.p95)} ms`} icon={Gauge} />
        <StatCard label="Spend · all time" value={fmtUSD(kpi.spend)} icon={DollarSign} />
      </div>

      {/* Throughput + risk donut */}
      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <SectionHeader title="Throughput · 24h" href="/metrics" cta="Metrics" />
          {loading ? (
            <div className="h-[220px] animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ) : metrics.isError ? (
            <LoadError what="Throughput" />
          ) : series.length === 0 ? (
            <EmptyState icon={LineChartIcon} title="No traffic yet">
              Send your first trace to see throughput here.
            </EmptyState>
          ) : (
            <div role="img" aria-label="Trace and error throughput over the last 24 hours">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={series} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTraces" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#71717a" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#71717a" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gErrors" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.18} vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#9ca3af", strokeOpacity: 0.3 }} />
                  <Area type="monotone" dataKey="traces" stroke="#71717a" strokeWidth={2} fill="url(#gTraces)" name="Traces" />
                  <Area type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={1.5} fill="url(#gErrors)" name="Errors" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader title="Risk distribution" href="/traces" cta="Traces" />
          {loading ? (
            <div className="mx-auto h-[180px] w-[180px] animate-pulse rounded-full bg-gray-100 dark:bg-gray-800" />
          ) : traces.isError ? (
            <LoadError what="Risk data" />
          ) : severityDist.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No traces scored yet" />
          ) : (
            <>
              <div className="relative" role="img" aria-label={`Recent traces by risk severity; ${riskyCount} high-risk`}>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={severityDist} dataKey="value" nameKey="name" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                      {severityDist.map((d) => (
                        <Cell key={d.name} fill={SEV_COLOR[d.name as Severity]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">{riskyCount}</span>
                  <span className="text-[10px] uppercase tracking-wider text-gray-400">high-risk</span>
                </div>
              </div>
              <p className="mt-1 text-center text-[10px] text-gray-400">across last {traceRows.length} traces</p>
              <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                {severityDist.map((d) => (
                  <span key={d.name} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEV_COLOR[d.name as Severity] }} aria-hidden />
                    {d.name.toLowerCase()}{" "}
                    <span className="tabular-nums font-medium text-gray-700 dark:text-gray-300">{d.value}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Active agents + recent activity */}
      <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Active agents */}
        <Card className="p-5">
          <SectionHeader title="Active agents" href="/agents" cta="All agents" />
          {agents.isLoading ? (
            <CardSkeleton />
          ) : agents.isError ? (
            <LoadError what="Agent activity" />
          ) : activeAgents.length === 0 ? (
            <EmptyState icon={Bot} title="No active agents">
              Agents appear here once they emit spans.
            </EmptyState>
          ) : (
            <ul className="-my-2 divide-y divide-gray-100 dark:divide-gray-800">
              {activeAgents.map((a) => (
                <li key={a.agent_id}>
                  <Link
                    href={`/agents/${encodeURIComponent(a.agent_id)}`}
                    className={`group flex items-center justify-between gap-3 py-2.5 ${ROW_FOCUS}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isLive(a.last_seen_at) && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Active in the last 10 minutes" aria-hidden />
                        )}
                        <span className="truncate text-[13px] font-medium text-gray-900 group-hover:text-splyntra-600 dark:text-white">
                          {a.name || a.agent_id}
                        </span>
                        {a.framework && (
                          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            {a.framework}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-400">
                        {fmtNum(a.trace_count)} runs · p95 {fmtNum(a.p95_latency_ms)}ms · {relTime(a.last_seen_at)}
                      </div>
                    </div>
                    <RiskBadge score={Math.round(a.avg_risk)} severity={severityFromScore(a.avg_risk)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent activity */}
        <Card className="p-5">
          <SectionHeader title="Recent activity" href="/security" cta="Security" />
          {loading ? (
            <CardSkeleton />
          ) : traces.isError ? (
            <LoadError what="Recent activity" />
          ) : feed.length === 0 ? (
            <EmptyState icon={Clock} title="Nothing recent">
              Traces and detections will stream in here.
            </EmptyState>
          ) : (
            <ul className="-my-2 divide-y divide-gray-100 dark:divide-gray-800">
              {feed.map((f, i) => (
                <li key={`${f.kind}-${f.traceId}-${i}`}>
                  <Link
                    href={`/traces/${encodeURIComponent(f.traceId)}`}
                    className={`group flex items-center justify-between gap-3 py-2.5 ${ROW_FOCUS}`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                          f.kind === "incident"
                            ? "bg-red-50 text-red-500 dark:bg-red-950/40"
                            : "bg-gray-100 text-gray-400 dark:bg-gray-800"
                        }`}
                      >
                        {f.kind === "incident" ? <ShieldAlert className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-gray-900 group-hover:text-splyntra-600 dark:text-white">
                          {f.label}
                        </div>
                        <div className="truncate text-[11px] text-gray-400">{f.detail}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {f.severity && f.severity in SEV_COLOR && f.severity !== "NONE" && (
                        <SeverityBadge severity={f.severity} />
                      )}
                      <span className="whitespace-nowrap text-[11px] tabular-nums text-gray-400">{relTime(f.time)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Quick jump */}
      <nav aria-label="Quick links">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Jump to</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {SHORTCUTS.map(({ href, title, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-2.5 rounded-xl border border-gray-200/80 bg-white px-3.5 py-3 shadow-card outline-none transition-all hover:border-splyntra-300 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:border-gray-800 dark:bg-gray-900"
            >
              <Icon className="h-4 w-4 text-gray-400 transition-colors group-hover:text-splyntra-600" aria-hidden />
              <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{title}</span>
              <ArrowRight className="ml-auto h-3.5 w-3.5 -translate-x-1 text-gray-300 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

const SHORTCUTS: { href: string; title: string; icon: LucideIcon }[] = [
  { href: "/traces", title: "Traces", icon: Activity },
  { href: "/platforms", title: "Platforms", icon: Workflow },
  { href: "/mcp", title: "MCP Servers", icon: Server },
  { href: "/metrics", title: "Metrics", icon: LineChartIcon },
  { href: "/evaluations", title: "Evaluation", icon: ClipboardCheck },
  { href: "/costs", title: "Costs", icon: DollarSign },
  { href: "/security", title: "Security", icon: ShieldAlert },
  { href: "/alerts", title: "Alerts", icon: Bell },
];
