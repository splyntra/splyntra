// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCosts } from "@/lib/hooks";
import { CostModelItem, ProjectCostItem } from "@/lib/api";
import { DollarSign, Coins, Hash, Calculator } from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/primitives";

export default function CostsPage() {
  const { data, isLoading, error } = useCosts();

  const models: CostModelItem[] = data?.models || [];
  const byProject: ProjectCostItem[] = data?.by_project || [];
  const summary = data?.summary || { total_cost: 0, total_calls: 0, total_tokens: 0, avg_cost_per_call: 0 };
  const hasRealData = !error && models.length > 0;

  const totalCost = summary.total_cost;
  const totalCalls = summary.total_calls;
  const totalTokens = summary.total_tokens;
  const avgCostPerCall = totalCalls > 0 ? summary.avg_cost_per_call : 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader icon={DollarSign} title="Costs" subtitle="Token spend by run, model, and project" />
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
      <div className="bg-white dark:bg-gray-900 rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading costs...</div>
        ) : models.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No LLM usage data yet. Send traces with model information to see cost analytics.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Model</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Calls</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Prompt Tokens</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Completion Tokens</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Total Cost</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Avg/Call</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {models.map((m) => (
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
        )}
      </div>
    </div>
  );
}
