// SPDX-License-Identifier: AGPL-3.0-only
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/auth.config";
import { pool } from "@/lib/db";
// Side-effect import: a no-op in the open edition; the cloud build's overlay
// replaces this module to register OAuth providers + the org-onboarding hook.
import "@/lib/auth-providers";
import { registeredAuthProviders, registeredSignInHooks } from "@/lib/auth-extensions";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Sign-in guards run BEFORE a session is issued and can DENY sign-in. The
    // cloud build registers one that persists/links the OAuth identity (refusing
    // unverified-email linking) and fails closed — so a user never ends up with a
    // session but no backing user row. Open edition registers none (always true).
    async signIn({ user, account, profile }) {
      for (const hook of registeredSignInHooks()) {
        try {
          const ok = await hook(user as { id?: string; email?: string | null }, account, profile);
          if (ok === false) return false;
        } catch {
          return false; // fail closed
        }
      }
      return true;
    },
    // Node-runtime jwt: run the edge-safe base logic first (copies orgId/role from
    // `user` on credentials/SAML sign-in and from update()), then — for OAuth
    // sign-ins where the provider's `user.id` is NOT our DB id and no orgId was
    // resolved — look the user up by email and set the real DB userId + default
    // org/role. Guarded on `!token.orgId` so credentials/SAML (already set) and
    // subsequent requests (no `user`) are untouched. A user with no membership
    // keeps an empty orgId → the onboarding redirect (auth.config) sends them there.
    async jwt(params) {
      const base = authConfig.callbacks?.jwt;
      let token = base ? await base(params) : params.token;
      const { user } = params;
      const email = (user as { email?: string | null } | undefined)?.email;
      if (user && email && !(token as { orgId?: string }).orgId) {
        try {
          const { rows } = await pool.query(
            `SELECT u.id::text AS user_id, m.org_id::text AS org_id, m.role
             FROM users u
             LEFT JOIN memberships m ON m.user_id = u.id
             WHERE u.email = $1
             ORDER BY m.created_at ASC
             LIMIT 1`,
            [email.toLowerCase().trim()]
          );
          const row = rows[0];
          if (row) {
            const t = token as { userId?: string; orgId?: string; role?: string };
            t.userId = row.user_id;
            if (row.org_id) {
              t.orgId = row.org_id;
              t.role = row.role || "member";
            }
          }
        } catch {
          // DB unavailable → leave token as-is; onboarding/authz still gate access.
        }
      }
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email || "").toLowerCase().trim();
        const password = String(creds?.password || "");
        if (!email || !password) return null;

        const { rows } = await pool.query(
          `SELECT u.id::text, u.email, u.name, u.password_hash,
                  m.org_id::text AS org_id, m.role
           FROM users u
           LEFT JOIN memberships m ON m.user_id = u.id
           WHERE u.email = $1
           ORDER BY m.created_at ASC
           LIMIT 1`,
          [email]
        );
        const row = rows[0];
        if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.name,
          orgId: row.org_id,
          role: row.role || "member",
        };
      },
    }),
    // Extension providers (OAuth in the cloud build; none in the open edition).
    ...registeredAuthProviders(),
  ],
});
