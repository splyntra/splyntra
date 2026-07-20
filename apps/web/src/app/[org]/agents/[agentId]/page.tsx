// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAgents, useTraces, useSecurityIncidents, useCosts, useMetrics, useAgentProfile, useEvalRuns } from "@/lib/hooks";
import { AgentItem, DetectionItem, CostModelItem } from "@/lib/api";
import { slotWidgets, usePlanFeature } from "@/lib/slots";
import { TraceList } from "@/components/trace/TraceList";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { PageHeader, StatCard, Card, EmptyState, SeverityBadge } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { SourceBadge } from "@/components/ui/SourceBadge";
import { Select } from "@/components/ui/Select";
import { SearchInput } from "@/components/ui/SearchInput";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import {
  Bot, ArrowLeft, Activity, AlertCircle, AlertTriangle, Clock, Coins, DollarSign,
  ShieldAlert, ShieldCheck, Lock, LineChart, ClipboardCheck, Settings, Sparkles, Boxes, Database, Bell, Plus,
} from "lucide-react";
import { useOrgHref } from "@/lib/org-path";

const WINDOWS = [
  { label: "All time", value: 0 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
  { label: "Last 30d", value: 2592000 },
];
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const DETECTOR_LABEL: Record<string, string> = {
  pii: "PII",
  secrets: "Secret",
  injection: "Injection",
  moderation: "Moderation",
  tool_guard: "Tool guard",
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}
type Tab = "overview" | "traces" | "metrics" | "evaluation" | "costs" | "security" | "config";
const TABS: { id: Tab; label: string; icon: typeof Bot }[] = [
  { id: "overview", label: "Overview", icon: Bot },
  { id: "traces", label: "Traces", icon: Activity },
  { id: "metrics", label: "Metrics", icon: LineChart },
  { id: "evaluation", label: "Evaluation", icon: ClipboardCheck },
  { id: "costs", label: "Costs", icon: DollarSign },
  { id: "security", label: "Security", icon: ShieldAlert },
  { id: "config", label: "Config", icon: Settings },
];

function GovernanceSection() {
  const widgets = slotWidgets("agentTrustGovernance");
  if (widgets.length > 0) return <>{widgets.map((W, i) => <W key={i} />)}</>;
  return (
    <EmptyState icon={Lock} title="Governance is a Splyntra Cloud feature">
      Policy decisions, budget-scoped delegation, and the immutable activity ledger for this agent appear here in Splyntra Cloud.
    </EmptyState>
  );
}

export default function AgentDashboardPage() {
  const oh = useOrgHref();
  const params = useParams();
  const agentId = decodeURIComponent(String(params.agentId || ""));
  const [windowSec, setWindowSec] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const since = windowSec || undefined;

  const { data: agentsData, isLoading: agentsLoading } = useAgents(since);
  const agent: AgentItem | undefined = useMemo(() => agentsData?.agents.find((a) => a.agent_id === agentId), [agentsData, agentId]);

  const { data: tracesData, isLoading: tracesLoading, isError: tracesError } = useTraces({ agentId, since, limit: 50 });
  const traces = tracesData?.traces || [];
  // Security detection is Pro+; on lower plans skip the (would-be-403) request
  // and show a locked card instead of a false "collector unavailable" error.
  const canSecurity = usePlanFeature("secret_pii_detection");
  const { data: incidentsData, isLoading: incidentsLoading, isError: incidentsError } = useSecurityIncidents({ agentId, since, limit: 100 }, canSecurity);
  const incidents = useMemo(() => incidentsData?.incidents || [], [incidentsData]);
  const { data: costsData, isLoading: costsLoading, isError: costsError } = useCosts(agentId);
  const models = useMemo(() => (costsData?.models || []).slice().sort((a, b) => b.total_cost - a.total_cost), [costsData]);
  const maxModelCost = models.reduce((m, r) => Math.max(m, r.total_cost), 0);

  const errorRate = agent && agent.trace_count > 0 ? ((agent.error_count / agent.trace_count) * 100).toFixed(1) : "0.0";
  const risk = Math.round(agent?.avg_risk || 0);
  const costPerTrace = agent && agent.trace_count > 0 ? agent.total_cost / agent.trace_count : 0;

  const sevCounts = useMemo(() => {
    const c: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const d of incidents) if (c[d.severity] !== undefined) c[d.severity]++;
    return c;
  }, [incidents]);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Link href={oh("/agents")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All agents
      </Link>
      <PageHeader
        icon={Bot}
        title={agent?.name || agentId}
        badge={<SourceBadge source="agent" />}
        subtitle={agent?.framework ? `${agent.framework} agent` : "Agent dashboard"}
        action={
          <Select value={String(windowSec)} onValueChange={(v) => setWindowSec(Number(v))} ariaLabel="Time window" className="min-w-[150px]"
            options={WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))} />
        }
      />

      {/* KPI row (always visible) */}
      {agentsLoading && !agent ? (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}</div>
      ) : !agent ? (
        <Card className="mb-6"><EmptyState icon={Bot} title="No data for this agent in the selected window">Try a wider time range, or send traces tagged with this agent.</EmptyState></Card>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Traces" value={agent.trace_count.toLocaleString()} icon={Activity} />
          <StatCard label="Error Rate" value={`${errorRate}%`} icon={AlertCircle} accent={agent.error_count > 0 ? "text-red-600" : undefined} />
          <StatCard label="P95 Latency" value={`${Math.round(agent.p95_latency_ms)}ms`} icon={Clock} />
          <StatCard label="Tokens" value={agent.total_tokens.toLocaleString()} icon={Coins} />
          <StatCard label="Cost" value={`$${agent.total_cost.toFixed(2)}`} icon={DollarSign} />
          <StatCard label="Avg Risk" value={risk} icon={ShieldAlert} accent={risk >= 50 ? "text-red-600" : risk >= 25 ? "text-amber-600" : undefined} />
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === id ? "border-splyntra-500 text-splyntra-700 dark:text-splyntra-300" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <SecurityCard incidents={incidents} loading={incidentsLoading} error={incidentsError} sevCounts={sevCounts} entitled={canSecurity} />
            <CostCard agent={agent} models={models} maxModelCost={maxModelCost} loading={costsLoading} error={costsError} costPerTrace={costPerTrace} />
          </div>
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-gray-500" /><h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Governance</h2></div>
            <GovernanceSection />
          </Card>
        </div>
      )}

      {tab === "traces" && (
        tracesLoading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : tracesError ? (
          <Card><EmptyState icon={AlertTriangle} title="Couldn’t load traces">The collector is unavailable — check that it’s reachable, then retry.</EmptyState></Card>
        ) : (
          <div className="space-y-3">
            {traces.length >= 50 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                <span>Showing the 50 most recent traces.</span>
                <Link href={`/traces?agent_id=${encodeURIComponent(agentId)}`} className="font-medium underline underline-offset-2 hover:no-underline">View all traces for this agent →</Link>
              </div>
            )}
            <TraceList traces={traces} controls />
          </div>
        )
      )}
      {tab === "metrics" && <MetricsTab agentId={agentId} windowSec={windowSec} />}
      {tab === "evaluation" && <EvaluationTab agentId={agentId} />}
      {tab === "costs" && <AgentCostsTab agent={agent} models={models} loading={costsLoading} error={costsError} costPerTrace={costPerTrace} />}
      {tab === "security" && <SecurityCard incidents={incidents} loading={incidentsLoading} error={incidentsError} sevCounts={sevCounts} entitled={canSecurity} full />}
      {tab === "config" && <ConfigTab agentId={agentId} />}
    </div>
  );
}

