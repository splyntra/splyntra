// SPDX-License-Identifier: AGPL-3.0-only
"use client";
// Resolves catalog icon names (strings in catalog.ts) to lucide components, so
// the data module stays free of React imports. Shared by the wizard, the Agent
// Platforms page, and the MCP Servers page.
import {
  Boxes, Sparkles, Workflow, Database, Server, BrainCircuit, Cpu, GitBranch,
  Users, Bot, Share2, Cloud, MessagesSquare, Search, Plug, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  Boxes, Sparkles, Workflow, Database, Server, BrainCircuit, Cpu, GitBranch,
  Users, Bot, Share2, Cloud, MessagesSquare, Search, Plug,
};

export function catalogIcon(name: string): LucideIcon {
  return MAP[name] || Plug;
}

export function CatalogIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const Icon = catalogIcon(name);
  return <Icon className={className} aria-hidden />;
}
