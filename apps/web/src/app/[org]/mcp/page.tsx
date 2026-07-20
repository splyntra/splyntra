// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { Server } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";
import { CatalogDirectory } from "@/components/catalog/CatalogDirectory";
import { byCategory } from "@/lib/catalog";
import { McpServerMetrics } from "@/components/mcp/McpServerMetrics";

export default function McpPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        icon={Server}
        title="MCP Servers"
        subtitle="Every MCP server is captured by the one MCP instrumentor. Monitor latency, failed calls, and flagged calls per server."
      />

      <McpServerMetrics />

      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-gray-400">Server catalog</h2>
      <CatalogDirectory integrations={byCategory("mcp")} />
    </div>
  );
}
