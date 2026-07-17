// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

const AUTH_ROUTES = ["/login", "/signup", "/accept-invite"];

/** Renders the full app chrome (sidebar) except on auth routes, which are
 * standalone centered pages. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (AUTH_ROUTES.some((p) => pathname.startsWith(p))) {
    return <div className="min-h-screen animate-fade-in">{children}</div>;
  }
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50/50 dark:bg-gray-950/50">
        <div className="animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
