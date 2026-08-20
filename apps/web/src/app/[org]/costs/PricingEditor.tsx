// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePricing } from "@/lib/hooks";
import { upsertPricing, deletePricing } from "@/lib/api";
import { Tag, Plus, Pencil, Trash2, ChevronDown, ChevronRight, AlertTriangle, Search, Sparkles, Check, DollarSign } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { useTableControls, TablePagination } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const INPUT_CONTAINER =
  "flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-all focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus-within:border-gray-600 dark:focus-within:ring-gray-800";

function detectProvider(modelName: string): { label: string; tone: "brand" | "neutral" | "success" | "warning" | "danger" } {
  const m = modelName.toLowerCase();
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
  return { label: "Custom", tone: "neutral" };
}

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
  const ptc = useTableControls(prices, {
    pageSize: 10,
    searchText: (p) => p.model,
    sortAccessors: {
      model: (p) => p.model.toLowerCase(),
      prompt: (p) => p.prompt_per_1k,
      completion: (p) => p.completion_per_1k,
    },
    initialSort: { key: "model", dir: "asc" },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pricing"] });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const p = parseFloat(prompt);
    const c = parseFloat(completion);
    if (!model.trim() || !(p >= 0) || !(c >= 0)) {
      setErr("Model identifier and non-negative prices are required.");
      return;
    }
    setBusy(true);
    try {
      await upsertPricing({ model: model.trim(), prompt_per_1k: p, completion_per_1k: c });
      setModel("");
      setPrompt("");
      setCompletion("");
      refresh();
      toast.success(`Pricing saved for ${model.trim()}`);
    } catch (e: any) {
      setErr(e?.message || "Save failed (admin permissions required).");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: string) {
    const ok = await confirm({
      title: "Delete model pricing?",
      description: (
        <>
          <span className="font-mono font-medium text-gray-900 dark:text-white">{m}</span> will have no price configured.
          New spans for this model will record $0 spend until priced again.
        </>
      ),
      confirmText: "Delete Price",
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
    setModel(m);
    setPrompt("");
    setCompletion("");
    setOpen(true);
  }

  const prompt1M = parseFloat(prompt) > 0 ? (parseFloat(prompt) * 1000).toFixed(2) : null;
  const completion1M = parseFloat(completion) > 0 ? (parseFloat(completion) * 1000).toFixed(2) : null;

  return (
    <div className="mt-8">
      {/* Unpriced models notification banner */}
      {unpriced.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/70 p-4 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-start gap-3 text-sm text-amber-900 dark:text-amber-200">
            <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">
                {unpriced.length} model{unpriced.length === 1 ? "" : "s"} observed without configured pricing
              </p>
              <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300/80">
                Spans using these models are currently recorded with $0 spend. Click any model to configure its token rate:
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {unpriced.map((m) => (
                  <button
                    key={m}
                    onClick={() => prefill(m)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-300/60 bg-white px-2 py-1 font-mono text-xs font-medium text-amber-900 shadow-sm transition-all hover:bg-amber-100 hover:border-amber-400 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-300 dark:hover:bg-gray-800"
                  >
                    <Plus className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Accordion Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center justify-between rounded-xl border border-gray-200/80 bg-white px-5 py-3.5 shadow-card transition-all hover:border-gray-300 hover:bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-850"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <Tag className="h-4 w-4" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Model Token Pricing Directory
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Customize input and output token rates used for cost calculation
            </p>
          </div>
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {prices.length} {prices.length === 1 ? "rate" : "rates"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white">
          <span>{open ? "Collapse" : "Manage Rates"}</span>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {/* Accordion Body */}
      {open && (
        <Card className="mt-3 overflow-hidden border-gray-200/80 shadow-card dark:border-gray-800">
          {/* Header search */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Active Rates
              </span>
              <span className="rounded-md bg-gray-200/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {ptc.total}
              </span>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                value={ptc.q}
                onChange={(e) => ptc.setQ(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-1 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-gray-500"
              />
            </div>
          </div>

          {/* Pricing Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/75 dark:border-gray-800 dark:bg-gray-900/40">
                <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
                  <th className="text-left">Model Identifier</th>
                  <th className="text-left">Provider</th>
                  <th className="text-right">Prompt / 1K Tokens</th>
                  <th className="text-right">Completion / 1K Tokens</th>
                  <th className="text-right">Est. Prompt / 1M</th>
                  <th className="w-20 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {ptc.view.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-gray-500 dark:text-gray-400">
                      {ptc.q ? "No models matching your search." : "No custom prices configured."}
                    </td>
                  </tr>
                ) : (
                  ptc.view.map((p) => {
                    const provider = detectProvider(p.model);
                    return (
                      <tr key={p.model} className="transition-colors hover:bg-gray-50/60 dark:hover:bg-gray-900/30">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-900 dark:text-white">
                          {p.model}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={provider.tone} className="text-[10px] normal-case tracking-normal">
                            {provider.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-700 dark:text-gray-300">
                          ${p.prompt_per_1k.toFixed(5)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-700 dark:text-gray-300">
                          ${p.completion_per_1k.toFixed(5)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-gray-400 dark:text-gray-500">
                          ${(p.prompt_per_1k * 1000).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setModel(p.model);
                                setPrompt(String(p.prompt_per_1k));
                                setCompletion(String(p.completion_per_1k));
                              }}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                              title="Edit rate"
                              aria-label="Edit rate"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => remove(p.model)}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                              title="Delete rate"
                              aria-label="Delete rate"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            page={ptc.page}
            pageCount={ptc.pageCount}
            pageSize={ptc.pageSize}
            total={ptc.total}
            onPage={ptc.setPage}
            onPageSize={ptc.setPageSize}
            unit="rate"
          />

          {/* Add / Update Form */}
          <form
            onSubmit={save}
            className="border-t border-gray-100 bg-gray-50/70 p-4 transition-all dark:border-gray-800 dark:bg-gray-900/60"
          >
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              {model ? `Configure rate for ${model}` : "Add / Update Model Rate"}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[180px] flex-1">
                <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Model Identifier
                </span>
                <div className={INPUT_CONTAINER}>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                    className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-gray-400 text-gray-900 dark:text-white"
                  />
                </div>
              </label>

              <label className="w-44">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Prompt / 1K</span>
                  {prompt1M && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">${prompt1M}/1M</span>
                  )}
                </div>
                <div className={INPUT_CONTAINER}>
                  <span className="mr-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">$</span>
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    type="number"
                    min="0"
                    step="0.000001"
                    placeholder="0.00250"
                    className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-gray-400 text-gray-900 dark:text-white"
                  />
                </div>
              </label>

              <label className="w-44">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Completion / 1K</span>
                  {completion1M && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">${completion1M}/1M</span>
                  )}
                </div>
                <div className={INPUT_CONTAINER}>
                  <span className="mr-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">$</span>
                  <input
                    value={completion}
                    onChange={(e) => setCompletion(e.target.value)}
                    type="number"
                    min="0"
                    step="0.000001"
                    placeholder="0.01000"
                    className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-gray-400 text-gray-900 dark:text-white"
                  />
                </div>
              </label>

              <button
                type="submit"
                disabled={busy || !model.trim() || !(parseFloat(prompt) >= 0) || !(parseFloat(completion) >= 0)}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                <Plus className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save Rate"}
              </button>

              {model && (
                <button
                  type="button"
                  onClick={() => {
                    setModel("");
                    setPrompt("");
                    setCompletion("");
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-750"
                >
                  Clear
                </button>
              )}
            </div>

            {err && (
              <div className="mt-2.5 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{err}</span>
              </div>
            )}
          </form>

          <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:bg-gray-900/30">
            Note: Rate updates apply to newly ingested traces immediately. Historical traces retain their calculated cost at time of ingestion.
          </div>
        </Card>
      )}
    </div>
  );
}
