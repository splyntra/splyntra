// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
  Settings,
  User as UserIcon,
  ChevronUp,
  LogOut,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  type LucideIcon,
} from "lucide-react";
import { useProjects } from "@/lib/hooks";
import { Select } from "@/components/ui/Select";
import { Avatar } from "@/components/ui/Avatar";
import { useBranding } from "@/lib/branding";
import { useOrgHref, useOrgSlug } from "@/lib/org-path";
import { useProject } from "@/lib/project-context";
import { features } from "@/lib/features";
import { navSlotItems, slotWidgets, usePlanFeatures } from "@/lib/slots";
// Dashboard version shown in the footer. Resolves to this package's version at
// build time — in the composed cloud build compose.mjs stages the
// @splyntra/dashboard package.json here, so this reflects the published npm
// version; in the open build it's apps/web's own version.
import { version as APP_VERSION } from "../../../package.json";

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
type NavItem = { href: string; label: string; icon: LucideIcon; section: Section; planFeature?: string; locked?: boolean };

// Core (open-source) navigation, grouped into sections. Commercial screens
// (governance, identity, compliance, sso, billing) are contributed by extension
// slots in the cloud build and placed into a section via their `section` field.
const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: LayoutDashboard, section: "" },
  { href: "/projects", label: "Projects", icon: FolderKanban, section: "" },
  { href: "/agents", label: "Agents", icon: Bot, section: "agents" },
  { href: "/platforms", label: "Agent Platforms", icon: Workflow, section: "platforms" },
  { href: "/mcp", label: "MCP Servers", icon: Server, section: "mcp" },
  { href: "/traces", label: "Traces", icon: Activity, section: "observability" },
  { href: "/logs", label: "Logs", icon: ScrollText, section: "observability" },
  { href: "/metrics", label: "Metrics", icon: LineChart, section: "observability" },
  { href: "/tools", label: "Tools & Retrieval", icon: Wrench, section: "observability" },
  { href: "/evaluations", label: "Evaluation", icon: ClipboardCheck, section: "observability", planFeature: "evaluation" },
  { href: "/security", label: "Security", icon: ShieldAlert, section: "observability", planFeature: "secret_pii_detection" },
  { href: "/costs", label: "Costs", icon: DollarSign, section: "observability" },
  { href: "/alerts", label: "Alerts", icon: Bell, section: "settings" },
  // Team, API Keys, Billing, Usage, SSO now live inside the /settings area's own
  // sub-nav (see app/settings/SettingsNav.tsx). One entry point from here.
  { href: "/settings", label: "Settings", icon: Settings, section: "settings" },
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

// Merge core nav with slot-contributed items. Two gates apply (to both core and
// slot items that carry them):
//   • feature (edition flag): whether the code ships in this edition at all.
//   • planFeature (per-org plan): whether the org's plan entitles it. Items the
//     plan doesn't include stay VISIBLE but are marked `locked` (badge + upsell
//     screen) for discoverability. While the plan is still loading (or in OSS,
//     where there's no provider), nothing is locked — avoids nav flicker.
// Core items may also carry a planFeature (e.g. Evaluation = Pro+ on cloud); in
// OSS the provider is null so they never lock.
function resolveNavItems(plan: { features: readonly string[]; loading: boolean } | null): NavItem[] {
  const entitled = (pf?: string) => {
    if (!pf) return true; // no plan gate
    if (!plan || plan.loading) return true; // unknown yet → don't lock
    return plan.features.includes(pf);
  };
  const core = navItems.map((i) => ({ ...i, locked: !entitled(i.planFeature) }));
  const slotted = navSlotItems()
    .filter((i) => !i.feature || features[i.feature as keyof typeof features])
    .map((i) => ({
      href: i.href,
      label: i.label,
      icon: ICONS[i.icon] ?? LayoutDashboard,
      section: (i.section as Section) || "observability",
      locked: !entitled(i.planFeature),
    }));
  return [...core, ...slotted];
}

