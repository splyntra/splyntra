// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import {
  Activity,
  Bot,
  DollarSign,
  FolderKanban,
  Bell,
  ShieldCheck,
  ArrowRight,
  LineChart,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";

const cards: { href: string; title: string; desc: string; icon: LucideIcon }[] = [
  { href: "/traces", title: "Traces", desc: "Full execution traces with unified risk scores", icon: Activity },
  { href: "/agents", title: "Agents", desc: "Monitor registered agents, latency, and errors", icon: Bot },
  { href: "/metrics", title: "Metrics", desc: "Time-series observability metrics and trends", icon: LineChart },
  { href: "/evaluations", title: "Evaluation", desc: "Scored evaluations and regression gates", icon: ClipboardCheck },
  { href: "/costs", title: "Costs", desc: "Token spend by run, model, and project", icon: DollarSign },
  { href: "/projects", title: "Projects", desc: "Scope every view to a project", icon: FolderKanban },
  { href: "/alerts", title: "Alerts", desc: "Fire on risk thresholds; view history", icon: Bell },
];

export default function Home() {
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-8 py-16">
      {/* Hero */}
      <div className="mb-12 text-center">
        <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-splyntra-500 to-splyntra-700 text-white shadow-lg shadow-splyntra-500/25">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
          Welcome to <span className="text-gradient">Splyntra</span>
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-gray-500 dark:text-gray-400">
          Unified observability and security for AI agents. See what your agents did and
          whether it was safe — in one view.
        </p>
      </div>

      {/* Navigation cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, title, desc, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group relative rounded-xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-200 hover:border-splyntra-300 hover:shadow-card-hover dark:border-gray-800 dark:bg-gray-900 dark:hover:border-splyntra-700"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-splyntra-50 text-splyntra-600 transition-colors group-hover:bg-splyntra-100 dark:bg-splyntra-950/40 dark:text-splyntra-300">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-gray-900 dark:text-white">
              {title}
              <ArrowRight className="h-4 w-4 -translate-x-1 text-gray-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-splyntra-500 group-hover:opacity-100" />
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{desc}</p>
          </Link>
        ))}
      </div>

      {/* Quick status */}
      <div className="mt-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
          Collector connected at localhost:4318
        </div>
      </div>
    </div>
  );
}
