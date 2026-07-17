// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
// Agent Platforms domain: data hooks + presentation helpers. Platforms are
// orchestrators (Dify/n8n/…), never agents — these read the platform-scoped
// collector endpoints (/v1/platforms) and join in catalog metadata (name/icon).
import { useQuery } from "@tanstack/react-query";
import {
  fetchPlatforms,
  fetchPlatform,
  PlatformsResponse,
  PlatformDetailResponse,
} from "@/lib/api";
import { useProject } from "@/lib/project-context";
import { byCategory, findIntegration } from "@/lib/catalog";

export function usePlatforms(windowSec?: number) {
  const { projectId } = useProject();
  return useQuery<PlatformsResponse>({
    queryKey: ["platforms", windowSec ?? null, projectId],
    queryFn: () => fetchPlatforms(windowSec),
    retry: 1,
  });
}

export function usePlatform(platform: string, windowSec?: number) {
  const { projectId } = useProject();
  return useQuery<PlatformDetailResponse>({
    queryKey: ["platform", platform, windowSec ?? null, projectId],
    queryFn: () => fetchPlatform(platform, windowSec),
    enabled: !!platform,
    retry: 1,
  });
}

// platformMeta resolves a platform id to its catalog display name + icon, so the
// UI shows "Dify" (not "dify") with the right glyph. Falls back gracefully for
// ids not in the catalog (e.g. a platform added server-side before the catalog).
export function platformMeta(id: string): { name: string; icon: string } {
  const i = findIntegration(id);
  if (i) return { name: i.name, icon: i.icon };
  return { name: id.charAt(0).toUpperCase() + id.slice(1), icon: "workflow" };
}

/** Connectable platforms from the catalog (excludes roadmap-only tiles). */
export function connectablePlatforms() {
  return byCategory("platform").filter((p) => !p.tier.includes("planned"));
}

export function successRate(runCount: number, errorCount: number): number {
  if (runCount <= 0) return 0;
  return Math.round(((runCount - errorCount) / runCount) * 100);
}
