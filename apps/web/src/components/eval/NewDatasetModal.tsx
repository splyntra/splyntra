// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
import { useMemo, useState } from "react";
import { Database, Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { createDataset, DatasetItemRow } from "@/lib/api";

type Mode = "build" | "import";
interface Row { input: string; expected_output: string; expected_tool_calls: string; context: string }
const emptyRow = (): Row => ({ input: "", expected_output: "", expected_tool_calls: "", context: "" });

// Parse pasted/uploaded content into dataset items. Accepts a JSON array,
// JSONL (one object per line), or CSV with a header row. Returns the valid
// items plus a `skipped` count for source records that failed to parse or had
// no input — so the UI can flag silent data loss instead of hiding it.
interface ParseResult { items: DatasetItemRow[]; skipped: number }
function parseItems(text: string): ParseResult {
  const t = text.trim();
  if (!t) return { items: [], skipped: 0 };
  // JSON array
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        const items = arr.map(normalize).filter((r) => r.input);
        return { items, skipped: arr.length - items.length };
      }
    } catch { /* fall through */ }
  }
  // JSONL
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines[0]?.trim().startsWith("{")) {
    const out: DatasetItemRow[] = [];
    let bad = 0;
    for (const l of lines) {
      try { const r = normalize(JSON.parse(l)); r.input ? out.push(r) : bad++; } catch { bad++; }
    }
    if (out.length || bad) return { items: out, skipped: bad };
  }
  // CSV (header row: input, expected_output, expected_tool_calls, context)
  const [head, ...body] = lines;
  const cols = splitCsv(head).map((c) => c.trim().toLowerCase());
  const idx = (n: string) => cols.indexOf(n);
  const items = body.map((line) => {
    const c = splitCsv(line);
    const get = (n: string) => (idx(n) >= 0 ? (c[idx(n)] ?? "").trim() : "");
    const tools = get("expected_tool_calls");
    return {
      input: get("input"),
      expected_output: get("expected_output") || get("expected"),
      expected_tool_calls: tools ? tools.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [],
      context: get("context"),
    };
  }).filter((r) => r.input);
  return { items, skipped: body.length - items.length };
}

function splitCsv(line: string): string[] {
  // Minimal CSV: handles quoted fields with commas.
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function normalize(o: any): DatasetItemRow {
  const tools = o.expected_tool_calls ?? o.expectedToolCalls ?? [];
  return {
    input: String(o.input ?? ""),
    expected_output: String(o.expected_output ?? o.expected ?? o.expectedOutput ?? ""),
    expected_tool_calls: Array.isArray(tools) ? tools.map(String) : [],
    context: String(o.context ?? o.retrieved ?? ""),
  };
}

export function NewDatasetModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("build");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => (mode === "import" ? parseItems(importText) : { items: [], skipped: 0 }), [mode, importText]);
  const importItems = parsed.items;
  const items: DatasetItemRow[] = mode === "build"
    ? rows.filter((r) => r.input.trim()).map((r) => ({
        input: r.input.trim(),
        expected_output: r.expected_output.trim(),
        expected_tool_calls: r.expected_tool_calls.split(",").map((s) => s.trim()).filter(Boolean),
        context: r.context.trim(),
      }))
    : importItems;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then(setImportText);
  }

  async function submit() {
    if (!name.trim() || items.length === 0) return;
    setBusy(true);
    try {
      const res = await createDataset({ name: name.trim(), description: description.trim(), items });
      toast.success(`Dataset “${name.trim()}” created with ${res.item_count} items.`);
      setName(""); setDescription(""); setRows([emptyRow()]); setImportText("");
      onCreated(res.dataset_id);
      onClose();
    } catch {
      toast.error("Couldn’t create the dataset — an admin/member session is required.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="New dataset" subtitle="Ground-truth items your agent is evaluated against." icon={Database}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">{items.length} item{items.length === 1 ? "" : "s"} ready</span>
          <button onClick={submit} disabled={busy || !name.trim() || items.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create dataset
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Billing QA" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Description <span className="text-gray-400">(optional)</span></label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Golden Q&A for the billing agent" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
          {(["build", "import"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 text-xs font-medium ${mode === m ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
              {m === "build" ? "Build rows" : "Import file"}
            </button>
          ))}
        </div>

        {mode === "build" ? (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-800">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-gray-400">Item {i + 1}</span>
                  {rows.length > 1 && <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
                <input value={r.input} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, input: e.target.value } : x))} placeholder="Input / question" className="mb-1.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800" />
                <input value={r.expected_output} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, expected_output: e.target.value } : x))} placeholder="Expected output" className="mb-1.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800" />
                <div className="grid grid-cols-2 gap-1.5">
                  <input value={r.expected_tool_calls} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, expected_tool_calls: e.target.value } : x))} placeholder="Expected tools (comma-sep)" className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" />
                  <input value={r.context} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, context: e.target.value } : x))} placeholder="Context (for groundedness)" className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" />
                </div>
              </div>
            ))}
            <button onClick={() => setRows([...rows, emptyRow()])} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"><Plus className="h-3.5 w-3.5" /> Add item</button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
              <Upload className="h-3.5 w-3.5" /> Upload .jsonl / .json / .csv
              <input type="file" accept=".jsonl,.json,.csv,.txt" onChange={onFile} className="hidden" />
            </label>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10}
              placeholder={`Paste a JSON array, JSONL, or CSV. Example (JSONL):\n{"input":"capital of France?","expected_output":"Paris","context":"Paris is the capital of France."}`}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed outline-none dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200" />
            <p className="text-xs text-gray-500">
              {importItems.length} item{importItems.length === 1 ? "" : "s"} parsed.
              {parsed.skipped > 0 && <span className="text-amber-600 dark:text-amber-400"> {parsed.skipped} row{parsed.skipped === 1 ? "" : "s"} skipped (unparseable or missing input).</span>}
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
