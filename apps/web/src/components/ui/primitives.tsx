// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

/**
 * Shared UI primitives — one source of truth for cards, page headers, badges,
 * stat tiles, and empty states so every page looks and behaves consistently.
 */

import { ReactNode } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

// ─── Severity ────────────────────────────────────────────────────────────

export type Severity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const SEVERITY_STYLES: Record<Severity, string> = {
  NONE: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 ring-gray-200 dark:ring-gray-700",
  LOW: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900",
  MEDIUM: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-amber-200 dark:ring-amber-900",
  HIGH: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 ring-orange-200 dark:ring-orange-900",
  CRITICAL: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 ring-red-200 dark:ring-red-900",
};

const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  NONE: ShieldCheck,
  LOW: Shield,
  MEDIUM: ShieldQuestion,
  HIGH: ShieldAlert,
  CRITICAL: ShieldAlert,
};

export function severityFromScore(score: number): Severity {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  if (score > 0) return "LOW";
  return "NONE";
}

/** Pill showing a risk score + severity, with a shield icon. */
export function RiskBadge({ score, severity }: { score: number; severity: string }) {
  const sev = (severity as Severity) in SEVERITY_STYLES ? (severity as Severity) : "NONE";
  const Icon = SEVERITY_ICON[sev];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${SEVERITY_STYLES[sev]}`}
      title={`${sev} risk`}
    >
      <Icon className="h-3.5 w-3.5" />
      Risk {score}
    </span>
  );
}

/** Small severity tag (CRITICAL/HIGH/…). */
export function SeverityBadge({ severity }: { severity: string }) {
  const sev = (severity as Severity) in SEVERITY_STYLES ? (severity as Severity) : "NONE";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${SEVERITY_STYLES[sev]}`}>
      {sev}
    </span>
  );
}

// ─── Status ──────────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: string }) {
  const ok = status === "ok" || status === "active";
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        ok
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900"
          : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
      }`}
    >
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  badge,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-splyntra-50 text-splyntra-600 dark:bg-splyntra-950/40 dark:text-splyntra-300">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200/80 bg-white shadow-card dark:border-gray-800 dark:bg-gray-900 ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "text-gray-900 dark:text-white",
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  accent?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-gray-300 dark:text-gray-600" />}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${accent}`}>{value}</div>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-800">
        <Icon className="h-7 w-7" />
      </div>
      <p className="text-[15px] font-medium text-gray-700 dark:text-gray-200">{title}</p>
      {children && <div className="mt-2 max-w-md text-[13px] leading-relaxed text-gray-500">{children}</div>}
    </div>
  );
}
