// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState } from "react";
import { useCosts } from "@/lib/hooks";
import { CostModelItem, ProjectCostItem, WorkflowCostItem, SourceScope } from "@/lib/api";
import {
  DollarSign,
  Coins,
  Hash,
  Calculator,
  Layers,
  Cpu,
  FolderGit2,
  Workflow,
  Sparkles,
  TrendingUp,
  BarChart3,
  Search,
} from "lucide-react";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { SourceFilter } from "@/components/ui/SourceFilter";
import { SearchInput } from "@/components/ui/SearchInput";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { BudgetsSection } from "./BudgetsSection";
import { PricingEditor } from "./PricingEditor";

type BreakdownTab = "models" | "projects" | "workflows";

// Color palette for top spend distribution bars
const SPEND_PALETTE = [
  "bg-zinc-800 dark:bg-zinc-200",
  "bg-zinc-600 dark:bg-zinc-400",
  "bg-emerald-600 dark:bg-emerald-400",
  "bg-amber-600 dark:bg-amber-400",
  "bg-indigo-600 dark:bg-indigo-400",
  "bg-sky-600 dark:bg-sky-400",
  "bg-rose-600 dark:bg-rose-400",
  "bg-purple-600 dark:bg-purple-400",
];

function detectProvider(model: string): { label: string; tone: "brand" | "neutral" | "success" | "warning" | "danger" } {
  const m = model.toLowerCase();
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("text-embedding") || m.includes("openai")) {
    return { label: "OpenAI", tone: "brand" };
  }
  if (m.startsWith("claude") || m.includes("anthropic")) {
    return { label: "Anthropic", tone: "warning" };
  }
  if (m.startsWith("gemini") || m.includes("google")) {
    return { label: "Google", tone: "brand" };
  }
  if (m.startsWith("deepseek")) {
    return { label: "DeepSeek", tone: "neutral" };
  }
  if (m.includes("llama") || m.startsWith("meta")) {
    return { label: "Meta", tone: "brand" };
  }
  if (m.startsWith("mistral") || m.startsWith("codestral") || m.startsWith("mixtral")) {
    return { label: "Mistral", tone: "warning" };
  }
  return { label: "Model", tone: "neutral" };
}

function fmtUSD(val: number, decimals = 4): string {
  if (!Number.isFinite(val) || val === 0) return "$0.00";
  if (val >= 100) return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 1) return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return `$${val.toFixed(decimals)}`;
}

