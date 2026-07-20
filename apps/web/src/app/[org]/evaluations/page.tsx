// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { ClipboardCheck, Database, CheckCircle2, AlertTriangle, X, Trophy, Plus, Play, Terminal, Flag } from "lucide-react";
import { useDatasets, useEvalRuns, useEvalRun, useEvalLeaderboard, useEvalDataset } from "@/lib/hooks";
import { EvalDataset, EvalRun, LeaderboardRow, setRunBaseline } from "@/lib/api";
import { PageHeader, Card, StatCard, EmptyState } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { useTableControls, TablePagination } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExportButton } from "@/components/ui/ExportButton";
import { NewDatasetModal } from "@/components/eval/NewDatasetModal";
import { RunEvaluationModal } from "@/components/eval/RunEvaluationModal";

export default function EvaluationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [scopeDataset, setScopeDataset] = useState<string>("");
  const { data: dsData, isLoading: dsLoading, isError: dsError } = useDatasets();
  const { data: runData, isError: runsError } = useEvalRuns(scopeDataset || undefined);
  const { data: lbData, isError: lbError } = useEvalLeaderboard(scopeDataset || undefined);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const { data: runDetail, isLoading: detailLoading, isError: detailError } = useEvalRun(selectedRun);

  const [newDataset, setNewDataset] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runPreset, setRunPreset] = useState<string | null>(null);
  const [openDataset, setOpenDataset] = useState<string | null>(null);
  const [ciLang, setCiLang] = useState<"python" | "typescript">("python");
  const { data: datasetDetail } = useEvalDataset(openDataset);

  const datasets: EvalDataset[] = dsData?.datasets || [];
  const runs: EvalRun[] = runData?.runs || [];
  const leaderboard: LeaderboardRow[] = lbData?.leaderboard || [];

  // Client-side pagination for each table (rows-per-page selectable).
  const dtc = useTableControls(datasets, { pageSize: 10 });
  const ltc = useTableControls(leaderboard, { pageSize: 10 });
  const rtc = useTableControls(runs, { pageSize: 10 });

  const refreshRuns = () => { qc.invalidateQueries({ queryKey: ["eval-runs"] }); qc.invalidateQueries({ queryKey: ["eval-leaderboard"] }); };
  const refreshDatasets = () => qc.invalidateQueries({ queryKey: ["eval-datasets"] });

  async function promoteBaseline(runId: string) {
    try {
      await setRunBaseline(runId);
      refreshRuns();
      toast.success("Run set as the dataset baseline.");
    } catch {
      toast.error("Couldn’t set the baseline.");
    }
  }
  function runOnDataset(id: string) { setRunPreset(id); setOpenDataset(null); setRunOpen(true); }

  const ciSnippet = scopeDataset ? CI_SNIPPETS[ciLang].replace("<dataset-id>", scopeDataset) : CI_SNIPPETS[ciLang];
  const latest = runs[0];
  const regressions = runs.filter((r) => r.regression).length;
  const trend = [...runs]
    .reverse()
    .map((r) => ({ t: new Date(r.created_at).toLocaleDateString(), score: +(r.score * 100).toFixed(1) }));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        icon={ClipboardCheck}
        title="Evaluation"
        subtitle="Create datasets, run scorers, and gate on regressions."
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setNewDataset(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              <Plus className="h-4 w-4" /> New dataset
            </button>
            <button onClick={() => { setRunPreset(null); setRunOpen(true); }} disabled={datasets.length === 0} title={datasets.length === 0 ? "Create a dataset first" : ""} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
              <Play className="h-4 w-4" /> Run evaluation
            </button>
          </div>
        }
      />

      {datasets.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Scope</span>
          <Select
            value={scopeDataset}
            onValueChange={setScopeDataset}
            size="sm"
            ariaLabel="Scope runs and leaderboard to a dataset"
            className="min-w-[200px]"
            options={[{ value: "", label: "All datasets" }, ...datasets.map((d) => ({ value: d.id, label: d.name }))]}
          />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Datasets" value={datasets.length} icon={Database} />
        <StatCard label="Runs" value={runs.length} icon={ClipboardCheck} />
        <StatCard
          label="Latest score"
          value={latest ? `${(latest.score * 100).toFixed(1)}%` : "—"}
          icon={CheckCircle2}
          accent={latest && latest.passed ? "text-emerald-600" : "text-red-600"}
        />
        <StatCard label="Regressions" value={regressions} icon={AlertTriangle} accent={regressions > 0 ? "text-red-600" : undefined} />
      </div>

      {trend.length > 1 && (
        <Card className="mb-6 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Score over time (%)</h3>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#9ca3af" width={40} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <ReferenceLine y={latest ? +(latest.score * 100).toFixed(1) : 0} stroke="#adb5bd" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="score" stroke="#4c6ef5" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Datasets</h2>
      <Card className="mb-6 overflow-hidden">
        {dsLoading ? (
          <div className="p-8 text-center text-gray-500">Loading…</div>
        ) : dsError ? (
          <EmptyState icon={AlertTriangle} title="Couldn’t load datasets">
            The evaluation service is unavailable — check that the collector is reachable, then retry.
          </EmptyState>
        ) : datasets.length === 0 ? (
          <EmptyState icon={Database} title="No datasets yet">
            A dataset is the ground truth your agent is scored against.
            <div className="mt-3"><button onClick={() => setNewDataset(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-gray-900"><Plus className="h-4 w-4" /> New dataset</button></div>
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/50">
              <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:text-gray-500">
                <th>Name</th>
                <th>Slug</th>
                <th className="text-right">Version</th>
                <th className="text-right">Items</th>
                <th className="text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {dtc.view.map((d) => (
                <tr key={d.id} onClick={() => setOpenDataset(d.id)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
                  <td className="px-4 py-3 font-medium text-gray-900 hover:text-splyntra-700 dark:text-white">{d.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.slug}</td>
                  <td className="px-4 py-3 text-right tabular-nums">v{d.latest_version}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{d.item_count}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={(e) => { e.stopPropagation(); runOnDataset(d.id); }} className="inline-flex items-center gap-1 text-xs font-medium text-splyntra-600 hover:underline dark:text-splyntra-300"><Play className="h-3 w-3" /> Run</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <TablePagination page={dtc.page} pageCount={dtc.pageCount} pageSize={dtc.pageSize} total={dtc.total} onPage={dtc.setPage} onPageSize={dtc.setPageSize} unit="dataset" />
      </Card>

      {lbError && (
        <p className="mb-4 flex items-center gap-1.5 text-xs text-red-500">
          <AlertTriangle className="h-3.5 w-3.5" /> Couldn’t load the leaderboard — check that the collector is reachable.
        </p>
      )}
      {leaderboard.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300"><Trophy className="h-4 w-4 text-amber-500" /> Leaderboard</h2>
            <ExportButton rows={leaderboard} filename="eval-leaderboard" sheetName="Leaderboard" columns={[
              { header: "Agent", value: (r: LeaderboardRow) => r.agent_id },
              { header: "Model", value: (r: LeaderboardRow) => r.model || "" },
              { header: "Best Score", value: (r: LeaderboardRow) => r.best_score },
              { header: "Latest Score", value: (r: LeaderboardRow) => r.latest_score },
              { header: "Pass Rate", value: (r: LeaderboardRow) => r.pass_rate },
              { header: "Runs", value: (r: LeaderboardRow) => r.runs },
            ]} />
          </div>
          <Card className="mb-6 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/50">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:text-gray-500">
                  <th>Agent</th><th>Model</th><th className="text-right">Best</th><th className="text-right">Latest</th><th className="text-right">Pass rate</th><th className="text-right">Runs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {ltc.view.map((row, i) => (
                  <tr key={`${row.agent_id}-${row.model}-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <td className="px-4 py-3 font-medium">{ltc.page === 0 && i === 0 && <Trophy className="mr-1 inline h-3.5 w-3.5 text-amber-500" />}{row.agent_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.model || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{(row.best_score * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{(row.latest_score * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{(row.pass_rate * 100).toFixed(0)}%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{row.runs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination page={ltc.page} pageCount={ltc.pageCount} pageSize={ltc.pageSize} total={ltc.total} onPage={ltc.setPage} onPageSize={ltc.setPageSize} unit="agent" />
          </Card>
        </>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Recent runs</h2>
        {runs.length > 0 && (
          <ExportButton rows={runs} filename="eval-runs" sheetName="Runs" columns={[
            { header: "Run ID", value: (r: EvalRun) => r.id },
            { header: "Version", value: (r: EvalRun) => r.version ?? 1 },
            { header: "Agent", value: (r: EvalRun) => r.agent_id || "" },
            { header: "Model", value: (r: EvalRun) => r.model || "" },
            { header: "Score", value: (r: EvalRun) => r.score },
            { header: "Items", value: (r: EvalRun) => r.item_count },
            { header: "Passed", value: (r: EvalRun) => (r.passed ? "yes" : "no") },
            { header: "Regression", value: (r: EvalRun) => (r.regression ? "yes" : "no") },
            { header: "When", value: (r: EvalRun) => new Date(r.created_at).toISOString() },
          ]} />
        )}
      </div>
      <Card className="overflow-hidden">
        {runsError ? (
          <EmptyState icon={AlertTriangle} title="Couldn’t load runs">
            The evaluation service is unavailable — check that the collector is reachable, then retry.
          </EmptyState>
        ) : runs.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No runs yet">
            Run an evaluation from the UI, or wire <code className="text-xs">splyntra eval run --gate</code> into CI.
            <div className="mt-3"><button onClick={() => { setRunPreset(null); setRunOpen(true); }} disabled={datasets.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-gray-900"><Play className="h-4 w-4" /> Run evaluation</button></div>
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/50">
              <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:text-gray-500">
                <th>Run</th>
                <th>Version</th>
                <th className="text-right">Score</th>
                <th className="text-right">Items</th>
                <th>Gate</th>
                <th className="text-right">When</th>
                <th className="text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rtc.view.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60" onClick={() => setSelectedRun(r.id)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.id.slice(0, 8)}{r.agent_id ? ` · ${r.agent_id}` : ""}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">v{r.version ?? 1}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{(r.score * 100).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{r.item_count}</td>
                  <td className="px-4 py-3">
                    {r.regression ? (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-red-50 text-red-700 ring-1 ring-inset ring-red-200">
                        <AlertTriangle className="h-3 w-3" /> regression
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> {r.passed ? "passed" : "ok"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={(e) => { e.stopPropagation(); promoteBaseline(r.id); }} title="Set as baseline" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-splyntra-600 dark:hover:text-splyntra-300"><Flag className="h-3 w-3" /> Baseline</button>
                      <span className="text-xs font-medium text-splyntra-600 hover:underline dark:text-splyntra-400">View</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <TablePagination page={rtc.page} pageCount={rtc.pageCount} pageSize={rtc.pageSize} total={rtc.total} onPage={rtc.setPage} onPageSize={rtc.setPageSize} unit="run" />
      </Card>

      {/* Run in CI */}
      <div className="mb-3 mt-8 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5"><Terminal className="h-4 w-4 text-gray-400" /><h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Automate in CI</h2></div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
          {(["python", "typescript"] as const).map((l) => (
            <button key={l} onClick={() => setCiLang(l)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${ciLang === l ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
              {l === "python" ? "Python" : "TypeScript"}
            </button>
          ))}
        </div>
      </div>
      <Card className="p-4">
        <p className="mb-2 text-[13px] text-gray-600 dark:text-gray-300">Gate every PR on your eval set — the <code className="text-xs">splyntra eval</code> CLI exits non-zero on a regression. Set <code className="text-xs">SPLYNTRA_API_KEY</code> + <code className="text-xs">SPLYNTRA_EVAL_ENDPOINT</code>.</p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 pr-14 font-mono text-[12px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200"><code>{ciSnippet}</code></pre>
          <div className="absolute right-2 top-2"><CopyButton text={ciSnippet} /></div>
        </div>
        {scopeDataset && <p className="mt-2 text-[11px] text-gray-400">Filled in with the scoped dataset’s ID.</p>}
      </Card>

      {/* Run detail — per-item results (persisted at run time) */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedRun(null)}>
          <div className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Run {selectedRun.slice(0, 8)}</h3>
                  {runDetail && (
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      Score {(runDetail.run.score * 100).toFixed(1)}% · {runDetail.items.length} items · v{runDetail.run.version ?? 1}
                      {runDetail.run.agent_id ? ` · ${runDetail.run.agent_id}` : ""}
                      {runDetail.run.model ? ` · ${runDetail.run.model}` : ""}
                      {runDetail.run.regression && <span className="ml-1 font-medium text-red-600">· regression</span>}
                    </p>
                  )}
                </div>
                <button onClick={() => setSelectedRun(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {/* Per-scorer averages — which scorer moved the score. */}
              {runDetail && runDetail.run.per_scorer && Object.keys(runDetail.run.per_scorer).length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {Object.entries(runDetail.run.per_scorer).map(([name, val]) => (
                    <span key={name} className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-[11px] dark:bg-gray-800">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{name}</span>
                      <span className="tabular-nums text-gray-500">{(val * 100).toFixed(1)}%</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="overflow-auto">
              {detailLoading ? (
                <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
              ) : detailError ? (
                <div className="flex items-center justify-center gap-1.5 p-8 text-center text-sm text-red-500">
                  <AlertTriangle className="h-4 w-4" /> Couldn’t load this run’s results.
                </div>
              ) : !runDetail || runDetail.items.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">No per-item results recorded.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-gray-100 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/80">
                    <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
                      <th>#</th>
                      <th>Input</th>
                      <th>Expected</th>
                      <th>Actual</th>
                      <th>Scores</th>
                      <th className="text-center">Pass</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {runDetail.items.map((it) => (
                      <tr key={it.idx} className={it.passed ? "" : "bg-red-50/40 dark:bg-red-950/10"}>
                        <td className="px-4 py-2.5 tabular-nums text-gray-400">{it.idx}</td>
                        <td className="max-w-[160px] truncate px-4 py-2.5 text-gray-700 dark:text-gray-300" title={it.input}>{it.input}</td>
                        <td className="max-w-[160px] truncate px-4 py-2.5 text-gray-500" title={it.expected}>{it.expected}</td>
                        <td className="max-w-[160px] truncate px-4 py-2.5 text-gray-500" title={it.actual}>{it.actual}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {it.scores && Object.keys(it.scores).length > 0 ? (
                              Object.entries(it.scores).map(([name, val]) => (
                                <span key={name} title={name} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${val >= 0.999 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : val <= 0.001 ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}>
                                  <span className="opacity-70">{name.length > 10 ? name.slice(0, 9) + "…" : name}</span>
                                  {(val * 100).toFixed(0)}%
                                </span>
                              ))
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {it.passed ? (
                            <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
                          ) : (
                            <X className="mx-auto h-4 w-4 text-red-600" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Authoring modals */}
      <NewDatasetModal open={newDataset} onClose={() => setNewDataset(false)} onCreated={() => refreshDatasets()} />
      <RunEvaluationModal open={runOpen} onClose={() => setRunOpen(false)} datasets={datasets} presetDatasetId={runPreset} onDone={refreshRuns} />

      {/* Dataset detail */}
      <Drawer open={!!openDataset} onClose={() => setOpenDataset(null)} icon={Database}
        title={datasetDetail?.dataset.name || "Dataset"}
        subtitle={datasetDetail?.dataset.description || undefined}
        footer={openDataset ? (
          <button onClick={() => runOnDataset(openDataset)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900"><Play className="h-4 w-4" /> Run evaluation</button>
        ) : undefined}>
        {datasetDetail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              {datasetDetail.versions[0] && <Badge tone="neutral">v{datasetDetail.versions[0].version} · {datasetDetail.versions[0].item_count} items</Badge>}
              {datasetDetail.baseline ? <Badge tone="success">baseline {(datasetDetail.baseline.score * 100).toFixed(1)}%</Badge> : <Badge tone="muted">no baseline</Badge>}
            </div>
            {/* Dataset id — copy into the CLI --dataset flag / SDK runEval(datasetId, …). */}
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/50">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Dataset ID</span>
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300">{datasetDetail.dataset.id}</code>
              <CopyButton text={datasetDetail.dataset.id} />
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Items ({datasetDetail.items.length})</h4>
              <div className="max-h-[55vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left dark:bg-gray-800/80"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500"><th>Input</th><th>Expected</th><th>Context</th></tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {datasetDetail.items.map((it, i) => (
                      <tr key={i}>
                        <td className="max-w-[160px] truncate px-3 py-2 text-gray-700 dark:text-gray-300" title={it.input}>{it.input}</td>
                        <td className="max-w-[160px] truncate px-3 py-2 text-gray-500" title={it.expected_output}>{it.expected_output || "—"}</td>
                        <td className="max-w-[120px] truncate px-3 py-2 text-gray-400" title={it.context}>{it.context ? "✓" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

const CI_SNIPPETS: Record<"python" | "typescript", string> = {
  python: `# .github/workflows/eval.yml
- run: pip install splyntra
- run: |
    splyntra eval run \\
      --dataset <dataset-id> \\
      --file results.jsonl \\
      --scorers exact_match,groundedness \\
      --gate   # exits non-zero on regression`,
  typescript: `# .github/workflows/eval.yml
- run: npm i -g @splyntra/sdk
- run: |
    splyntra eval run \\
      --dataset <dataset-id> \\
      --file results.jsonl \\
      --scorers exact_match,groundedness \\
      --gate   # exits non-zero on regression`,
};
