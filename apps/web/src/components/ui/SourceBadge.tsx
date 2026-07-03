// SPDX-License-Identifier: AGPL-3.0-only
// One shared badge for the three data domains so a trace/row/header is never
// ambiguous about which domain it belongs to. Agent = brand, Platform = amber,
// MCP = neutral. Derive the source from a trace's `platform` via sourceOf().
import { Bot, Workflow, Server } from "lucide-react";
import { Badge } from "./Badge";

export type Source = "agent" | "platform" | "mcp";

const META: Record<Source, { tone: "brand" | "warning" | "neutral"; label: string; Icon: typeof Bot }> = {
  agent: { tone: "brand", label: "Agent", Icon: Bot },
  platform: { tone: "warning", label: "Platform", Icon: Workflow },
  mcp: { tone: "neutral", label: "MCP", Icon: Server },
};

/** Map a trace's `platform` column to its source domain ('' = SDK agent). */
export function sourceOf(platform?: string | null): Source {
  return platform ? "platform" : "agent";
}

export function SourceBadge({ source, label, className = "" }: { source: Source; label?: string; className?: string }) {
  const m = META[source];
  return (
    <Badge tone={m.tone} className={className}>
      <m.Icon className="h-3 w-3" aria-hidden />
      {label ?? m.label}
    </Badge>
  );
}
