// SPDX-License-Identifier: FSL-1.1-ALv2
// Branding for the signed-in user's active org + the user themselves — the
// sidebar shows the org's name/logo and the user's avatar. Kept out of the JWT
// (avatars/logos are data: URLs and would bloat the cookie) and fetched here,
// membership-verified so a stale/forged orgId can't read another org's brand.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const orgId = (session?.user as { orgId?: string })?.orgId;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const u = await pool.query("SELECT name, email, avatar_url FROM users WHERE id = $1", [userId]);
  const user = u.rows[0]
    ? { name: (u.rows[0].name as string) || (u.rows[0].email as string), avatar: u.rows[0].avatar_url as string | null }
    : { name: "", avatar: null };

  // Join memberships so we only surface an org the user actually belongs to.
  let org: { name: string; logo: string | null } | null = null;
  if (orgId) {
    const o = await pool.query(
      `SELECT o.name, o.logo_url FROM organizations o
       JOIN memberships m ON m.org_id = o.id
       WHERE o.id = $1 AND m.user_id = $2`,
      [orgId, userId]
    );
    if (o.rows[0]) org = { name: o.rows[0].name as string, logo: o.rows[0].logo_url as string | null };
  }

  return NextResponse.json({ user, org });
}
