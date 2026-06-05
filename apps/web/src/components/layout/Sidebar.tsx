// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Activity,
  Bot,
  DollarSign,
  LineChart,
  ClipboardCheck,
  FolderKanban,
  Bell,
  Users,
  ScrollText,
  Scale,
  KeyRound,
  CreditCard,
  Building2,
  ShieldCheck,
  ChevronDown,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useProjects } from "@/lib/hooks";
import { useProject } from "@/lib/project-context";
import { features } from "@/lib/features";
import { navSlotItems, slotWidgets } from "@/lib/slots";

// Icons available to slot-contributed nav items (referenced by name so the
// slots module stays free of React/icon imports).
const ICONS: Record<string, LucideIcon> = {
  ScrollText,
  Scale,
  KeyRound,
  CreditCard,
  Building2,
  Users,
};

// Core (open-source) navigation. Commercial sections (governance: ledger,
// policies, delegation) are contributed by extension slots in the cloud build.
const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/traces", label: "Traces", icon: Activity },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/metrics", label: "Metrics", icon: LineChart },
  { href: "/evaluations", label: "Evaluation", icon: ClipboardCheck },
  { href: "/costs", label: "Costs", icon: DollarSign },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings/keys", label: "API Keys", icon: KeyRound },
  { href: "/settings/team", label: "Team", icon: Users },
];

// Merge core nav with slot-contributed items whose feature flag is enabled.
function resolveNavItems(): { href: string; label: string; icon: LucideIcon }[] {
  const slotted = navSlotItems()
    .filter((i) => !i.feature || features[i.feature as keyof typeof features])
    .map((i) => ({ href: i.href, label: i.label, icon: ICONS[i.icon] ?? LayoutDashboard }));
  return [...navItems, ...slotted];
}

export function Sidebar() {
  const pathname = usePathname();
  const items = resolveNavItems();

  return (
    <aside className="flex w-60 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-gray-200 px-4 dark:border-gray-800">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-splyntra-600 text-white shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <span className="block font-semibold tracking-tight text-splyntra-900 dark:text-white">Splyntra</span>
            <span className="block text-[10px] uppercase tracking-wider text-gray-400">Observability + Security</span>
          </div>
        </Link>
      </div>

      {/* Sidebar-top widgets (e.g. org switcher in the cloud build) + project selector */}
      <div className="space-y-3 border-b border-gray-100 px-3 py-3 dark:border-gray-800">
        {slotWidgets("sidebarTop").map((W, i) => (
          <W key={i} />
        ))}
        <ProjectSelector />
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-3">
        {items.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-splyntra-50 font-medium text-splyntra-700 dark:bg-splyntra-900/30 dark:text-splyntra-100"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-splyntra-600 dark:text-splyntra-300" : "text-gray-400 group-hover:text-gray-500"}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-800">
        <UserFooter />
        <div className="mt-2 px-1 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> dev
          </span>
          <span className="ml-2">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}

function UserFooter() {
  const { data: session } = useSession();
  const user = session?.user as { email?: string; role?: string } | undefined;
  if (!user?.email) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{user.email}</div>
        {user.role && <div className="text-[10px] uppercase tracking-wide text-gray-400">{user.role}</div>}
      </div>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        title="Sign out"
        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function ProjectSelector() {
  const { data } = useProjects();
  const { projectId, setProjectId } = useProject();
  const projects = data?.projects || [];

  if (projects.length === 0) return null;

  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-400">Project</span>
      <div className="relative">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-2.5 pr-8 text-sm text-gray-700 outline-none focus:border-splyntra-400 focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">All / default</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.environment})
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      </div>
    </label>
  );
}
