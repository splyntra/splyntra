// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";
import { CatalogDirectory } from "@/components/catalog/CatalogDirectory";
import { PlatformActivity } from "@/components/catalog/PlatformActivity";
import { byCategory } from "@/lib/catalog";
import { useOrgHref } from "@/lib/org-path";

export default function PlatformsPage() {
  const oh = useOrgHref();
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        icon={Workflow}
        title="Agent Platforms"
        subtitle="Orchestrators & no-code builders. They POST workflow-run summaries (or export OTLP) — Splyntra traces, costs, and secures every run, kept separate from your agents."
        action={
          <Link href={oh("/platforms/connect")} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900">
            <Workflow className="h-4 w-4" /> Connect
          </Link>
        }
      />
      <PlatformActivity />
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Connect a platform</h2>
      <CatalogDirectory integrations={byCategory("platform")} />
    </div>
  );
}
