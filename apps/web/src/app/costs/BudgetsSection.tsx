// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBudgets, useProjects } from "@/lib/hooks";
import { upsertBudget, deleteBudget } from "@/lib/api";
import { Wallet, Plus, Trash2, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";

const INPUT =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800";

function barColor(pct: number): string {
  if (pct >= 100) return "bg-red-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-emerald-500";
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
      refresh();
      toast.success("Budget saved.");
    } catch {
      toast.error("Couldn’t save the budget.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const b = budgets.find((x) => x.id === id);
    const ok = await confirm({
      title: "Remove this budget?",
      description: `The ${b ? projName(b.project_id) : "selected"} spend limit will no longer be tracked or alerted on.`,
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
    <div className="mb-6">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-gray-500">
        <Wallet className="h-4 w-4" /> Budgets
      </h2>
      <Card className="overflow-hidden">
        {budgets.length > 0 && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {budgets.map((b) => {
              const pct = Math.min(b.pct_used, 100);
              const over = b.forecast_usd > b.monthly_limit_usd;
              return (
                <div key={b.id} className="px-5 py-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{projName(b.project_id)}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm tabular-nums text-gray-600 dark:text-gray-300">
                        ${b.spent_usd.toFixed(2)} <span className="text-gray-400">/ ${b.monthly_limit_usd.toFixed(2)}</span>
                      </span>
                      <button onClick={() => remove(b.id)} className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" title="Remove budget">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className={`h-full rounded-full ${barColor(b.pct_used)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className={`font-medium ${b.pct_used >= 100 ? "text-red-600" : b.pct_used >= 80 ? "text-amber-600" : "text-gray-500"}`}>
                      {b.pct_used.toFixed(0)}% used this month
                    </span>
                    <span className={`inline-flex items-center gap-1 ${over ? "text-red-600" : "text-gray-500"}`}>
                      <TrendingUp className="h-3 w-3" /> Forecast ${b.forecast_usd.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <form onSubmit={save} className="flex flex-wrap items-end gap-3 border-t border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
          <label className="min-w-[160px] flex-1">
            <span className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Scope</span>
            <Select
              value={projectId}
              onValueChange={setProjectId}
              ariaLabel="Budget scope"
              className="w-full"
              options={[
                { value: "", label: "Org-wide" },
                ...projects.filter((p) => !p.archived_at).map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </label>
          <label className="min-w-[140px]">
            <span className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Monthly limit (USD)</span>
            <input value={limit} onChange={(e) => setLimit(e.target.value)} type="number" min="0" step="0.01" placeholder="500.00" className={`${INPUT} w-full`} />
          </label>
          <button disabled={busy || !(parseFloat(limit) > 0)} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
            <Plus className="h-4 w-4" /> {busy ? "Saving…" : "Set budget"}
          </button>
        </form>
      </Card>
    </div>
  );
}