function fmtCompactNum(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export default function CostsPage() {
  const [source, setSource] = useState<"" | SourceScope>("");
  const [activeTab, setActiveTab] = useState<BreakdownTab>("models");
  const { data, isLoading, error } = useCosts({ source: source || undefined });

  const models: CostModelItem[] = useMemo(() => data?.models || [], [data?.models]);
  const byProject: ProjectCostItem[] = useMemo(() => data?.by_project || [], [data?.by_project]);
  const byWorkflow: WorkflowCostItem[] = useMemo(() => data?.by_workflow || [], [data?.by_workflow]);
  const summary = data?.summary || { total_cost: 0, total_calls: 0, total_tokens: 0, avg_cost_per_call: 0 };

  const totalCost = summary.total_cost;
  const totalCalls = summary.total_calls;
  const totalTokens = summary.total_tokens;
  const avgCostPerCall = totalCalls > 0 ? summary.avg_cost_per_call : 0;

  const totalPromptTokens = useMemo(() => models.reduce((s, m) => s + m.total_prompt_tokens, 0), [models]);
  const totalCompletionTokens = useMemo(() => models.reduce((s, m) => s + m.total_completion_tokens, 0), [models]);
  const promptPct = totalTokens > 0 ? Math.round((totalPromptTokens / totalTokens) * 100) : 0;
  const completionPct = totalTokens > 0 ? Math.round((totalCompletionTokens / totalTokens) * 100) : 0;

  const mtc = useTableControls(models, {
    searchText: (m) => m.model,
    sortAccessors: {
      model: (m) => m.model.toLowerCase(),
      calls: (m) => m.call_count,
      prompt: (m) => m.total_prompt_tokens,
      completion: (m) => m.total_completion_tokens,
      tokens: (m) => m.total_prompt_tokens + m.total_completion_tokens,
      cost: (m) => m.total_cost,
      avg: (m) => m.avg_cost_per_call,
    },
    initialSort: { key: "cost", dir: "desc" },
    pageSize: 10,
  });

  const hasRealData = !error && models.length > 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Header */}
      <PageHeader
        icon={DollarSign}
        title="Costs & Token Spend"
        subtitle="Token usage and spend analytics across models, projects, and platform workflows"
        action={
          <div className="flex items-center gap-3">
            <SourceFilter value={source} onChange={setSource} size="md" />
          </div>
        }
      />

      {/* Info notice when empty */}
      {!hasRealData && !isLoading && (
        <Card className="mb-6 border-blue-200 bg-blue-50/60 p-4 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20">
          <div className="flex items-center gap-3 text-xs text-blue-800 dark:text-blue-200">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <span>
              No cost data recorded yet for this view. Ingest LLM traces with model information to unlock comprehensive cost analytics and spend tracking.
            </span>
          </div>
        </Card>
      )}

      {/* Primary KPI Summary Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Spend */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Total Spend
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {fmtUSD(totalCost, 2)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {models.length} {models.length === 1 ? "model" : "models"}
            </span>
            <span>active</span>
          </div>
        </Card>

        {/* Total Tokens */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Total Tokens
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {fmtCompactNum(totalTokens)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{promptPct}% prompt</span>
            <span>·</span>
            <span>{completionPct}% completion</span>
          </div>
        </Card>

        {/* LLM Invocations */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              LLM Calls
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
              <Hash className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {totalCalls.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {totalCalls > 0 ? `${Math.round(totalTokens / totalCalls).toLocaleString()} avg tokens/call` : "0 avg tokens/call"}
          </div>
        </Card>

        {/* Avg Cost per Call */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Avg Cost / Call
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
              <Calculator className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {fmtUSD(avgCostPerCall, 5)}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {totalTokens > 0
              ? `${fmtUSD((totalCost / totalTokens) * 1000, 4)} / 1K tokens`
              : "$0.00 / 1K tokens"}
          </div>
        </Card>
      </div>

      {/* Budgets & Forecasting Section */}
      <BudgetsSection />

      {/* Dimension Breakdown Section */}
      {(models.length > 0 || byProject.length > 0 || byWorkflow.length > 0) && (
        <div className="mb-8">
          {/* Section Header & Segmented Tabs */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <BarChart3 className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Spend Distribution
              </h2>
            </div>

            <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50/80 p-0.5 dark:border-gray-800 dark:bg-gray-900">
              <button
                onClick={() => setActiveTab("models")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  activeTab === "models"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                <Cpu className="h-3.5 w-3.5" />
                By Model ({models.length})
              </button>

              {byProject.length > 0 && (
                <button
                  onClick={() => setActiveTab("projects")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
                    activeTab === "projects"
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  <FolderGit2 className="h-3.5 w-3.5" />
                  By Project ({byProject.length})
                </button>
              )}

              {byWorkflow.length > 0 && (
                <button
                  onClick={() => setActiveTab("workflows")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
                    activeTab === "workflows"
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  <Workflow className="h-3.5 w-3.5" />
                  By Workflow ({byWorkflow.length})
                </button>
              )}
            </div>
          </div>

          {/* Proportional Spend Meter across Top Drivers */}
          {totalCost > 0 && (
            <Card className="mb-4 p-4">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {activeTab === "models" ? "Model" : activeTab === "projects" ? "Project" : "Workflow"} Share of Total Spend
                </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {fmtUSD(totalCost, 2)} total
                </span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                {(activeTab === "models" ? models : activeTab === "projects" ? byProject : byWorkflow).map(
                  (item: any, i) => {
                    const cost = item.total_cost;
                    const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
                    if (pct < 0.5) return null;
                    const color = SPEND_PALETTE[i % SPEND_PALETTE.length];
                    const label = item.model || item.project_id || item.workflow_id;
                    return (
                      <div
                        key={label}
                        className={`h-full transition-all duration-300 ${color}`}
                        style={{ width: `${pct}%` }}
                        title={`${label}: ${fmtUSD(cost)} (${pct.toFixed(1)}%)`}
                      />
                    );
                  }
                )}
              </div>
            </Card>
          )}

          {/* Breakdown Cards Grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeTab === "models" &&
              models.map((m, index) => {
                const pct = totalCost > 0 ? (m.total_cost / totalCost) * 100 : 0;
                const provider = detectProvider(m.model);
                const tokens = m.total_prompt_tokens + m.total_completion_tokens;
                return (
                  <Card
                    key={m.model}
                    className="p-5 transition-all duration-200 hover:border-gray-300 hover:shadow-card-hover dark:hover:border-gray-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            #{index + 1}
                          </span>
                          <span className="truncate font-mono text-xs font-semibold text-gray-900 dark:text-white" title={m.model}>
                            {m.model}
                          </span>
                        </div>
                        <div className="mt-1">
                          <Badge tone={provider.tone} className="text-[10px] normal-case tracking-normal">
                            {provider.label}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                          {fmtUSD(m.total_cost, 4)}
                        </div>
                        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                          {pct.toFixed(1)}% of spend
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar for Share of Spend */}
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-gray-900 dark:bg-white"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>

                    {/* Usage Sub-metrics */}
                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      <span>{m.call_count.toLocaleString()} calls</span>
                      <span>{fmtCompactNum(tokens)} tokens</span>
                      <span>{fmtUSD(m.avg_cost_per_call, 4)}/call</span>
                    </div>
                  </Card>
                );
              })}

            {activeTab === "projects" &&
              byProject.map((p, index) => {
                const pct = totalCost > 0 ? (p.total_cost / totalCost) * 100 : 0;
                return (
                  <Card
                    key={p.project_id}
                    className="p-5 transition-all duration-200 hover:border-gray-300 hover:shadow-card-hover dark:hover:border-gray-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            #{index + 1}
                          </span>
                          <span className="truncate font-mono text-xs font-semibold text-gray-900 dark:text-white" title={p.project_id}>
                            {p.project_id}
                          </span>
                        </div>
                        <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          Project Scope
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                          {fmtUSD(p.total_cost, 4)}
                        </div>
                        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                          {pct.toFixed(1)}% of spend
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-gray-900 dark:bg-white"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      <span>{p.call_count.toLocaleString()} calls</span>
                      <span>{fmtCompactNum(p.total_tokens)} tokens</span>
                      <span>{p.call_count > 0 ? fmtUSD(p.total_cost / p.call_count, 4) : "$0"}/call</span>
                    </div>
                  </Card>
                );
              })}

            {activeTab === "workflows" &&
              byWorkflow.map((wf, index) => {
                const pct = totalCost > 0 ? (wf.total_cost / totalCost) * 100 : 0;
                return (
                  <Card
                    key={wf.workflow_id}
                    className="p-5 transition-all duration-200 hover:border-gray-300 hover:shadow-card-hover dark:hover:border-gray-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            #{index + 1}
                          </span>
                          <span className="truncate font-mono text-xs font-semibold text-gray-900 dark:text-white" title={wf.workflow_id}>
                            {wf.workflow_id}
                          </span>
                        </div>
                        <span className="mt-1 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                          Workflow Pipeline
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                          {fmtUSD(wf.total_cost, 4)}
                        </div>
                        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                          {pct.toFixed(1)}% of spend
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      <span>{wf.call_count.toLocaleString()} runs</span>
                      <span>{fmtCompactNum(wf.total_tokens)} tokens</span>
                      <span>{wf.call_count > 0 ? fmtUSD(wf.total_cost / wf.call_count, 4) : "$0"}/run</span>
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>
      )}

      {/* Model Cost Detail Table */}
      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Model Usage & Cost Ledger
            </h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {models.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <SearchInput
              value={mtc.q}
              onChange={mtc.setQ}
              placeholder="Search models…"
              className="w-48 sm:w-64"
            />
            <ExportButton
              rows={mtc.filtered}
              filename="splyntra-costs-by-model"
              sheetName="Model Costs"
              columns={[
                { header: "Model", value: (m: CostModelItem) => m.model },
                { header: "Calls", value: (m: CostModelItem) => m.call_count },
                { header: "Prompt Tokens", value: (m: CostModelItem) => m.total_prompt_tokens },
                { header: "Completion Tokens", value: (m: CostModelItem) => m.total_completion_tokens },
                { header: "Total Tokens", value: (m: CostModelItem) => m.total_prompt_tokens + m.total_completion_tokens },
                { header: "Total Cost (USD)", value: (m: CostModelItem) => m.total_cost },
                { header: "Avg Cost / Call (USD)", value: (m: CostModelItem) => m.avg_cost_per_call },
              ]}
            />
          </div>
        </div>

        <Card className="overflow-hidden border-gray-200/80 shadow-card dark:border-gray-800">
          {isLoading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : models.length === 0 ? (
            <div className="p-12 text-center text-xs text-gray-500 dark:text-gray-400">
              No LLM usage records found. Send traces with model attributes to populate this breakdown.
            </div>
          ) : mtc.total === 0 ? (
            <div className="p-12 text-center text-xs text-gray-500 dark:text-gray-400">
              No models match your search query &quot;{mtc.q}&quot;.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/75 dark:border-gray-800 dark:bg-gray-900/50">
                    <tr>
                      <SortableTh label="Model Identifier" sortKey="model" sort={mtc.sort} onSort={mtc.toggleSort} />
                      <SortableTh label="Calls" sortKey="calls" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                      <SortableTh label="Prompt Tokens" sortKey="prompt" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                      <SortableTh label="Completion Tokens" sortKey="completion" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                      <SortableTh label="Total Tokens" sortKey="tokens" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                      <SortableTh label="Total Spend" sortKey="cost" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                      <SortableTh label="Avg / Call" sortKey="avg" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {mtc.view.map((m) => {
                      const tokens = m.total_prompt_tokens + m.total_completion_tokens;
                      const pPct = tokens > 0 ? (m.total_prompt_tokens / tokens) * 100 : 0;
                      const provider = detectProvider(m.model);
                      return (
                        <tr
                          key={m.model}
                          className="transition-colors hover:bg-gray-50/60 dark:hover:bg-gray-900/30"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">
                                {m.model}
                              </span>
                              <Badge tone={provider.tone} className="text-[10px] normal-case tracking-normal">
                                {provider.label}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-600 dark:text-gray-400">
                            {m.call_count.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-600 dark:text-gray-400">
                            {m.total_prompt_tokens.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-600 dark:text-gray-400">
                            {m.total_completion_tokens.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex flex-col items-end">
                              <span className="font-mono text-xs font-medium tabular-nums text-gray-900 dark:text-white">
                                {tokens.toLocaleString()}
                              </span>
                              {tokens > 0 && (
                                <div className="mt-1 flex h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                                  <div
                                    className="bg-indigo-500"
                                    style={{ width: `${pPct}%` }}
                                    title={`Prompt: ${pPct.toFixed(0)}%`}
                                  />
                                  <div
                                    className="bg-emerald-500"
                                    style={{ width: `${100 - pPct}%` }}
                                    title={`Completion: ${(100 - pPct).toFixed(0)}%`}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                              {fmtUSD(m.total_cost, 4)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-600 dark:text-gray-400">
                            {fmtUSD(m.avg_cost_per_call, 5)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-gray-200 bg-gray-50/80 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900/60 dark:text-white">
                    <tr>
                      <td className="px-4 py-3">Total Summary</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{totalCalls.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{totalPromptTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{totalCompletionTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{totalTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-sm font-bold text-gray-900 dark:text-white">
                        {fmtUSD(totalCost, 4)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{fmtUSD(avgCostPerCall, 5)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <TablePagination
                page={mtc.page}
                pageCount={mtc.pageCount}
                pageSize={mtc.pageSize}
                total={mtc.total}
                onPage={mtc.setPage}
                onPageSize={mtc.setPageSize}
                unit="model"
              />
            </>
          )}
        </Card>
      </div>

      {/* Model Pricing Directory */}
      <PricingEditor />
    </div>
  );
}
