// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import bcrypt from "bcryptjs";
import { pool, roleAtLeast } from "@/lib/db";
import { auth, signIn } from "@/auth";

// The seeded dev organization (migrations/postgres/001_init.sql). First signup
// joins it as owner; subsequent signups join as members.
const DEV_ORG = "00000000-0000-0000-0000-000000000001";

export async function signupAction(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") || "").toLowerCase().trim();
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "").trim();
  const inviteToken = String(formData.get("invite") || "").trim();

  if (!email || password.length < 8) {
    return { error: "Email and an 8+ char password are required." };
  }

  const client = await pool.connect();
  try {
    const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (existing.rowCount) return { error: "An account with that email already exists." };

    // Resolve org + role from an invite, else default to the dev org.
    let orgId = DEV_ORG;
    let role = "member";
    if (inviteToken) {
      const inv = await client.query(
        "SELECT org_id::text, role FROM invitations WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()",
        [inviteToken]
      );
      if (!inv.rowCount) return { error: "Invite is invalid or expired." };
      orgId = inv.rows[0].org_id;
      role = inv.rows[0].role;
    } else {
      // First user in the org becomes owner.
      const members = await client.query("SELECT count(*)::int AS n FROM memberships WHERE org_id = $1", [orgId]);
      if (members.rows[0].n === 0) role = "owner";
    }

    const hash = await bcrypt.hash(password, 10);
    const u = await client.query(
      "INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id::text",
      [email, hash, name]
    );
    await client.query(
      "INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)",
      [u.rows[0].id, orgId, role]
    );
    if (inviteToken) {
      await client.query("UPDATE invitations SET accepted_at = NOW() WHERE token = $1", [inviteToken]);
    }
  } finally {
    client.release();
  }

  await signIn("credentials", { email, password, redirectTo: "/" });
  return { error: "" };
}

async function requireAdminOrg(): Promise<string> {
  const session = await auth();
  const role = (session?.user as { role?: string })?.role;
  const orgId = (session?.user as { orgId?: string })?.orgId;
  if (!orgId || !roleAtLeast(role, "admin")) throw new Error("forbidden");
  return orgId;
}

function randomToken(): string {
  // 32 hex chars; crypto is available in the Node server runtime.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function inviteMemberAction(_prev: unknown, formData: FormData) {
  const orgId = await requireAdminOrg();
  const email = String(formData.get("email") || "").toLowerCase().trim();
  const role = String(formData.get("role") || "member");
  if (!email) return { error: "Email required." };
  const token = randomToken();
  await pool.query(
    "INSERT INTO invitations (org_id, email, role, token) VALUES ($1,$2,$3,$4)",
    [orgId, email, role, token]
  );
  return { error: "", token };
}

export async function updateRoleAction(formData: FormData) {
  const orgId = await requireAdminOrg();
  const userId = String(formData.get("user_id") || "");
  const role = String(formData.get("role") || "member");
  await pool.query("UPDATE memberships SET role = $1 WHERE user_id = $2 AND org_id = $3", [role, userId, orgId]);
}

export async function removeMemberAction(formData: FormData) {
  const orgId = await requireAdminOrg();
  const userId = String(formData.get("user_id") || "");
  await pool.query("DELETE FROM memberships WHERE user_id = $1 AND org_id = $2", [userId, orgId]);
}