export function Sidebar() {
  const pathname = usePathname();
  const planFeatures = usePlanFeatures();
  const { data: branding } = useBranding();
  const orgName = branding?.org?.name || "Workspace";
  const orgLogo = branding?.org?.logo || null;
  const orgSlug = useOrgSlug();
  const oh = useOrgHref();
  const items = resolveNavItems(planFeatures);
  const grouped = SECTION_ORDER.map((s) => ({ section: s, items: items.filter((i) => i.section === s) })).filter((g) => g.items.length > 0);

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("splyntra:sidebar-collapsed");
      if (saved !== null) {
        setCollapsed(saved === "true");
      }
    } catch {}
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("splyntra:sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  }, []);

  // Keyboard shortcut: Cmd+B / Ctrl+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleCollapsed]);

  return (
    <aside
      aria-label="Sidebar navigation"
      className={`flex flex-col border-r border-gray-100 bg-white shadow-sidebar transition-[width] duration-200 ease-in-out dark:border-gray-800/50 dark:bg-gray-950 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Active organization brand & collapse toggle */}
      <div
        className={`flex h-16 items-center border-b border-gray-100 dark:border-gray-800/50 ${
          collapsed ? "justify-center px-2" : "justify-between gap-2 px-4"
        }`}
      >
        {collapsed ? (
          <div className="flex flex-col items-center justify-center">
            <Link href={oh("/")} title={`${orgName} (Workspace)`} className="group relative flex items-center justify-center">
              <Avatar name={orgName} src={orgLogo} size="sm" square className="shadow-sm shadow-splyntra-500/20" />
            </Link>
          </div>
        ) : (
          <Link href={oh("/")} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar name={orgName} src={orgLogo} size="md" square className="shrink-0 shadow-md shadow-splyntra-500/20" />
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">{orgName}</span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Workspace</span>
            </div>
          </Link>
        )}

        <div className={`flex items-center ${collapsed ? "mt-1.5" : "gap-1"}`}>
          {!collapsed && slotWidgets("brandActions").length > 0 && (
            <div className="flex flex-shrink-0 items-center gap-1">
              {slotWidgets("brandActions").map((W, i) => (
                <W key={i} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
            title={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Sidebar-top widgets (e.g. org switcher in the cloud build) + project selector */}
      <div className={`border-b border-gray-100 dark:border-gray-800/50 ${collapsed ? "px-2 py-2 space-y-2" : "space-y-3 px-4 py-4"}`}>
        {slotWidgets("sidebarTop").map((W, i) => (
          <div key={i} className={collapsed ? "flex justify-center" : ""}>
            <W />
          </div>
        ))}
        <ProjectSelector collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto ${collapsed ? "space-y-2 px-2 py-3" : "space-y-4 px-3 py-4"}`}>
        {grouped.map((group, groupIdx) => (
          <div key={group.section || "root"} className="space-y-0.5">
            {collapsed ? (
              groupIdx > 0 && <div className="my-2 border-t border-gray-100 dark:border-gray-800/60" />
            ) : (
              SECTION_LABEL[group.section] && (
                <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {SECTION_LABEL[group.section]}
                </div>
              )
            )}
            {group.items.map((item) => {
              const href = oh(item.href);
              const isActive = href === `/${orgSlug}` ? pathname === href : pathname.startsWith(href);
              const Icon = item.icon;
              const titleText = `${item.label}${item.locked ? " (Upgrade required)" : ""}`;

              if (collapsed) {
                return (
                  <Link
                    key={item.href}
                    href={href}
                    title={titleText}
                    aria-label={titleText}
                    className={`group relative flex h-10 w-10 mx-auto items-center justify-center rounded-lg transition-all ${
                      isActive
                        ? "bg-splyntra-50 text-splyntra-700 shadow-sm shadow-splyntra-100/50 dark:bg-splyntra-950/40 dark:text-splyntra-200 dark:shadow-none"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"
                    }`}
                  >
                    <Icon
                      className={`h-[18px] w-[18px] flex-shrink-0 ${
                        isActive
                          ? "text-splyntra-600 dark:text-splyntra-400"
                          : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                      }`}
                    />
                    {item.locked && (
                      <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      </span>
                    )}
                  </Link>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={href}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all ${
                    isActive
                      ? "bg-splyntra-50 text-splyntra-700 shadow-sm shadow-splyntra-100/50 dark:bg-splyntra-950/40 dark:text-splyntra-200 dark:shadow-none"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"
                  }`}
                >
                  <Icon
                    className={`h-[18px] w-[18px] flex-shrink-0 ${
                      isActive
                        ? "text-splyntra-600 dark:text-splyntra-400"
                        : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                    }`}
                  />
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
      <div className={`border-t border-gray-100 dark:border-gray-800/50 ${collapsed ? "px-2 py-3" : "px-4 py-3"}`}>
        {/* Sidebar-bottom widgets (e.g. the Upgrade-plan button in the cloud build). */}
        {slotWidgets("sidebarBottom").map((W, i) => (
          <div key={i} className={`mb-2 ${collapsed ? "flex justify-center" : ""}`}>
            <W />
          </div>
        ))}
        <UserMenu collapsed={collapsed} />
        {collapsed ? (
          <div
            className="mt-2 flex items-center justify-center py-1 text-gray-400"
            title={`Connected · v${APP_VERSION}`}
            aria-label={`Connected, version ${APP_VERSION}`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3 px-2 text-[11px] text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              Connected
            </span>
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span>v{APP_VERSION}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// Account menu: avatar + name, opening a small popover (Profile / Settings /
// Sign out). Closes on outside-click or Escape.
function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { data: session } = useSession();
  const { data: branding } = useBranding();
  const oh = useOrgHref();
  const user = session?.user as { email?: string; name?: string; role?: string } | undefined;
  const [open, setOpen] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.email) {
      const seeded = ["splyntra@gmail.com"];
      const envAdmins = String(process.env.NEXT_PUBLIC_SUPER_ADMINS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (seeded.includes(user.email.toLowerCase().trim()) || envAdmins.includes(user.email.toLowerCase().trim())) {
        setIsSuper(true);
      } else {
        fetch("/api/admin/check")
          .then((r) => r.json())
          .then((d) => {
            if (d?.isAdmin) setIsSuper(true);
          })
          .catch(() => {});
      }
    }
  }, [user?.email]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user?.email) return null;
  const label = user.name || user.email;
  const itemCls =
    "flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800";

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          role="menu"
          className={`absolute z-30 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900 ${
            collapsed ? "bottom-0 left-full ml-2 w-48 mb-0" : "bottom-full left-0 right-0 mb-2"
          }`}
        >
          <Link href={oh("/settings/profile")} role="menuitem" onClick={() => setOpen(false)} className={itemCls}>
            <UserIcon className="h-4 w-4 text-gray-400" /> Profile
          </Link>
          <Link href={oh("/settings")} role="menuitem" onClick={() => setOpen(false)} className={itemCls}>
            <Settings className="h-4 w-4 text-gray-400" /> Settings
          </Link>
          {isSuper && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950/40"
            >
              <ShieldCheck className="h-4 w-4 text-purple-500" /> Admin Console
            </Link>
          )}
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          <button role="menuitem" onClick={() => signOut({ callbackUrl: "/login" })} className={itemCls}>
            <LogOut className="h-4 w-4 text-gray-400" /> Sign out
          </button>
        </div>
      )}
      {collapsed ? (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={label}
          aria-label={`User menu for ${label}`}
          className="flex h-10 w-10 mx-auto items-center justify-center rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        >
          <Avatar name={label} src={branding?.user?.avatar} size="sm" />
        </button>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
        >
          <Avatar name={label} src={branding?.user?.avatar} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">{label}</span>
            {user.role && (
              <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-400">{user.role}</span>
            )}
          </span>
          <ChevronUp className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? "" : "rotate-180"}`} />
        </button>
      )}
    </div>
  );
}

export function ProjectSelector({ collapsed = false }: { collapsed?: boolean }) {
  const { data, isLoading } = useProjects();
  const { projectId, setProjectId } = useProject();
  const [menuOpen, setMenuOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const allProjects = data?.projects || [];
  const projects = allProjects.filter((p) => !p.archived_at);
  const activeProject = projects.find((p) => p.id === projectId);

  // If the currently selected project was archived or deleted, clear the active project selection
  useEffect(() => {
    if (projectId && !isLoading && allProjects.length > 0) {
      const isStillActive = projects.some((p) => p.id === projectId);
      if (!isStillActive) {
        setProjectId("");
      }
    }
  }, [projectId, isLoading, allProjects, projects, setProjectId]);

  // Outside-click and escape handling for collapsed popover
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Skeleton while projects load (first paint / hard refresh) so the control
  // holds its place instead of popping in.
  if (isLoading) {
    if (collapsed) {
      return (
        <div className="flex justify-center py-1">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        </div>
      );
    }
    return (
      <div className="block">
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Project</span>
        <div className="h-9 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }
  if (projects.length === 0) return null;

  if (collapsed) {
    const projectTitle = activeProject ? `Project: ${activeProject.name} (${activeProject.environment})` : "Project: All projects";
    return (
      <div ref={popoverRef} className="relative flex justify-center">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          title={projectTitle}
          aria-label={projectTitle}
          className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
            projectId
              ? "border-splyntra-200 bg-splyntra-50 text-splyntra-700 dark:border-splyntra-800 dark:bg-splyntra-950/50 dark:text-splyntra-200"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          <FolderKanban className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute left-full top-0 z-30 ml-2 max-h-64 w-56 overflow-auto rounded-xl border border-gray-100 bg-white p-1 shadow-xl dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Select Project
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectId("");
                setMenuOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs text-left ${
                projectId === ""
                  ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-white"
                  : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              <span>All projects</span>
              {projectId === "" && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setProjectId(p.id);
                  setMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs text-left ${
                  projectId === p.id
                    ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-white"
                    : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="truncate">{p.name} ({p.environment})</span>
                {projectId === p.id && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

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
