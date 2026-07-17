// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Upload, Loader2, CheckCircle2, AlertTriangle, Play } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useScorers } from "@/lib/hooks";
import { runEvaluation, EvalDataset, RunResultInput, RunEvalResult } from "@/lib/api";

// Parse pasted/uploaded results into RunResultInput[]. Accepts a JSON array,
// JSONL, or CSV with an `input,actual` header (+ optional context/tool_calls/…).
function parseResults(text: string): RunResultInput[] {
  const t = text.trim();
  if (!t) return [];
  const norm = (o: any): RunResultInput => ({
    input: String(o.input ?? ""),
    actual: String(o.actual ?? o.output ?? ""),
    context: o.context ? String(o.context) : undefined,
    tool_calls: Array.isArray(o.tool_calls) ? o.tool_calls.map(String) : undefined,
    latency_ms: typeof o.latency_ms === "number" ? o.latency_ms : undefined,
    cost_usd: typeof o.cost_usd === "number" ? o.cost_usd : undefined,
  });
  if (t.startsWith("[")) {
    try { const a = JSON.parse(t); if (Array.isArray(a)) return a.map(norm).filter((r) => r.input); } catch { /* fall through */ }
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines[0]?.trim().startsWith("{")) {
    const out: RunResultInput[] = [];
    for (const l of lines) { try { out.push(norm(JSON.parse(l))); } catch { /* skip */ } }
    if (out.length) return out.filter((r) => r.input);
  }
  // CSV
  const cols = (lines[0] || "").split(",").map((c) => c.trim().toLowerCase());
  const idx = (n: string) => cols.indexOf(n);
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    const get = (n: string) => (idx(n) >= 0 ? (c[idx(n)] ?? "").trim() : "");
    return { input: get("input"), actual: get("actual") || get("output"), context: get("context") || undefined };
  }).filter((r) => r.input);
}

const DEFAULT_SCORERS = ["exact_match", "rule_based"];

