// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import Image from "next/image";
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
    <aside className="flex w-64 flex-col border-r border-gray-100 bg-white shadow-sidebar dark:border-gray-800/50 dark:bg-gray-950">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-gray-100 px-5 dark:border-gray-800/50">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.png" alt="Splyntra" width={36} height={36} priority className="h-9 w-9 rounded-xl shadow-md shadow-splyntra-500/20" />
          <div className="leading-tight">
            <span className="block text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">Splyntra</span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Observability · Security</span>
          </div>
        </Link>
      </div>

      {/* Sidebar-top widgets (e.g. org switcher in the cloud build) + project selector */}
      <div className="space-y-3 border-b border-gray-100 px-4 py-4 dark:border-gray-800/50">
        {slotWidgets("sidebarTop").map((W, i) => (
          <W key={i} />
        ))}
        <ProjectSelector />
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all ${
                isActive
                  ? "bg-splyntra-50 text-splyntra-700 shadow-sm shadow-splyntra-100/50 dark:bg-splyntra-950/40 dark:text-splyntra-200 dark:shadow-none"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"
              }`}
            >
              <Icon className={`h-[18px] w-[18px] flex-shrink-0 ${isActive ? "text-splyntra-600 dark:text-splyntra-400" : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800/50">
        <UserFooter />
        <div className="mt-2 flex items-center gap-3 px-2 text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            Connected
          </span>
          <span className="text-gray-300 dark:text-gray-700">·</span>
          <span>v0.3.0</span>
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
    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-900">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">{user.email}</div>
        {user.role && <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{user.role}</div>}
      </div>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        title="Sign out"
        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
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
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Project</span>
      <div className="relative">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 py-2 pl-3 pr-8 text-[13px] font-medium text-gray-700 outline-none transition-colors focus:border-splyntra-400 focus:bg-white focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:focus:bg-gray-800"
        >
          <option value="">All projects</option>
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