function SecurityCard({ incidents, loading, error, sevCounts, entitled = true, full }: { incidents: DetectionItem[]; loading: boolean; error?: boolean; sevCounts: Record<string, number>; entitled?: boolean; full?: boolean }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-gray-500" /><h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Security</h2></div>
      {!entitled ? (
        <EmptyState icon={ShieldAlert} title="Security detection is a Pro feature">
          Secret + PII and prompt-injection findings for this agent are available on Pro and above.
        </EmptyState>
      ) : loading ? <div className="h-40 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" /> : error ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t load detections">The collector is unavailable — check that it’s reachable, then retry.</EmptyState>
      ) : incidents.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No detections for this agent">Prompt-injection, secret, PII, and tool-guard detections appear here.</EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {SEVERITY_ORDER.filter((s) => sevCounts[s] > 0).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5"><SeverityBadge severity={s} /><span className="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-300">{sevCounts[s]}</span></span>
            ))}
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {incidents.slice(0, full ? 100 : 8).map((d, i) => (
              <li key={`${d.trace_id}-${d.span_id}-${d.category}-${i}`} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={d.severity} />
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">{DETECTOR_LABEL[d.detector] || d.detector}</span>
                    <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{d.category}</span>
                    {d.is_beta === 1 && <span className="text-[10px] font-semibold uppercase text-amber-600">beta</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">{d.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs tabular-nums text-gray-400">{Math.round((d.confidence || 0) * 100)}%</span>
                  <Link href={`/traces/${encodeURIComponent(d.trace_id)}`} className="text-xs text-splyntra-600 hover:underline">View trace</Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function CostCard({ agent, models, maxModelCost, loading, error, costPerTrace }: { agent?: AgentItem; models: CostModelItem[]; maxModelCost: number; loading: boolean; error?: boolean; costPerTrace: number }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2"><DollarSign className="h-4 w-4 text-gray-500" /><h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Cost by model</h2></div>
      {agent && (
        <div className="mb-4 flex gap-6">
          <div><div className="text-xl font-semibold tabular-nums text-gray-900 dark:text-white">${agent.total_cost.toFixed(2)}</div><div className="text-xs text-gray-500">total spend</div></div>
          <div><div className="text-xl font-semibold tabular-nums text-gray-900 dark:text-white">${costPerTrace.toFixed(4)}</div><div className="text-xs text-gray-500">per trace</div></div>
        </div>
      )}
      {loading ? <div className="h-40 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" /> : error ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t load cost data">The collector is unavailable — check that it’s reachable, then retry.</EmptyState>
      ) : models.length === 0 ? (
        <EmptyState icon={Coins} title="No model cost recorded">LLM spans with a model + token counts produce a cost breakdown here.</EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {models.map((m) => (
            <li key={m.model}>
              <div className="mb-1 flex items-center justify-between text-sm"><span className="truncate font-medium text-gray-700 dark:text-gray-300">{m.model}</span><span className="tabular-nums text-gray-500">${m.total_cost.toFixed(4)}</span></div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-full rounded-full bg-splyntra-500" style={{ width: `${maxModelCost > 0 ? Math.max(3, (m.total_cost / maxModelCost) * 100) : 0}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Full Costs tab: summary KPIs + a sortable/searchable/paginated model table.
function AgentCostsTab({ agent, models, loading, error, costPerTrace }: { agent?: AgentItem; models: CostModelItem[]; loading: boolean; error?: boolean; costPerTrace: number }) {
  const tc = useTableControls(models, {
    searchText: (m) => m.model,
    sortAccessors: {
      model: (m) => m.model.toLowerCase(),
      calls: (m) => m.call_count,
      prompt: (m) => m.total_prompt_tokens,
      completion: (m) => m.total_completion_tokens,
      cost: (m) => m.total_cost,
      avg: (m) => m.avg_cost_per_call,
    },
    initialSort: { key: "cost", dir: "desc" },
    pageSize: 8,
  });
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;
  if (error) return <Card><EmptyState icon={AlertTriangle} title="Couldn’t load cost data">The collector is unavailable — check that it’s reachable, then retry.</EmptyState></Card>;
  const totalCalls = models.reduce((s, m) => s + m.call_count, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total spend" value={`$${(agent?.total_cost || 0).toFixed(2)}`} icon={DollarSign} />
        <StatCard label="Per trace" value={`$${costPerTrace.toFixed(4)}`} icon={Coins} />
        <StatCard label="Models" value={models.length} icon={Sparkles} />
        <StatCard label="LLM calls" value={totalCalls.toLocaleString()} icon={Activity} />
      </div>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
          <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-gray-500" /><h2 className="text-sm font-semibold text-gray-900 dark:text-white">Cost by model</h2></div>
          {models.length > 0 && (
            <div className="flex items-center gap-2">
              <SearchInput value={tc.q} onChange={tc.setQ} placeholder="Search models…" className="max-w-[200px]" />
              <ExportButton rows={tc.filtered} filename="agent-costs-by-model" sheetName="Cost by model" columns={[
                { header: "Model", value: (m: CostModelItem) => m.model },
                { header: "Calls", value: (m: CostModelItem) => m.call_count },
                { header: "Prompt Tokens", value: (m: CostModelItem) => m.total_prompt_tokens },
                { header: "Completion Tokens", value: (m: CostModelItem) => m.total_completion_tokens },
                { header: "Total Cost (USD)", value: (m: CostModelItem) => m.total_cost },
                { header: "Avg/Call (USD)", value: (m: CostModelItem) => m.avg_cost_per_call },
              ]} />
            </div>
          )}
        </div>
        {models.length === 0 ? (
          <EmptyState icon={Coins} title="No model cost recorded">LLM spans with a model + token counts produce a cost breakdown here.</EmptyState>
        ) : tc.total === 0 ? (
          <EmptyState icon={Coins} title="No models match your search">Try a different term.</EmptyState>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <tr>
                  <SortableTh label="Model" sortKey="model" sort={tc.sort} onSort={tc.toggleSort} className="px-5 py-2.5" />
                  <SortableTh label="Calls" sortKey="calls" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
                  <SortableTh label="Prompt" sortKey="prompt" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
                  <SortableTh label="Completion" sortKey="completion" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
                  <SortableTh label="Total cost" sortKey="cost" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
                  <SortableTh label="Avg/call" sortKey="avg" sort={tc.sort} onSort={tc.toggleSort} align="right" className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {tc.view.map((m) => (
                  <tr key={m.model} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                    <td className="px-5 py-2.5 font-mono text-xs font-medium text-gray-800 dark:text-gray-200">{m.model}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{m.call_count.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{m.total_prompt_tokens.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{m.total_completion_tokens.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right font-medium tabular-nums text-gray-900 dark:text-white">${m.total_cost.toFixed(4)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">${m.avg_cost_per_call.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination page={tc.page} pageCount={tc.pageCount} pageSize={tc.pageSize} total={tc.total} onPage={tc.setPage} onPageSize={tc.setPageSize} unit="model" />
          </>
        )}
      </Card>
    </div>
  );
}

function MetricsTab({ agentId, windowSec }: { agentId: string; windowSec: number }) {
  const { data, isLoading } = useMetrics({ agentId, windowSec: windowSec || 86400, intervalSec: 3600 });
  const points = (data?.points || []).map((p) => ({ t: new Date(p.bucket).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }), traces: p.trace_count, errors: p.error_count, cost: p.total_cost, p95: p.p95_latency_ms }));
  if (isLoading) return <div className="h-64 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;
  if (points.length === 0) return <Card><EmptyState icon={LineChart} title="No metrics in this window">Send more traffic for this agent to see throughput, latency, and cost trends.</EmptyState></Card>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <MetricChart title="Throughput" data={points} dataKey="traces" color="#6366f1" />
      <MetricChart title="Errors" data={points} dataKey="errors" color="#ef4444" />
      <MetricChart title="p95 latency (ms)" data={points} dataKey="p95" color="#f59e0b" />
      <MetricChart title="Cost ($)" data={points} dataKey="cost" color="#10b981" />
    </div>
  );
}
function MetricChart({ title, data, dataKey, color }: { title: string; data: any[]; dataKey: string; color: string }) {
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <XAxis dataKey="t" tick={{ fontSize: 10 }} hide={data.length > 12} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey={dataKey} stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function EvaluationTab({ agentId }: { agentId: string }) {
  const oh = useOrgHref();
  const canEval = usePlanFeature("evaluation"); // Pro+; skip the doomed request on lower plans
  const { data } = useEvalRuns(undefined, canEval);
  const runs = (data?.runs || []).slice(0, 10);
  const pct = (score: number) => (score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2));
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Recent evaluation runs</h2>
        <Link href={oh("/evaluations")} className="text-xs text-splyntra-600 hover:underline">Open Evaluation →</Link>
      </div>
      {!canEval ? (
        <EmptyState icon={ClipboardCheck} title="Evaluation is a Pro feature">Datasets, scorers, and CI regression gates are available on Pro and above.</EmptyState>
      ) : runs.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No evaluation runs yet">Create a dataset and run scorers against {agentId}’s traces in the Evaluation section.</EmptyState>
      ) : (
        <ul className="-my-1 divide-y divide-gray-100 dark:divide-gray-800">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={oh("/evaluations")} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-900/40">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.passed ? "success" : "danger"}>{r.passed ? "passed" : "failed"}</Badge>
                    {r.regression && <Badge tone="warning">regression</Badge>}
                    <span className="font-mono text-xs text-gray-500">run {r.id.slice(0, 8)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-400">{r.item_count.toLocaleString()} items · {formatRelativeTime(r.created_at)}</div>
                </div>
                <span className="shrink-0 text-base font-semibold tabular-nums text-gray-900 dark:text-white">{pct(r.score)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConfigTab({ agentId }: { agentId: string }) {
  const oh = useOrgHref();
  const { data: profile, isLoading, isError } = useAgentProfile(agentId);
  if (isLoading) return <div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;
  if (isError || !profile) {
    return (
      <Card>
        <EmptyState icon={Settings} title="This agent has no saved configuration">
          It was auto-discovered from traces. Create a managed profile (frameworks, providers, security, alerts) with the Connect wizard.
          <div className="mt-3"><Link href={oh("/agents/new")} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-gray-900"><Plus className="h-4 w-4" /> Connect wizard</Link></div>
        </EmptyState>
      </Card>
    );
  }
  const row = (label: string, icon: typeof Bot, items: string[]) => {
    const Icon = icon;
    return (
      <div className="flex items-start gap-3 py-3">
        <Icon className="mt-0.5 h-4 w-4 text-gray-400" />
        <div><div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">{items.length ? items.map((x) => <Badge key={x} tone="neutral">{x}</Badge>) : <span className="text-sm text-gray-400">none</span>}</div>
        </div>
      </div>
    );
  };
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Configuration</h2>
        <Link href={oh("/agents/new")} className="text-xs text-splyntra-600 hover:underline">Reconfigure →</Link>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {row("Frameworks", Boxes, profile.frameworks)}
        {row("LLM providers", Sparkles, profile.providers)}
        {row("Vector / DB", Database, [...profile.vectordbs, ...profile.databases])}
        {row("Detectors", ShieldAlert, (profile.detectors || []).map((d) => DETECTOR_LABEL[d] || d))}
        <div className="flex items-center gap-3 py-3"><ShieldCheck className="h-4 w-4 text-gray-400" /><div><div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Guardrail mode</div><Badge tone={profile.guard_mode === "block" ? "success" : "neutral"}>{profile.guard_mode}</Badge></div></div>
        <div className="flex items-center gap-3 py-3"><Bell className="h-4 w-4 text-gray-400" /><div><div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Alerts</div><Badge tone={profile.alerts_enabled ? "success" : "muted"}>{profile.alerts_enabled ? "enabled" : "disabled"}</Badge></div></div>
      </div>
    </Card>
  );
}
