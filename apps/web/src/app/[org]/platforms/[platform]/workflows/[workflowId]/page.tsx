// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Workflow } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";
import { SourceBadge } from "@/components/ui/SourceBadge";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TraceList } from "@/components/trace/TraceList";
import { useTraces } from "@/lib/hooks";
import { platformMeta } from "@/lib/platforms";

export default function WorkflowRunsPage() {
  const params = useParams<{ platform: string; workflowId: string }>();
  const platform = decodeURIComponent(params.platform);
  const workflowId = decodeURIComponent(params.workflowId);
  const meta = platformMeta(platform);

  const { data, isLoading } = useTraces({ platform, workflowId, limit: 100 });
  const traces = data?.traces || [];
  const workflowName = traces.find((t) => t.workflow_name)?.workflow_name || workflowId;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href={`/platforms/${encodeURIComponent(platform)}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> {meta.name}
      </Link>
      <PageHeader
        icon={Workflow}
        title={workflowName}
        badge={<SourceBadge source="platform" />}
        subtitle={`Runs of this ${meta.name} workflow. Open any run for the full node waterfall, per-node LLM cost, and security findings.`}
      />
      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : (
        <TraceList
          traces={traces}
          controls
          emptyTitle="No runs for this workflow yet"
          emptyChildren="Trigger the workflow on your platform — each execution appears here as a run."
        />
      )}
    </div>
  );
}
