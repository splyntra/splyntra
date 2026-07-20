// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import { LogListItem } from "@/lib/api";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Badge, BadgeTone } from "@/components/ui/Badge";
import { ScrollText, ArrowUpRight } from "lucide-react";
import { useOrgHref } from "@/lib/org-path";

const SEV_TONE: Record<string, BadgeTone> = {
  TRACE: "muted",
  DEBUG: "muted",
  INFO: "neutral",
  WARN: "warning",
  ERROR: "danger",
  FATAL: "danger",
};

export function LogList({ logs }: { logs: LogListItem[] }) {
  const oh = useOrgHref();
  if (logs.length === 0) {
    return (
      <Card>
        <EmptyState icon={ScrollText} title="No logs yet">
          Emit structured logs from your agent to see them here.
          <pre className="mt-3 inline-block rounded-lg bg-gray-100 p-3 text-left text-xs dark:bg-gray-800">
            {`from splyntra import log\nlog.info("charged card", attrs={"amount": 42})`}
          </pre>
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50/80 text-left dark:border-gray-800 dark:bg-gray-900/50">
          <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
            <th>Time</th>
            <th>Severity</th>
            <th>Agent</th>
            <th>Message</th>
            <th className="text-right">Trace</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {logs.map((l, i) => (
            <tr key={`${l.timestamp}-${i}`} className="align-top hover:bg-gray-50 dark:hover:bg-gray-900/40">
              <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-gray-500">{new Date(l.timestamp).toLocaleTimeString()}</td>
              <td className="px-4 py-2.5"><Badge tone={SEV_TONE[l.severity] || "neutral"}>{l.severity}</Badge></td>
              <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300">{l.agent_id || "—"}</td>
              <td className="px-4 py-2.5 font-mono text-[12px] text-gray-800 dark:text-gray-200">{l.body}</td>
              <td className="px-4 py-2.5 text-right">
                {l.trace_id ? (
                  <Link href={oh(`/traces/${encodeURIComponent(l.trace_id)}`)} className="inline-flex items-center gap-1 text-xs text-splyntra-600 hover:underline dark:text-splyntra-300">
                    {l.trace_id.slice(0, 8)}… <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
