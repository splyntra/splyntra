// SPDX-License-Identifier: FSL-1.1-ALv2
import type { NextAuthConfig } from "next-auth";

// Edge-safe config (no DB / bcrypt). Shared by the middleware and the full
// Node instance. The `authorized` callback gates every app route behind login.
// SCIM (RFC 7644) is authenticated by a per-org Bearer token in the route
// handler, not a session cookie — so it must bypass the login gate here. No SCIM
// route exists in the open edition; the handler is composed in by the cloud build.
// `/verify-email` (the email-verification link + its "check your inbox" page) is
// cloud-only but whitelisted here so it's reachable while logged out. No route
// exists in the open edition, so this is inert there.
// The billing webhook is an unauthenticated inbound POST (Paddle) authenticated
// by its own signature in the handler — it must bypass the login gate, like SCIM.
// Cloud-only; inert in the open edition (no such route ships there).
const PUBLIC = ["/login", "/signup", "/verify-email", "/accept-invite", "/api/scim", "/api/billing/webhook"];

// Top-level dashboard route segments that now live under /{org-slug}/… . If one
// appears UN-prefixed (an old link/bookmark, or a not-yet-migrated <Link>), the
// gate redirects it to /{orgSlug}/… so it still resolves. Edge-safe (string set,
// no DB). Auth pages + /api/* are handled separately above and never appear here.
const ORG_ROUTES = new Set<string>([
  "traces", "agents", "platforms", "mcp", "logs", "metrics", "tools",
  "evaluations", "security", "costs", "alerts", "projects", "connect",
  "settings", "ledger", "governance", "identity", "compliance",
]);

export const authConfig: NextAuthConfig = {
  // Self-hosted (Docker/Helm) serves behind a service name / arbitrary host, so
  // trust the incoming Host. Read the secret from either env name (Auth.js v5
  // defaults to AUTH_SECRET; our deploy sets NEXTAUTH_SECRET).
  trustHost: true,
  // Auth.js v5 defaults to AUTH_SECRET; our deploy sets NEXTAUTH_SECRET. In
  // local dev (npm run dev) neither may be set, so fall back to a fixed dev
  // secret — but in production an unset secret is a hard error.
  // The insecure dev secret activates ONLY when NODE_ENV is explicitly
  // "development". In production (or an unset NODE_ENV) it stays undefined, so
  // next-auth hard-fails at startup rather than silently using a known secret.
  secret:
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV === "development" ? "splyntra-dev-insecure-secret" : undefined),
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [], // real providers are added in auth.ts (Node runtime)
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const { pathname } = nextUrl;
      const loggedIn = !!auth?.user;
      const isPublic =
        PUBLIC.some((p) => pathname.startsWith(p)) || pathname.startsWith("/api/auth");
      if (isPublic) return true;
      if (!loggedIn) return false; // redirects to signIn page

      // Logged in but with no ACTIVE org (fresh cloud signup, or an OAuth/SSO user
      // with no membership yet) → send them to onboarding to create one. Gated on
      // an empty orgId, so it never fires in the open edition (its users always
      // have the seeded org). Path is hardcoded (not the onboardingRedirect() seam)
      // because this runs in the edge middleware, where the seam's setter — pulled
      // in via the DB-touching auth-providers overlay — cannot load. Exclude
      // /onboarding itself and /api/* (server action POST, Stripe webhook, etc.)
      // to avoid redirect loops and broken callbacks.
      const { orgId, orgSlug } = auth!.user as { orgId?: string; orgSlug?: string };
      if (!orgId && pathname !== "/onboarding" && !pathname.startsWith("/api")) {
        return Response.redirect(new URL("/onboarding", nextUrl));
      }
      // Path-based org routing safety-net: an un-prefixed dashboard route
      // (/traces, /settings, …) — old bookmark or a link not yet migrated — is
      // redirected to /{orgSlug}/… so it still resolves (the canonical routes now
      // live under /[org]). A first segment that ISN'T a known route is treated as
      // a slug and passes through to the [org] layout for membership resolution.
      if (orgId && orgSlug) {
        const seg = pathname.split("/")[1];
        if (seg && seg !== orgSlug && ORG_ROUTES.has(seg)) {
          return Response.redirect(new URL(`/${orgSlug}${pathname}`, nextUrl));
        }
      }
      return true;
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = (user as { id?: string }).id;
        token.orgId = (user as { orgId?: string }).orgId;
        token.role = (user as { role?: string }).role;
        // orgSlug is the URL key for path-based routing (/{slug}/…). Carried in
        // the JWT so the edge middleware can build slug redirects without a DB.
        token.orgSlug = (user as { orgSlug?: string }).orgSlug;
      }
      // Allow a session update() to set the active org/role/slug without re-login —
      // used by the cloud edition after org creation / switching / slug rename.
      // Edge-safe (no DB): the caller passes the already-resolved values.
      if (trigger === "update" && session) {
        const s = session as { orgId?: string; role?: string; orgSlug?: string };
        if (s.orgId) token.orgId = s.orgId;
        if (s.role) token.role = s.role;
        if (s.orgSlug) token.orgSlug = s.orgSlug;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string;
        (session.user as { orgId?: string }).orgId = token.orgId as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { orgSlug?: string }).orgSlug = token.orgSlug as string;
      }
      return session;
    },
  },
};
