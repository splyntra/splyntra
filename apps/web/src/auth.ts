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
  events: {
    async signIn({ user, account }) {
      for (const hook of registeredSignInHooks()) {
        await hook(user as { id?: string; email?: string | null }, account);
      }
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
