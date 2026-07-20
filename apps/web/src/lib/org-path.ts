// SPDX-License-Identifier: FSL-1.1-ALv2
// Helpers for path-based org routing: prefix an app path with the active org
// slug ("/traces" -> "/acme/traces"). No "use client" — the pure `orgHref` is
// importable from server components; the hooks are only invoked in client trees.
import { useSession } from "next-auth/react";

// Root-level (org-independent) paths that must never be org-prefixed.
const ROOT_PATHS = ["/login", "/signup", "/logout", "/onboarding", "/verify-email", "/accept-invite"];

/** Prefix an internal app path with the org slug. Leaves external URLs, /api,
 *  root auth paths, and already-prefixed paths untouched. */
export function orgHref(slug: string | undefined, path: string): string {
  if (!slug || !path.startsWith("/")) return path; // external / relative / hash
  if (path.startsWith("/api")) return path;
  if (ROOT_PATHS.some((p) => path === p || path.startsWith(p + "/"))) return path;
  if (path === `/${slug}` || path.startsWith(`/${slug}/`)) return path; // already prefixed
  return path === "/" ? `/${slug}` : `/${slug}${path}`;
}

/** The active org's slug from the session (kept in sync with the URL by OrgSync). */
export function useOrgSlug(): string | undefined {
  const { data } = useSession();
  return (data?.user as { orgSlug?: string } | undefined)?.orgSlug;
}

/** Returns a prefixer bound to the active org slug. */
export function useOrgHref(): (path: string) => string {
  const slug = useOrgSlug();
  return (path: string) => orgHref(slug, path);
}