export function RunEvaluationModal({ open, onClose, datasets, presetDatasetId, onDone }: {
  open: boolean;
  onClose: () => void;
  datasets: EvalDataset[];
  presetDatasetId?: string | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: scorersData } = useScorers();
  const scorers = scorersData?.scorers || [];

  const [datasetId, setDatasetId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SCORERS));
  const [resultsText, setResultsText] = useState("");
  const [agentId, setAgentId] = useState("");
  const [model, setModel] = useState("");
  const [version, setVersion] = useState("");
  const [gate, setGate] = useState(true);
  const [setBaseline, setSetBaseline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunEvalResult | null>(null);

  useEffect(() => { if (open) { setDatasetId(presetDatasetId || datasets[0]?.id || ""); setResult(null); } }, [open, presetDatasetId, datasets]);

  const results = useMemo(() => parseResults(resultsText), [resultsText]);
  const usesContext = scorers.some((s) => selected.has(s.name) && s.needs_context);

  function toggle(name: string) {
    setSelected((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) f.text().then(setResultsText);
  }

  async function run() {
    if (!datasetId || results.length === 0 || selected.size === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await runEvaluation({
        dataset_id: datasetId,
        scorers: [...selected],
        results,
        gate,
        set_baseline: setBaseline,
        version: version ? Number(version) : undefined,
        agent_id: agentId.trim() || undefined,
        model: model.trim() || undefined,
      });
      setResult(res);
      onDone();
      toast[res.passed ? "success" : "error"](res.passed ? `Run passed — score ${(res.score * 100).toFixed(1)}%` : `Regression — score ${(res.score * 100).toFixed(1)}%`);
    } catch {
      toast.error("Run failed — check the dataset, scorers, and results format.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Run evaluation" subtitle="Score your agent's outputs against a dataset." icon={ClipboardCheck}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">{results.length} result{results.length === 1 ? "" : "s"} · {selected.size} scorer{selected.size === 1 ? "" : "s"}</span>
          <button onClick={run} disabled={busy || !datasetId || results.length === 0 || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
          </button>
        </div>
      }>
      <div className="space-y-5">
        {/* Result banner */}
        {result && (
          <div className={`rounded-lg border p-3 ${result.passed ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {result.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
              {(result.score * 100).toFixed(1)}% {result.regression ? "· regression vs baseline" : result.passed ? "· passed" : ""}
              {result.baseline != null && <span className="font-normal text-gray-500">(baseline {(result.baseline * 100).toFixed(1)}%)</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(result.per_scorer).map(([k, v]) => <Badge key={k} tone="neutral">{k}: {(v * 100).toFixed(0)}%</Badge>)}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">{result.matched_dataset_items}/{result.item_count} matched dataset ground truth · v{result.version}</p>
            {result.matched_dataset_items < result.item_count && (
              <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Only {result.matched_dataset_items} of {result.item_count} results matched a dataset item by input — the rest were scored
                  without ground truth, so this score can read higher than it should. Align your result <code>input</code> values with the dataset.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Dataset */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Dataset</label>
          {datasets.length === 0 ? (
            <p className="text-xs text-gray-400">No datasets yet — create one first.</p>
          ) : (
            <Select value={datasetId} onValueChange={setDatasetId} ariaLabel="Dataset" options={datasets.map((d) => ({ value: d.id, label: d.name }))} />
          )}
        </div>

        {/* Results */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-500">Results <span className="text-gray-400">(your agent's outputs)</span></label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-splyntra-600 hover:underline dark:text-splyntra-300">
              <Upload className="h-3.5 w-3.5" /> Upload
              <input type="file" accept=".jsonl,.json,.csv,.txt" onChange={onFile} className="hidden" />
            </label>
          </div>
          <textarea value={resultsText} onChange={(e) => setResultsText(e.target.value)} rows={7}
            placeholder={`JSON array / JSONL / CSV of {input, actual}. Example (JSONL):\n{"input":"capital of France?","actual":"Paris"}`}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed outline-none dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200" />
          <p className="mt-1 text-xs text-gray-500">{results.length} result{results.length === 1 ? "" : "s"} parsed. Ground truth (expected) is joined server-side by input.</p>
        </div>

        {/* Scorers */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Scorers</label>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {scorers.map((s) => (
              <label key={s.name} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${selected.has(s.name) ? "border-splyntra-300 bg-splyntra-50/40 dark:border-splyntra-700 dark:bg-splyntra-950/20" : "border-gray-200 dark:border-gray-800"}`}>
                <input type="checkbox" checked={selected.has(s.name)} onChange={() => toggle(s.name)} className="mt-0.5 h-3.5 w-3.5 accent-splyntra-600" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-800 dark:text-gray-200">
                    {s.name}
                    {s.kind === "plugin" && <Badge tone="brand">pro</Badge>}
                    {s.needs_context && <Badge tone="warning">context</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-gray-500" title={s.description}>{s.description}</span>
                </span>
              </label>
            ))}
          </div>
          {usesContext && <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">A selected scorer needs <code>context</code> — include it on your dataset items or results.</p>}
        </div>

        {/* Labels + gating */}
        <div className="grid grid-cols-3 gap-2">
          <div><label className="mb-1 block text-[11px] text-gray-500">Agent</label><input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="billing" className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800" /></div>
          <div><label className="mb-1 block text-[11px] text-gray-500">Model</label><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800" /></div>
          <div><label className="mb-1 block text-[11px] text-gray-500">Version</label><input type="number" min="1" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1" className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800" /></div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-[13px] text-gray-700 dark:text-gray-300"><input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)} className="h-3.5 w-3.5 accent-splyntra-600" /> Gate on regression</label>
          <label className="inline-flex items-center gap-2 text-[13px] text-gray-700 dark:text-gray-300"><input type="checkbox" checked={setBaseline} onChange={(e) => setSetBaseline(e.target.checked)} className="h-3.5 w-3.5 accent-splyntra-600" /> Set as baseline</label>
        </div>
      </div>
    </Drawer>
  );
}
