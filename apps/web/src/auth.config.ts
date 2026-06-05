// SPDX-License-Identifier: AGPL-3.0-only
import type { NextAuthConfig } from "next-auth";

// Edge-safe config (no DB / bcrypt). Shared by the middleware and the full
// Node instance. The `authorized` callback gates every app route behind login.
const PUBLIC = ["/login", "/signup", "/accept-invite"];

export const authConfig: NextAuthConfig = {
  // Self-hosted (Docker/Helm) serves behind a service name / arbitrary host, so
  // trust the incoming Host. Read the secret from either env name (Auth.js v5
  // defaults to AUTH_SECRET; our deploy sets NEXTAUTH_SECRET).
  trustHost: true,
  // Auth.js v5 defaults to AUTH_SECRET; our deploy sets NEXTAUTH_SECRET. In
  // local dev (npm run dev) neither may be set, so fall back to a fixed dev
  // secret — but in production an unset secret is a hard error.
  secret:
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV !== "production" ? "splyntra-dev-insecure-secret" : undefined),
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [], // real providers are added in auth.ts (Node runtime)
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = !!auth?.user;
      const isPublic =
        PUBLIC.some((p) => nextUrl.pathname.startsWith(p)) ||
        nextUrl.pathname.startsWith("/api/auth");
      if (isPublic) return true;
      return loggedIn; // redirects to signIn page when false
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
