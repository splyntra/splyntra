// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useCosts } from "@/lib/hooks";
import { CostModelItem, ProjectCostItem, WorkflowCostItem, SourceScope } from "@/lib/api";
import { DollarSign, Coins, Hash, Calculator } from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/primitives";
import { SourceFilter } from "@/components/ui/SourceFilter";
import { SearchInput } from "@/components/ui/SearchInput";
import { useTableControls, SortableTh, TablePagination } from "@/components/ui/DataTable";
import { ExportButton } from "@/components/ui/ExportButton";
import { BudgetsSection } from "./BudgetsSection";
import { PricingEditor } from "./PricingEditor";

export default function CostsPage() {
  const [source, setSource] = useState<"" | SourceScope>("");
  const { data, isLoading, error } = useCosts({ source: source || undefined });

  const models: CostModelItem[] = data?.models || [];
  const mtc = useTableControls(models, {
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
    pageSize: 10,
  });
  const byProject: ProjectCostItem[] = data?.by_project || [];
  const byWorkflow: WorkflowCostItem[] = data?.by_workflow || [];
  const summary = data?.summary || { total_cost: 0, total_calls: 0, total_tokens: 0, avg_cost_per_call: 0 };
  const hasRealData = !error && models.length > 0;

  const totalCost = summary.total_cost;
  const totalCalls = summary.total_calls;
  const totalTokens = summary.total_tokens;
  const avgCostPerCall = totalCalls > 0 ? summary.avg_cost_per_call : 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        icon={DollarSign}
        title="Costs"
        subtitle="Token spend by run, model, and project"
        action={<SourceFilter value={source} onChange={setSource} size="md" />}
      />
      {!hasRealData && !isLoading && (
        <p className="-mt-2 mb-4 text-xs text-amber-600">
          No cost data yet — send LLM traces with model info to see cost breakdown.
        </p>
      )}

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Spend" value={`$${totalCost.toFixed(2)}`} icon={DollarSign} />
        <StatCard label="Total Tokens" value={totalTokens.toLocaleString()} icon={Coins} />
        <StatCard label="LLM Calls" value={totalCalls.toLocaleString()} icon={Hash} />
        <StatCard label="Avg Cost/Call" value={`$${avgCostPerCall.toFixed(4)}`} icon={Calculator} />
      </div>

      {/* Budgets + forecasting */}
      <BudgetsSection />

      {/* Per-project breakdown */}
      {byProject.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
            Cost by Project
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {byProject.map((p) => (
              <div
                key={p.project_id}
                className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="text-xs font-medium font-mono truncate" title={p.project_id}>
                  {p.project_id}
                </div>
                <div className="text-xl font-bold mt-1">${p.total_cost.toFixed(4)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {p.call_count.toLocaleString()} calls · {p.total_tokens.toLocaleString()} tokens
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-workflow breakdown */}
      {byWorkflow.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
            Cost by Workflow
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {byWorkflow.map((wf) => (
              <div
                key={wf.workflow_id}
                className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="truncate text-xs font-medium font-mono" title={wf.workflow_id}>
                  {wf.workflow_id}
                </div>
                <div className="mt-1 text-xl font-bold">${wf.total_cost.toFixed(4)}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {wf.call_count.toLocaleString()} runs · {wf.total_tokens.toLocaleString()} tokens
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model breakdown */}
      {models.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
            Cost by Model
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {models.map((m) => (
              <div
                key={m.model}
                className="bg-white dark:bg-gray-900 rounded-lg border p-4"
              >
                <div className="text-sm font-medium font-mono">{m.model}</div>
                <div className="text-xl font-bold mt-1">${m.total_cost.toFixed(4)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {m.call_count.toLocaleString()} calls ·{" "}
                  {(m.total_prompt_tokens + m.total_completion_tokens).toLocaleString()} tokens
                </div>
                <div className="mt-2 h-2 bg-gray-100 dark:bg-gray-800 rounded">
                  <div
                    className="h-full bg-splyntra-500 rounded"
                    style={{ width: `${totalCost > 0 ? (m.total_cost / totalCost) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed table */}
      {models.length > 0 && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Cost detail by model</h2>
          <div className="flex items-center gap-2">
            <SearchInput value={mtc.q} onChange={mtc.setQ} placeholder="Search models…" className="max-w-xs" />
            <ExportButton rows={mtc.filtered} filename="costs-by-model" sheetName="Cost by model" columns={[
              { header: "Model", value: (m: CostModelItem) => m.model },
              { header: "Calls", value: (m: CostModelItem) => m.call_count },
              { header: "Prompt Tokens", value: (m: CostModelItem) => m.total_prompt_tokens },
              { header: "Completion Tokens", value: (m: CostModelItem) => m.total_completion_tokens },
              { header: "Total Cost (USD)", value: (m: CostModelItem) => m.total_cost },
              { header: "Avg/Call (USD)", value: (m: CostModelItem) => m.avg_cost_per_call },
            ]} />
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-gray-900 rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading costs...</div>
        ) : models.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No LLM usage data yet. Send traces with model information to see cost analytics.
          </div>
        ) : mtc.total === 0 ? (
          <div className="p-8 text-center text-gray-500">No models match your search.</div>
        ) : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b">
              <tr>
                <SortableTh label="Model" sortKey="model" sort={mtc.sort} onSort={mtc.toggleSort} />
                <SortableTh label="Calls" sortKey="calls" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                <SortableTh label="Prompt Tokens" sortKey="prompt" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                <SortableTh label="Completion Tokens" sortKey="completion" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                <SortableTh label="Total Cost" sortKey="cost" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
                <SortableTh label="Avg/Call" sortKey="avg" sort={mtc.sort} onSort={mtc.toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {mtc.view.map((m) => (
                <tr key={m.model} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium font-mono text-xs">{m.model}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {m.call_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {m.total_prompt_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {m.total_completion_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ${m.total_cost.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    ${m.avg_cost_per_call.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-800 border-t font-medium">
              <tr>
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right">{totalCalls.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  {models.reduce((s, m) => s + m.total_prompt_tokens, 0).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {models.reduce((s, m) => s + m.total_completion_tokens, 0).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">${totalCost.toFixed(4)}</td>
                <td className="px-4 py-3 text-right">${avgCostPerCall.toFixed(4)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
          <TablePagination page={mtc.page} pageCount={mtc.pageCount} pageSize={mtc.pageSize} total={mtc.total} onPage={mtc.setPage} onPageSize={mtc.setPageSize} unit="model" />
          </>
        )}
      </div>

      {/* Unpriced-model callout + model price editor (admin) */}
      <PricingEditor />
    </div>
  );
}
