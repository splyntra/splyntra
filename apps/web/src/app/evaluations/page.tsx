// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { ClipboardCheck, Database, CheckCircle2, AlertTriangle } from "lucide-react";
import { useDatasets, useEvalRuns } from "@/lib/hooks";
import { EvalDataset, EvalRun } from "@/lib/api";
import { PageHeader, Card, StatCard, EmptyState } from "@/components/ui/primitives";

export default function EvaluationsPage() {
  const { data: dsData, isLoading: dsLoading } = useDatasets();
  const { data: runData } = useEvalRuns();

  const datasets: EvalDataset[] = dsData?.datasets || [];
  const runs: EvalRun[] = runData?.runs || [];

  const latest = runs[0];
  const regressions = runs.filter((r) => r.regression).length;
  const trend = [...runs]
    .reverse()
    .map((r) => ({ t: new Date(r.created_at).toLocaleDateString(), score: +(r.score * 100).toFixed(1) }));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader icon={ClipboardCheck} title="Evaluation" subtitle="Datasets, benchmark runs, and regression gates" />

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
        ) : datasets.length === 0 ? (
          <EmptyState icon={Database} title="No datasets yet">
            Create one with the SDK: <code className="text-xs">splyntra eval push --name ...</code> or
            <code className="text-xs"> POST /v1/datasets</code>.
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/50">
              <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:text-gray-500">
                <th>Name</th>
                <th>Slug</th>
                <th className="text-right">Version</th>
                <th className="text-right">Items</th>
                <th className="text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {datasets.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.slug}</td>
                  <td className="px-4 py-3 text-right tabular-nums">v{d.latest_version}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{d.item_count}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Recent runs</h2>
      <Card className="overflow-hidden">
        {runs.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No runs yet">
            Run <code className="text-xs">splyntra eval run --gate</code> in CI to score against a dataset.
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/50">
              <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:text-gray-500">
                <th>Run</th>
                <th className="text-right">Score</th>
                <th className="text-right">Items</th>
                <th>Gate</th>
                <th className="text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.id.slice(0, 8)}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
