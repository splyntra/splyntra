// SPDX-License-Identifier: FSL-1.1-ALv2
import { Pool } from "pg";

// Server-only Postgres pool for user/team management (next-auth lives in the
// BFF, so user auth talks to Postgres directly rather than via the collector).
const globalForPg = globalThis as unknown as { _pgPool?: Pool };

export const pool =
  globalForPg._pgPool ??
  new Pool({
    connectionString:
      process.env.POSTGRES_DSN ||
      "postgres://splyntra:splyntra@localhost:5432/splyntra?sslmode=disable",
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForPg._pgPool = pool;

export type Role = "owner" | "admin" | "member" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** True if `role` is at least as privileged as `min`. */
export function roleAtLeast(role: string | undefined, min: Role): boolean {
  if (!role || !(role in RANK)) return false;
  return RANK[role as Role] >= RANK[min];
}
