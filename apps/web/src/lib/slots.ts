// SPDX-License-Identifier: AGPL-3.0-only
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
  /** Optional feature flag that must be enabled for this item to render. */
  feature?: string;
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

export type WidgetSlot = "sidebarTop";

const widgets: Record<WidgetSlot, ComponentType[]> = { sidebarTop: [] };

/** Mount a component into a named widget slot. Called by commercial packages. */
export function registerWidget(slot: WidgetSlot, component: ComponentType): void {
  widgets[slot].push(component);
}

/** Components contributed to a widget slot (empty in OSS). */
export function slotWidgets(slot: WidgetSlot): readonly ComponentType[] {
  return widgets[slot];
}
