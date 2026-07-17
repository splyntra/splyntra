// SPDX-License-Identifier: FSL-1.1-ALv2
import type { NextAuthConfig } from "next-auth";

// Edge-safe config (no DB / bcrypt). Shared by the middleware and the full
// Node instance. The `authorized` callback gates every app route behind login.
// SCIM (RFC 7644) is authenticated by a per-org Bearer token in the route
// handler, not a session cookie — so it must bypass the login gate here. No SCIM
// route exists in the open edition; the handler is composed in by the cloud build.
const PUBLIC = ["/login", "/signup", "/accept-invite", "/api/scim"];

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
      const orgId = (auth!.user as { orgId?: string }).orgId;
      if (!orgId && pathname !== "/onboarding" && !pathname.startsWith("/api")) {
        return Response.redirect(new URL("/onboarding", nextUrl));
      }
      return true;
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = (user as { id?: string }).id;
        token.orgId = (user as { orgId?: string }).orgId;
        token.role = (user as { role?: string }).role;
      }
      // Allow a session update() to set the active org/role without re-login —
      // used by the cloud edition after org creation / org switching. Edge-safe
      // (no DB): the caller passes the already-resolved values.
      if (trigger === "update" && session) {
        const s = session as { orgId?: string; role?: string };
        if (s.orgId) token.orgId = s.orgId;
        if (s.role) token.role = s.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string;
        (session.user as { orgId?: string }).orgId = token.orgId as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
};
