// SPDX-License-Identifier: FSL-1.1-ALv2
// Left rail for the /settings area, grouped into Account + Organization. Merges
// the core settings pages with any contributed by extension slots (the cloud
// build adds Organization/Billing/Usage/SSO via registerSettingsNavItem), gated
// the same way the Sidebar gates nav items (edition flag + per-org plan).
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  User,
  ShieldCheck,
  Users,
  KeyRound,
  Building2,
  CreditCard,
  Gauge,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { features } from "@/lib/features";
import { useOrgHref } from "@/lib/org-path";
import { settingsNavItems, usePlanFeatures, type SettingsNavItem } from "@/lib/slots";

const ICONS: Record<string, LucideIcon> = {
  User,
  ShieldCheck,
  Users,
  KeyRound,
  Building2,
  CreditCard,
  Gauge,
};

// Core settings pages (present in every edition). Cloud adds more via the slot
// registry (see cloud-screens/register.ts).
const CORE_ITEMS: SettingsNavItem[] = [
  { href: "/settings/profile", label: "Profile", icon: "User", group: "account", order: 1 },
  { href: "/settings/security", label: "Security", icon: "ShieldCheck", group: "account", order: 2 },
  { href: "/settings/team", label: "Team", icon: "Users", group: "organization", order: 20 },
  { href: "/settings/keys", label: "API Keys", icon: "KeyRound", group: "organization", order: 30 },
];

const GROUP_LABEL: Record<SettingsNavItem["group"], string> = {
  account: "Account",
  organization: "Organization",
};
const GROUP_ORDER: SettingsNavItem["group"][] = ["account", "organization"];

export function SettingsNav() {
  const pathname = usePathname();
  const oh = useOrgHref();
  const plan = usePlanFeatures();
  const entitled = (pf?: string) => {
    if (!pf) return true;
    if (!plan || plan.loading) return true; // don't flash-lock while loading
    return plan.features.includes(pf);
  };

  const merged = [...CORE_ITEMS, ...settingsNavItems()]
    // edition flag: only show items whose code ships in this edition
    .filter((i) => !i.feature || features[i.feature as keyof typeof features]);

  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    items: merged
      .filter((i) => i.group === g)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  })).filter((g) => g.items.length > 0);

  return (
    <nav className="flex shrink-0 flex-col gap-5 border-b border-gray-100 p-4 md:w-56 md:border-b-0 md:border-r md:p-6 dark:border-gray-800/50">
      {groups.map((group) => (
        <div key={group.group} className="space-y-1">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {GROUP_LABEL[group.group]}
          </div>
          {group.items.map((item) => {
            const href = oh(item.href);
            const isActive = pathname === href || pathname.startsWith(href + "/");
            const Icon = ICONS[item.icon] ?? User;
            const locked = !entitled(item.planFeature);
            return (
              <Link
                key={item.href}
                href={href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all ${
                  isActive
                    ? "bg-splyntra-50 text-splyntra-700 dark:bg-splyntra-950/40 dark:text-splyntra-200"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <Icon
                  className={`h-[17px] w-[17px] flex-shrink-0 ${
                    isActive ? "text-splyntra-600 dark:text-splyntra-400" : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                  }`}
                />
                <span className="flex-1">{item.label}</span>
                {locked && <Lock className="h-3 w-3 flex-shrink-0 text-gray-300 dark:text-gray-600" aria-label="Upgrade required" />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
