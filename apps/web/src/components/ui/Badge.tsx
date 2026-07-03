// SPDX-License-Identifier: AGPL-3.0-only
import { ReactNode } from "react";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "muted";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
  brand: "bg-splyntra-50 text-splyntra-700 ring-splyntra-200 dark:bg-splyntra-950/40 dark:text-splyntra-300 dark:ring-splyntra-900",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  warning: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  danger: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  muted: "bg-transparent text-gray-400 ring-gray-200 dark:text-gray-500 dark:ring-gray-700",
};

/** Small pill for tiers, categories, counts, etc. */
export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
