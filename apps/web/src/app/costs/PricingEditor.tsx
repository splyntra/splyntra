// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePricing } from "@/lib/hooks";
import { upsertPricing, deletePricing } from "@/lib/api";
import { Tag, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { useTableControls, TablePagination } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const INPUT =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800";

export function PricingEditor() {
  const { data } = usePricing();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [completion, setCompletion] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const prices = data?.prices || [];
  const unpriced = data?.unpriced || [];
  const ptc = useTableControls(prices, { pageSize: 10, sortAccessors: { model: (p) => p.model.toLowerCase() } });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pricing"] });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const p = parseFloat(prompt);
    const c = parseFloat(completion);
    if (!model.trim() || !(p >= 0) || !(c >= 0)) {
      setErr("Model + non-negative prices required.");
      return;
    }
    setBusy(true);
    try {
      await upsertPricing({ model: model.trim(), prompt_per_1k: p, completion_per_1k: c });
      setModel(""); setPrompt(""); setCompletion("");
      refresh();
      toast.success("Model price saved.");
    } catch (e: any) {
      setErr(e?.message || "Save failed (admin scope required).");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: string) {
    const ok = await confirm({
      title: "Delete this model price?",
      description: (
        <>
          <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{m}</span> will have no price —
          new traces for it will record $0 spend until you add one again.
        </>
      ),
      confirmText: "Delete price",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deletePricing(m);
      refresh();
      toast.success("Model price deleted.");
    } catch {
      toast.error("Couldn’t delete the price.");
    }
  }

  function prefill(m: string) {
    setModel(m); setPrompt(""); setCompletion(""); setOpen(true);
  }

  return (
    <div className="mt-8">
      {/* Unpriced callout — always visible so understated spend is never hidden. */}
      {unpriced.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-medium">{unpriced.length} model{unpriced.length === 1 ? "" : "s"} seen without a price — their spend is recorded as $0.</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {unpriced.map((m) => (
                  <button key={m} onClick={() => prefill(m)} className="rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-amber-700 underline-offset-2 hover:underline dark:bg-gray-900 dark:text-amber-400">
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Tag className="h-4 w-4" /> Manage model pricing ({prices.length})
      </button>

      {open && (
        <Card className="mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
                  <th className="text-left">Model</th>
                  <th className="text-right">Prompt /1K</th>
                  <th className="text-right">Completion /1K</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {ptc.view.map((p) => (
                  <tr key={p.model} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-900 dark:text-white">{p.model}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">${p.prompt_per_1k}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">${p.completion_per_1k}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => { setModel(p.model); setPrompt(String(p.prompt_per_1k)); setCompletion(String(p.completion_per_1k)); }} className="mr-2 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white">Edit</button>
                      <button onClick={() => remove(p.model)} className="text-xs text-red-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={ptc.page} pageCount={ptc.pageCount} pageSize={ptc.pageSize} total={ptc.total} onPage={ptc.setPage} onPageSize={ptc.setPageSize} unit="model" />
          <form onSubmit={save} className="flex flex-wrap items-end gap-3 border-t border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
            <label className="min-w-[160px] flex-1">
              <span className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" className={`${INPUT} w-full font-mono`} />
            </label>
            <label className="min-w-[120px]">
              <span className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Prompt /1K</span>
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} type="number" min="0" step="0.00001" placeholder="0.005" className={`${INPUT} w-full`} />
            </label>
            <label className="min-w-[120px]">
              <span className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Completion /1K</span>
              <input value={completion} onChange={(e) => setCompletion(e.target.value)} type="number" min="0" step="0.00001" placeholder="0.015" className={`${INPUT} w-full`} />
            </label>
            <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
              <Plus className="h-4 w-4" /> {busy ? "Saving…" : "Save price"}
            </button>
            {err && <span className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3.5 w-3.5" />{err}</span>}
          </form>
          <p className="px-4 pb-3 text-[11px] text-gray-400">Prices apply to new traces immediately; historical rows keep the cost computed at ingest.</p>
        </Card>
      )}
    </div>
  );
}
