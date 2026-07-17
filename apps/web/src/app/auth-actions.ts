// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { pool, roleAtLeast } from "@/lib/db";
import { auth, signIn } from "@/auth";
import { registeredInviteHandler } from "@/lib/auth-extensions";
import { notifyMembershipChanged } from "@/lib/collector-auth";

const VALID_ROLES = new Set(["owner", "admin", "member", "viewer"]);

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

// Authorizes the caller as an admin of their active org, verifying the role
// against the DB membership — NOT the JWT `role`, which a client can set via
// next-auth update() (that would be a privilege-escalation hole). Returns the
// caller's org and user id.
async function requireAdminOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const orgId = (session?.user as { orgId?: string })?.orgId;
  if (!userId || !orgId) throw new Error("forbidden");
  const { rows } = await pool.query(
    "SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2",
    [userId, orgId]
  );
  if (!roleAtLeast(rows[0]?.role, "admin")) throw new Error("forbidden");
  return { orgId, userId };
}

// ownerCount returns how many owners the org currently has — used to refuse the
// removal/demotion of the last owner (which would orphan the org).
async function ownerCount(orgId: string): Promise<number> {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM memberships WHERE org_id = $1 AND role = 'owner'",
    [orgId]
  );
  return rows[0]?.n ?? 0;
}

async function memberRole(orgId: string, userId: string): Promise<string | undefined> {
  const { rows } = await pool.query(
    "SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2",
    [userId, orgId]
  );
  return rows[0]?.role as string | undefined;
}

function randomToken(): string {
  // 32 hex chars; crypto is available in the Node server runtime.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function inviteMemberAction(_prev: unknown, formData: FormData) {
  const { orgId, userId } = await requireAdminOrg();
  const email = String(formData.get("email") || "").toLowerCase().trim();
  const role = String(formData.get("role") || "member");
  if (!email) return { error: "Email is required.", token: "" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address.", token: "" };
  if (!VALID_ROLES.has(role) || role === "owner") return { error: "Invalid role.", token: "" };
  // Don't invite someone who is already a member.
  const existing = await pool.query(
    `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1 AND u.email = $2`,
    [orgId, email]
  );
  if ((existing.rowCount ?? 0) > 0) return { error: "That person is already a member.", token: "" };

  // Cloud build: delegate to the registered handler, which enforces the plan's
  // seat cap and emails the invitee. Open edition: create the invitation directly.
  const handler = registeredInviteHandler();
  if (handler) {
    const inviterEmail = ((await auth())?.user as { email?: string })?.email || "";
    const res = await handler({ orgId, invitedByUserId: userId, inviterEmail, email, role });
    if (res.error) return { error: res.error, token: "" };
    revalidatePath("/settings/team");
    return { error: "", token: res.token || "" };
  }

  const token = randomToken();
  // Supersede any prior pending invite for the same email (idempotent re-invite;
  // there's no UNIQUE constraint, so without this a re-invite stacks duplicate
  // pending rows and inflates seat usage).
  await pool.query(
    "DELETE FROM invitations WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL",
    [orgId, email]
  );
  await pool.query(
    `INSERT INTO invitations (org_id, email, role, token, invited_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, email, role, token, userId]
  );
  revalidatePath("/settings/team");
  return { error: "", token };
}

export async function revokeInviteAction(formData: FormData) {
  const { orgId } = await requireAdminOrg();
  const id = String(formData.get("invite_id") || "");
  await pool.query(
    "DELETE FROM invitations WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL",
    [id, orgId]
  );
  revalidatePath("/settings/team");
}

export async function updateRoleAction(formData: FormData) {
  const { orgId } = await requireAdminOrg();
  const userId = String(formData.get("user_id") || "");
  const role = String(formData.get("role") || "member");
  if (!VALID_ROLES.has(role)) return;
  // Refuse to demote the last owner (would leave the org without an owner).
  if (role !== "owner" && (await memberRole(orgId, userId)) === "owner" && (await ownerCount(orgId)) <= 1) {
    return;
  }
  await pool.query("UPDATE memberships SET role = $1 WHERE user_id = $2 AND org_id = $3", [role, userId, orgId]);
  notifyMembershipChanged(userId, orgId); // drop cached membership/role immediately
  revalidatePath("/settings/team");
}

export async function removeMemberAction(formData: FormData) {
  const { orgId } = await requireAdminOrg();
  const userId = String(formData.get("user_id") || "");
  // Refuse to remove the last owner.
  if ((await memberRole(orgId, userId)) === "owner" && (await ownerCount(orgId)) <= 1) {
    return;
  }
  await pool.query("DELETE FROM memberships WHERE user_id = $1 AND org_id = $2", [userId, orgId]);
  notifyMembershipChanged(userId, orgId); // revoke cached access immediately
  revalidatePath("/settings/team");
}

// Accept an invitation as an ALREADY-LOGGED-IN user (signupAction handles the
// new-account case). Joins the invited org with the invited role and marks the
// invite accepted, in one transaction. Without this, a user who already has an
// account can't accept an invite to a second org — team growth would break.
export async function acceptInviteAsUserAction(_prev: unknown, formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) return { error: "Please sign in to accept this invitation." };
  const token = String(formData.get("invite") || "").trim();
  if (!token) return { error: "Missing invite token." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inv = await client.query(
      `SELECT id::text, org_id::text, role FROM invitations
       WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [token]
    );
    if (!inv.rowCount) {
      await client.query("ROLLBACK");
      return { error: "This invitation is invalid or has expired." };
    }
    const { org_id: orgId, role } = inv.rows[0];
    await client.query(
      `INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO NOTHING`,
      [userId, orgId, role]
    );
    await client.query("UPDATE invitations SET accepted_at = NOW() WHERE id = $1", [inv.rows[0].id]);
    await client.query("COMMIT");
    return { error: "", orgId, role };
  } catch {
    await client.query("ROLLBACK");
    return { error: "Could not accept the invitation." };
  } finally {
    client.release();
  }
}
