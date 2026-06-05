// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { TraceListItem } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Inbox, ChevronRight } from "lucide-react";
import { Card, EmptyState, StatusPill, RiskBadge, severityFromScore } from "@/components/ui/primitives";

interface TraceListProps {
  traces: TraceListItem[];
}

export function TraceList({ traces }: TraceListProps) {
  const router = useRouter();

  if (traces.length === 0) {
    return (
      <Card>
        <EmptyState icon={Inbox} title="No traces yet">
          Run an instrumented agent to see traces appear here.
          <pre className="mt-3 inline-block rounded-lg bg-gray-100 p-3 text-left text-xs dark:bg-gray-800">
            {`pip install splyntra\npython examples/quickstart.py`}
          </pre>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/50">
          <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:text-gray-500">
            <th>Trace</th>
            <th>Agent</th>
            <th>Status</th>
            <th className="text-right">Latency</th>
            <th className="text-right">Tokens</th>
            <th className="text-right">Cost</th>
            <th className="text-right">Risk</th>
            <th className="text-right">Time</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {traces.map((trace) => (
            <tr
              key={trace.trace_id}
              onClick={() => router.push(`/traces/${trace.trace_id}`)}
              className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                {trace.trace_id.slice(0, 12)}…
              </td>
              <td className="px-4 py-3 font-medium">{trace.agent_id}</td>
              <td className="px-4 py-3">
                <StatusPill status={trace.status} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{trace.latency_ms}ms</td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                {trace.total_tokens.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                ${trace.cost_usd.toFixed(4)}
              </td>
              <td className="px-4 py-3 text-right">
                <RiskBadge score={trace.risk_score} severity={trace.risk_severity || severityFromScore(trace.risk_score)} />
              </td>
              <td className="px-4 py-3 text-right text-xs text-gray-500">
                {new Date(trace.started_at).toLocaleTimeString()}
              </td>
              <td className="px-2 text-gray-300 dark:text-gray-600">
                <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
