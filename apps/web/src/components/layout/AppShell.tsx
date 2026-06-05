// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

const AUTH_ROUTES = ["/login", "/signup", "/accept-invite"];

/** Renders the full app chrome (sidebar) except on auth routes, which are
 * standalone centered pages. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (AUTH_ROUTES.some((p) => pathname.startsWith(p))) {
    return <div className="min-h-screen">{children}</div>;
  }
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
