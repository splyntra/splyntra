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
  type LucideIcon,
} from "lucide-react";

const cards: { href: string; title: string; desc: string; icon: LucideIcon }[] = [
  { href: "/traces", title: "Traces", desc: "Full execution traces with unified risk scores", icon: Activity },
  { href: "/agents", title: "Agents", desc: "Monitor registered agents, latency, and errors", icon: Bot },
  { href: "/costs", title: "Costs", desc: "Token spend by run, model, and project", icon: DollarSign },
  { href: "/projects", title: "Projects", desc: "Scope every view to a project", icon: FolderKanban },
  { href: "/alerts", title: "Alerts", desc: "Fire on risk thresholds; view history", icon: Bell },
];

export default function Home() {
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-6 py-16">
      <div className="mb-10 text-center">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-splyntra-600 text-white shadow-sm">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-splyntra-900 dark:text-white">Splyntra</h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-gray-600 dark:text-gray-400">
          Unified observability and security for AI agents. See what your agents did and
          whether it was safe — in one view.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, title, desc, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-splyntra-400 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-splyntra-50 text-splyntra-600 dark:bg-splyntra-900/30 dark:text-splyntra-100">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="flex items-center gap-1 font-semibold text-gray-900 dark:text-white">
              {title}
              <ArrowRight className="h-4 w-4 -translate-x-1 text-gray-300 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </h2>
            <p className="mt-1 text-sm text-gray-500">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
