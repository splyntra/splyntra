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

// Stable no-op provider so usePlanFeatures always invokes exactly one hook (see
// below). Returns null — the open-edition "no plan gating" signal.
const nullPlanFeaturesProvider: () => PlanFeatures | null = () => null;

/** Read the current org's plan features, or null when no provider is registered
 *  (open edition). This IS a hook. The provider is registered once at import and
 *  never changes, so `?? nullPlanFeaturesProvider` is a stable reference and the
 *  call is unconditional — satisfying the rules of hooks (the previous ternary
 *  conditionally invoked a hook). */
export function usePlanFeatures(): PlanFeatures | null {
  return (planFeaturesProvider ?? nullPlanFeaturesProvider)();
}

/** Whether to enable a plan-gated request for the current org. Returns true in
 *  the open edition (no provider) so OSS never gates. In the cloud build it
 *  returns FALSE while the plan is still loading — callers use this as a query
 *  `enabled` flag, and firing before the plan resolves sends a request the plan
 *  may not permit (a 403 flash). Once resolved it reflects real entitlement.
 *  For nav-lock/display (which must not flash-lock during load) use
 *  usePlanFeatures() directly and treat loading as entitled. This IS a hook. */
export function usePlanFeature(feature: string): boolean {
  const plan = usePlanFeatures();
  if (!plan) return true; // open edition — no gating
  if (plan.loading) return false; // cloud: don't fire a request the plan may reject
  return plan.features.includes(feature);
}
