// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBudgets, useProjects } from "@/lib/hooks";
import { upsertBudget, deleteBudget } from "@/lib/api";
import { Wallet, Plus, Trash2, TrendingUp, AlertTriangle, CheckCircle2, ShieldAlert, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";

const INPUT_CONTAINER =
  "flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-all focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 dark:border-gray-700 dark:bg-gray-800/90 dark:focus-within:border-gray-600 dark:focus-within:ring-gray-800";

function getBudgetTone(pct: number): {
  barClass: string;
  badgeTone: "success" | "warning" | "danger";
  statusText: string;
  icon: typeof CheckCircle2;
} {
  if (pct >= 100) {
    return {
      barClass: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
      badgeTone: "danger",
      statusText: "Exceeded",
      icon: ShieldAlert,
    };
  }
  if (pct >= 80) {
    return {
      barClass: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]",
      badgeTone: "warning",
      statusText: "Near Limit",
      icon: AlertTriangle,
    };
  }
  return {
    barClass: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]",
    badgeTone: "success",
    statusText: "On Track",
    icon: CheckCircle2,
  };
}

export function BudgetsSection() {
  const { data } = useBudgets();
  const { data: projectsData } = useProjects();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [projectId, setProjectId] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const budgets = data?.budgets || [];
  const projects = projectsData?.projects || [];
  const projName = (id: string) => (id ? projects.find((p) => p.id === id)?.name || "Project" : "Org-wide");
  const refresh = () => qc.invalidateQueries({ queryKey: ["budgets"] });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = parseFloat(limit);
    if (!(v > 0)) return;
    setBusy(true);
    try {
      await upsertBudget({ project_id: projectId || undefined, monthly_limit_usd: v });
      setLimit("");
      setProjectId("");
      setShowAddForm(false);
      refresh();
      toast.success("Budget limit saved.");
    } catch {
      toast.error("Couldn’t save the budget limit.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const b = budgets.find((x) => x.id === id);
    const ok = await confirm({
      title: "Remove this budget limit?",
      description: `The ${b ? projName(b.project_id) : "selected"} monthly spend limit will no longer be tracked or alerted on.`,
      confirmText: "Remove budget",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteBudget(id);
      refresh();
      toast.success("Budget removed.");
    } catch {
      toast.error("Couldn’t remove the budget.");
    }
  }

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Monthly Budgets & Forecasts</h2>
          </div>
          <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {budgets.length}
          </span>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-750"
          >
            <Plus className="h-3.5 w-3.5" />
            Set Budget
          </button>
        )}
      </div>

      <Card className="overflow-hidden border-gray-200/80 dark:border-gray-800">
        {budgets.length === 0 && !showAddForm ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gray-50 text-gray-400 ring-1 ring-gray-200/60 dark:bg-gray-800/50 dark:ring-gray-700/60">
              <Wallet className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">No active spend budgets</p>
            <p className="mt-1 max-w-sm text-xs text-gray-500 dark:text-gray-400">
              Set monthly budget caps across all LLM traces or for specific projects to track spend thresholds and prevent cost overruns.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <Plus className="h-3.5 w-3.5" /> Set Monthly Budget
            </button>
          </div>
        ) : (
          budgets.length > 0 && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {budgets.map((b) => {
                const pct = Math.min(b.pct_used, 100);
                const isOverForecast = b.forecast_usd > b.monthly_limit_usd;
                const remaining = Math.max(0, b.monthly_limit_usd - b.spent_usd);
                const { barClass, badgeTone, statusText, icon: StatusIcon } = getBudgetTone(b.pct_used);

                return (
                  <div key={b.id} className="p-5 transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-900/30">
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">
                          {projName(b.project_id)}
                        </span>
                        <Badge tone={badgeTone} className="normal-case tracking-normal text-[11px] font-medium">
                          <StatusIcon className="h-3 w-3 mr-0.5" />
                          {statusText} ({b.pct_used.toFixed(0)}%)
                        </Badge>
                        {b.project_id ? (
                          <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">
                            {b.project_id}
                          </span>
                        ) : (
                          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            All Projects
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white">
                            ${b.spent_usd.toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium ml-1">
                            / ${b.monthly_limit_usd.toFixed(2)}
                          </span>
                        </div>
                        <button
                          onClick={() => remove(b.id)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          title="Remove budget"
                          aria-label="Remove budget"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Track */}
                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {/* Footer Info & Forecasting */}
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                        <span>
                          <strong className="font-medium text-gray-700 dark:text-gray-300">
                            ${remaining.toFixed(2)}
                          </strong>{" "}
                          remaining this month
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            isOverForecast
                              ? "text-red-600 dark:text-red-400"
                              : "text-gray-600 dark:text-gray-300"
                          }`}
                        >
                          <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
                          Projected Run Rate: ${b.forecast_usd.toFixed(2)}
                        </span>
                        {isOverForecast && (
                          <span className="rounded bg-red-100 px-1.5 py-0.2 text-[10px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                            May exceed limit
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Add/Edit Budget Form */}
        {showAddForm && (
          <form
            onSubmit={save}
            className="border-t border-gray-100 bg-gray-50/70 p-4 transition-all dark:border-gray-800 dark:bg-gray-900/60"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Set Monthly Spend Limit
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setLimit("");
                }}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[180px] flex-1">
                <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Target Scope</span>
                <Select
                  value={projectId}
                  onValueChange={setProjectId}
                  ariaLabel="Budget scope"
                  className="w-full"
                  options={[
                    { value: "", label: "Org-wide (All Projects)" },
                    ...projects.filter((p) => !p.archived_at).map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </label>

              <label className="w-48">
                <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Monthly Limit (USD)
                </span>
                <div className={INPUT_CONTAINER}>
                  <span className="mr-1.5 font-medium text-gray-400 dark:text-gray-500">$</span>
                  <input
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="250.00"
                    className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-gray-400 text-gray-900 dark:text-white"
                  />
                </div>
              </label>

              <div className="flex items-center gap-1.5">
                {["50", "250", "1000"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setLimit(preset)}
                    className="hidden sm:inline-block rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    ${preset}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                disabled={busy || !(parseFloat(limit) > 0)}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                <Plus className="h-4 w-4" /> {busy ? "Saving…" : "Save Budget"}
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
