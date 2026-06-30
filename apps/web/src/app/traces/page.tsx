// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useTraces } from "@/lib/hooks";
import { TraceList } from "@/components/trace/TraceList";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/primitives";
import { Activity } from "lucide-react";

export default function TracesPage() {
  const { data, isLoading, error } = useTraces();

  const traces = data?.traces || [];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        icon={Activity}
        title="Traces"
        subtitle="Agent execution traces with unified risk scoring"
      />
      {error && !isLoading && (
        <p className="mb-4 text-xs text-red-500">
          Could not reach the collector. Check that the stack is running.
        </p>
      )}

      {isLoading ? <TableSkeleton rows={5} cols={8} /> : <TraceList traces={traces} />}
    </div>
  );
}
