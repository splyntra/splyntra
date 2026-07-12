// SPDX-License-Identifier: Apache-2.0
/**
 * Evaluation helpers + CI gate (npm parity with the Python `splyntra.eval`).
 *
 *   import { pushDataset, runEval } from "@splyntra/sdk";
 *   await pushDataset("support-qa", [{ input: "...", expected_output: "..." }]);
 *   const res = await runEval(datasetId, [{ input: "...", actual: "..." }], { gate: true });
 *   if (!res.passed) process.exit(1);  // regression
 *
 * Reads SPLYNTRA_EVAL_ENDPOINT (default http://localhost:8002) + SPLYNTRA_API_KEY.
 * The `splyntra eval` CLI wraps these for CI.
 */
function evalEndpoint(): string {
  return (process.env.SPLYNTRA_EVAL_ENDPOINT || "http://localhost:8002").replace(/\/$/, "");
}
function apiKey(explicit?: string): string {
  const k = explicit || process.env.SPLYNTRA_API_KEY || "";
  if (!k) throw new Error("Splyntra: set SPLYNTRA_API_KEY or pass apiKey");
  return k;
}
async function post(path: string, payload: unknown, key?: string): Promise<any> {
  const res = await fetch(`${evalEndpoint()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey(key)}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`eval request failed (${res.status}): ${await res.text().catch(() => "")}`);
  return res.json();
}

export interface DatasetItem {
  input: string;
  expected_output?: string;
  expected_tool_calls?: string[];
  /** Retrieved context / source material for RAG groundedness + faithfulness. */
  context?: string;
}
export interface RunResult {
  input: string;
  actual: string;
  context?: string;
  tool_calls?: string[];
  latency_ms?: number;
  cost_usd?: number;
}
export interface RunSummary {
  run_id: string;
  version: number;
  score: number;
  per_scorer: Record<string, number>;
  baseline: number | null;
  regression: boolean;
  passed: boolean;
  matched_dataset_items: number;
  item_count: number;
}

/** Create/version a dataset from labeled items. */
export async function pushDataset(name: string, items: DatasetItem[], opts: { description?: string; apiKey?: string } = {}): Promise<any> {
  return post("/v1/datasets", { name, description: opts.description || "", items }, opts.apiKey);
}

/** Score caller-produced results against a dataset; returns the run summary. */
export async function runEval(
  datasetId: string,
  results: RunResult[],
  opts: { scorers?: string[]; gate?: boolean; setBaseline?: boolean; agentId?: string; model?: string; version?: number; apiKey?: string } = {}
): Promise<RunSummary> {
  return post(
    "/v1/evaluations/run",
    {
      dataset_id: datasetId,
      scorers: opts.scorers || [],
      results,
      gate: opts.gate ?? true,
      set_baseline: opts.setBaseline ?? false,
      agent_id: opts.agentId,
      model: opts.model,
      version: opts.version,
    },
    opts.apiKey
  );
}
