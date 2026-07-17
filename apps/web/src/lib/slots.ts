// SPDX-License-Identifier: FSL-1.1-ALv2
// Extension slots for the dashboard. The open build registers nothing, so these
// are empty; the private frontend/cloud-screens package calls registerNavItem
// (from a module imported by the cloud web build) to contribute nav entries for
// its screens. The screens' page files are composed into the app/ route tree at
// cloud-build time — see the cloud-screens README.
//
// This keeps one dashboard codebase: the open viewer is fully usable alone, and
// commercial screens mount in without the open repo importing any private code.

export interface NavSlotItem {
  href: string;
  label: string;
  /** lucide-react icon name, resolved by the Sidebar against its icon map. */
  icon: string;
  /** Optional EDITION flag (build-time NEXT_PUBLIC_FEATURE_*) — gates whether the
   *  item's code ships in this edition at all. */
  feature?: string;
  /** Optional PLAN feature (from shared/pricing.ts) — gates whether the current
   *  org's plan entitles it. Non-entitled items render with an "upgrade" badge
   *  and their screen shows an upsell (kept visible for discoverability). Left to
   *  a bare string so this open module needn't import the commercial pricing types. */
  planFeature?: string;
  /** Sidebar section to place this item in (defaults to "observability"). */
  section?: "agents" | "platforms" | "mcp" | "observability" | "settings";
}

const navItems: NavSlotItem[] = [];

/** Register a sidebar nav item. Called by commercial screen packages. */
export function registerNavItem(item: NavSlotItem): void {
  if (!navItems.some((i) => i.href === item.href)) {
    navItems.push(item);
  }
}

/** Nav items contributed by extension slots (empty in OSS). */
export function navSlotItems(): readonly NavSlotItem[] {
  return navItems;
}

// Widget slots: locations where a commercial build can mount a React component
// (e.g. the org switcher in the sidebar). Empty in OSS.
import type { ComponentType } from "react";

export type WidgetSlot = "sidebarTop" | "sidebarBottom" | "agentTrustGovernance";

const widgets: Record<WidgetSlot, ComponentType[]> = {
  sidebarTop: [],
  sidebarBottom: [],
  agentTrustGovernance: [],
};

/** Mount a component into a named widget slot. Called by commercial packages. */
export function registerWidget(slot: WidgetSlot, component: ComponentType): void {
  widgets[slot].push(component);
}

/** Components contributed to a widget slot (empty in OSS). */
export function slotWidgets(slot: WidgetSlot): readonly ComponentType[] {
  return widgets[slot];
}

// Plan-features provider: the cloud build registers a hook that returns the
// active org's entitled plan features (for per-org, plan-based nav gating). The
// open edition registers none → planFeature items are shown ungated (edition
// flags already decide what ships). `loading` suppresses premature "locked"
// badges while the plan is being fetched.
export type PlanFeatures = { features: readonly string[]; loading: boolean };
type PlanFeaturesProvider = () => PlanFeatures;
let planFeaturesProvider: PlanFeaturesProvider | null = null;

/** Register the hook that resolves the current org's plan features (cloud only). */
export function registerPlanFeaturesProvider(fn: PlanFeaturesProvider): void {
  planFeaturesProvider = fn;
}

/** Read the current org's plan features, or null when no provider is registered
 *  (open edition). This IS a hook (calls the registered hook) — call it
 *  unconditionally from a component; the provider is stable per build. */
export function usePlanFeatures(): PlanFeatures | null {
  return planFeaturesProvider ? planFeaturesProvider() : null;
}

/** Whether the current org is entitled to a plan feature. Returns true in the
 *  open edition (no provider) and while the plan is loading — so widgets on
 *  ungated screens can use it to skip a doomed request / render an upsell in the
 *  cloud build without ever hiding functionality in OSS. This IS a hook. */
export function usePlanFeature(feature: string): boolean {
  const plan = usePlanFeatures();
  if (!plan || plan.loading) return true;
  return plan.features.includes(feature);
}
