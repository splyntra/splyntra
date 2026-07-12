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
  ShieldAlert,
  Users,
  ScrollText,
  Scale,
  KeyRound,
  CreditCard,
  Building2,
  Fingerprint,
  ShieldCheck,
  FileCheck,
  Plug,
  Workflow,
  Server,
  Wrench,
  Gauge,
  LogOut,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { useProjects } from "@/lib/hooks";
import { Select } from "@/components/ui/Select";
import { useProject } from "@/lib/project-context";
import { features } from "@/lib/features";
import { navSlotItems, slotWidgets, usePlanFeatures } from "@/lib/slots";

// Icons available to slot-contributed nav items (referenced by name so the
// slots module stays free of React/icon imports).
const ICONS: Record<string, LucideIcon> = {
  ScrollText,
  Scale,
  KeyRound,
  Fingerprint,
  ShieldCheck,
  FileCheck,
  CreditCard,
  Building2,
  Users,
  Workflow,
  Server,
  Wrench,
  Plug,
  Gauge,
};

type Section = "" | "agents" | "platforms" | "mcp" | "observability" | "settings";
type NavItem = { href: string; label: string; icon: LucideIcon; section: Section; locked?: boolean };

// Core (open-source) navigation, grouped into sections. Commercial screens
// (governance, identity, compliance, sso, billing) are contributed by extension
// slots in the cloud build and placed into a section via their `section` field.
const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: LayoutDashboard, section: "" },
  { href: "/agents", label: "Agents", icon: Bot, section: "agents" },
  { href: "/platforms", label: "Agent Platforms", icon: Workflow, section: "platforms" },
  { href: "/mcp", label: "MCP Servers", icon: Server, section: "mcp" },
  { href: "/traces", label: "Traces", icon: Activity, section: "observability" },
  { href: "/logs", label: "Logs", icon: ScrollText, section: "observability" },
  { href: "/metrics", label: "Metrics", icon: LineChart, section: "observability" },
  { href: "/tools", label: "Tools & Retrieval", icon: Wrench, section: "observability" },
  { href: "/evaluations", label: "Evaluation", icon: ClipboardCheck, section: "observability" },
  { href: "/security", label: "Security", icon: ShieldAlert, section: "observability" },
  { href: "/costs", label: "Costs", icon: DollarSign, section: "observability" },
  { href: "/projects", label: "Projects", icon: FolderKanban, section: "settings" },
  { href: "/alerts", label: "Alerts", icon: Bell, section: "settings" },
  { href: "/settings/keys", label: "API Keys", icon: KeyRound, section: "settings" },
  { href: "/settings/team", label: "Team", icon: Users, section: "settings" },
];

const SECTION_ORDER: Section[] = ["", "agents", "platforms", "mcp", "observability", "settings"];
const SECTION_LABEL: Record<Section, string> = {
  "": "",
  agents: "Agents",
  platforms: "Agent Platforms",
  mcp: "MCP Servers",
  observability: "Observability",
  settings: "Settings",
};

// Merge core nav with slot-contributed items. Two gates apply to slot items:
//   • feature (edition flag): whether the code ships in this edition at all.
//   • planFeature (per-org plan): whether the org's plan entitles it. Items the
//     plan doesn't include stay VISIBLE but are marked `locked` (badge + upsell
//     screen) for discoverability. While the plan is still loading (or in OSS,
//     where there's no provider), nothing is locked — avoids nav flicker.
function resolveNavItems(plan: { features: readonly string[]; loading: boolean } | null): NavItem[] {
  const entitled = (pf?: string) => {
    if (!pf) return true; // no plan gate
    if (!plan || plan.loading) return true; // unknown yet → don't lock
    return plan.features.includes(pf);
  };
  const slotted = navSlotItems()
    .filter((i) => !i.feature || features[i.feature as keyof typeof features])
    .map((i) => ({
      href: i.href,
      label: i.label,
      icon: ICONS[i.icon] ?? LayoutDashboard,
      section: (i.section as Section) || "observability",
      locked: !entitled(i.planFeature),
    }));
  return [...navItems, ...slotted];
}

export function Sidebar() {
  const pathname = usePathname();
  const planFeatures = usePlanFeatures();
  const items = resolveNavItems(planFeatures);
  const grouped = SECTION_ORDER.map((s) => ({ section: s, items: items.filter((i) => i.section === s) })).filter((g) => g.items.length > 0);

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
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {grouped.map((group) => (
          <div key={group.section || "root"} className="space-y-0.5">
            {SECTION_LABEL[group.section] && (
              <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {SECTION_LABEL[group.section]}
              </div>
            )}
            {group.items.map((item) => {
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
                  <span className="flex-1">{item.label}</span>
                  {item.locked && (
                    <Lock className="h-3 w-3 flex-shrink-0 text-gray-300 dark:text-gray-600" aria-label="Upgrade required" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800/50">
        {/* Sidebar-bottom widgets (e.g. the Upgrade-plan button in the cloud build). */}
        {slotWidgets("sidebarBottom").map((W, i) => (
          <div key={i} className="mb-2">
            <W />
          </div>
        ))}
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
      <Select
        value={projectId}
        onValueChange={setProjectId}
        ariaLabel="Active project"
        className="w-full"
        options={[
          { value: "", label: "All projects" },
          ...projects.map((p) => ({ value: p.id, label: `${p.name} (${p.environment})` })),
        ]}
      />
    </label>
  );
}
