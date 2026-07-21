// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool, roleAtLeast, roleRank } from "@/lib/db";
import { auth, signIn } from "@/auth";
import {
  registeredInviteHandler,
  registeredSignupProvisioner,
  registeredVerificationSender,
  registeredAccountAuthInfo,
  registeredAccountDisconnect,
  registeredNotifier,
  type NotifierInput,
} from "@/lib/auth-extensions";
import { notifyMembershipChanged } from "@/lib/collector-auth";

const VALID_ROLES = new Set(["owner", "admin", "member", "viewer"]);

// Emit an org notification through the cloud seam (no-op in the open edition, which
// registers no notifier). Best-effort: a notification must never fail or delay the
// membership mutation that produced it, so this never throws.
async function emitNotification(input: NotifierInput): Promise<void> {
  const n = registeredNotifier();
  if (!n) return;
  try {
    await n(input);
  } catch {
    /* best-effort — the feed is a side effect, not part of the mutation */
  }
}

// The seeded dev organization (migrations/postgres/001_init.sql). First signup
// joins it as owner; subsequent signups join as members.
const DEV_ORG = "00000000-0000-0000-0000-000000000001";

export async function signupAction(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") || "").toLowerCase().trim();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const name = String(formData.get("name") || "").trim();
  const inviteToken = String(formData.get("invite") || "").trim();
  // Org fields — used only by the cloud build (a signup provisioner is registered),
  // where signup creates the user's OWN org. Ignored in the open edition.
  const orgName = String(formData.get("org_name") || "").trim();
  const orgType = String(formData.get("org_type") || "").trim();
  // Consent captured on the signup form: a marketing-email opt-in (optional) and
  // acceptance of the Terms/Privacy (the form requires it). Stored on the user
  // (marketing_opt_in + terms_accepted_at) for the admin/marketing tooling. A
  // checkbox posts its `value` only when ticked, so absence = false/not-accepted.
  const marketingOptIn = formData.get("marketing_opt_in") === "true";
  const termsAccepted = formData.get("terms") === "true";

  if (!email || password.length < 8) {
    return { error: "Email and an 8+ char password are required." };
  }
  // Confirm-password: only fresh (non-invite) signup forms carry `confirm`.
  // Invite acceptance (accept-invite) reuses signupAction WITHOUT it, so gate the
  // match on there being no invite token — else an invited signup would be rejected.
  if (!inviteToken && confirm !== password) {
    return { error: "Passwords do not match." };
  }

  // Cloud build: an org provisioner creates the user's single default org from
  // the signup form (no dev-org join). Open edition: none → seeded dev org.
  const provisioner = registeredSignupProvisioner();
  if (provisioner && !inviteToken && !orgName) {
    return { error: "Organisation name is required." };
  }

  let newUserId = "";
  const client = await pool.connect();
  try {
    const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (existing.rowCount) return { error: "An account with that email already exists." };

    // Resolve org + role from an invite, else (open edition) default to the dev
    // org. With a provisioner, the org is created inside the transaction below.
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
    } else if (!provisioner) {
      // First user in the seeded org becomes owner (open edition only).
      const members = await client.query("SELECT count(*)::int AS n FROM memberships WHERE org_id = $1", [orgId]);
      if (members.rows[0].n === 0) role = "owner";
    }

    const hash = await bcrypt.hash(password, 10);
    // Atomic: user + membership/org (+ invite accept) commit together, so a
    // failure never leaves an orphaned user row with no membership (which would
    // trap the account in the onboarding redirect and block re-signup). The
    // unique-violation catch also closes the check-then-insert race between two
    // concurrent signups of the same email.
    try {
      await client.query("BEGIN");
      const u = await client.query(
        `INSERT INTO users (email, password_hash, name, marketing_opt_in, terms_accepted_at)
         VALUES ($1,$2,$3,$4, CASE WHEN $5 THEN NOW() ELSE NULL END) RETURNING id::text`,
        [email, hash, name, marketingOptIn, termsAccepted]
      );
      newUserId = u.rows[0].id;
      if (inviteToken) {
        await client.query(
          "INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)",
          [newUserId, orgId, role]
        );
        await client.query("UPDATE invitations SET accepted_at = NOW() WHERE token = $1", [inviteToken]);
      } else if (provisioner) {
        // Cloud: create the user's own org + owner membership + plan in this txn.
        await provisioner(client, { userId: newUserId, email, orgName, orgType });
      } else {
        await client.query(
          "INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)",
          [newUserId, orgId, role]
        );
      }
      await client.query("COMMIT");
      // New member joined via an accepted invite → notify the org's admins.
      if (inviteToken) {
        await emitNotification({
          orgId,
          type: "member_joined",
          title: `${email} joined the organization`,
          link: "/settings/team",
          actorUserId: newUserId,
          actorEmail: email,
          audience: "admins",
        });
      }
    } catch (e) {
      // Roll back best-effort; never let a ROLLBACK error mask the original one
      // (which carries the unique-violation code for the friendly message).
      await client.query("ROLLBACK").catch(() => {});
      if ((e as { code?: string }).code === "23505") {
        return { error: "An account with that email already exists." };
      }
      throw e;
    }
  } finally {
    client.release();
  }

  // Email verification (cloud). If a sender is registered and it leaves the
  // account pending (the verify email was sent), send the user to a "check your
  // inbox" page instead of signing in — a registered sign-in hook then blocks
  // login until they verify. Open edition (no sender), or an unconfigured/failed
  // mailer, falls through to immediate sign-in so a signup is never trapped.
  // Invite acceptance skips verification (the address was already invited) and
  // signs in directly, preserving the existing join-immediately behavior.
  const sender = registeredVerificationSender();
  if (sender && !inviteToken) {
    let pending = false;
    try {
      ({ pending } = await sender({ userId: newUserId, email, name }));
    } catch {
      pending = false; // fail-soft
    }
    if (pending) redirect("/verify-email/sent");
  }

  await signIn("credentials", { email, password, redirectTo: "/" });
  return { error: "" };
}

// Authorizes the caller as an admin of their active org, verifying the role
// against the DB membership — NOT the JWT `role`, which a client can set via
// next-auth update() (that would be a privilege-escalation hole). Returns the
// caller's org and user id.
async function requireAdminOrg(): Promise<{ orgId: string; userId: string; role: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const orgId = (session?.user as { orgId?: string })?.orgId;
  if (!userId || !orgId) throw new Error("forbidden");
  const { rows } = await pool.query(
    "SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2",
    [userId, orgId]
  );
  const role = rows[0]?.role as string | undefined;
  if (!roleAtLeast(role, "admin")) throw new Error("forbidden");
  return { orgId, userId, role: role as string };
}

// Resolves the signed-in user id (no org/role needed) for account (self)
// mutations — profile, password, email, delete-account.
async function requireUser(): Promise<{ userId: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) throw new Error("forbidden");
  return { userId };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Update the signed-in user's display name. */
export async function updateProfileAction(_prev: unknown, formData: FormData) {
  const { userId } = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Name is required." };
  if (name.length > 255) return { error: "Name is too long (255 max)." };
  await pool.query("UPDATE users SET name = $1 WHERE id = $2", [name, userId]);
  revalidatePath("/settings/profile");
  return { error: "", ok: true };
}

/**
 * Set or change the signed-in user's password. Social/SAML users have no password
 * (`password_hash = ''`) — for them this SETS a first password (no current one to
 * verify), which also enables email+password sign-in as a backup. Users who already
 * have a password must confirm the current one.
 */
export async function changePasswordAction(_prev: unknown, formData: FormData) {
  const { userId } = await requireUser();
  const current = String(formData.get("current") || "");
  const next = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "New passwords do not match." };
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const hash = rows[0]?.password_hash as string | undefined;
  const hasPassword = !!hash; // '' (social/SAML) → set path, no current required
  if (hasPassword && !(await bcrypt.compare(current, hash!))) {
    return { error: "Current password is incorrect." };
  }
  const newHash = await bcrypt.hash(next, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, userId]);
  revalidatePath("/settings/security");
  return { error: "", ok: true, set: !hasPassword };
}

/**
 * Change the signed-in user's login email (re-authenticates with the password).
 * In the cloud build the new address must be re-verified: the registered
 * verification sender marks the account pending + emails the link, and the
 * client signs the user out to re-verify. Open edition: the email just changes.
 */
export async function changeEmailAction(_prev: unknown, formData: FormData) {
  const { userId } = await requireUser();
  const email = String(formData.get("email") || "").toLowerCase().trim();
  const password = String(formData.get("password") || "");
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  // Email is the re-link key for OAuth/SAML sign-in — changing it for a
  // provider-linked user would orphan their identity / create a duplicate account
  // on next sign-in. So it's managed by the provider and can't be changed here.
  const info = registeredAccountAuthInfo();
  if (info) {
    const { providers } = await info(userId);
    if (providers.length > 0) {
      return { error: "Your email is managed by your connected sign-in — change it with that provider." };
    }
  }
  const { rows } = await pool.query(
    "SELECT email, name, password_hash FROM users WHERE id = $1",
    [userId]
  );
  const cur = rows[0];
  if (!cur || !cur.password_hash || !(await bcrypt.compare(password, cur.password_hash))) {
    return { error: "Password is incorrect." };
  }
  if (email === cur.email) return { error: "That's already your email address." };
  try {
    await pool.query("UPDATE users SET email = $1 WHERE id = $2", [email, userId]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { error: "That email is already in use." };
    throw e;
  }
  const sender = registeredVerificationSender();
  if (sender) {
    let pending = false;
    try {
      ({ pending } = await sender({ userId, email, name: String(cur.name || "") }));
    } catch {
      pending = false; // fail-soft — email changed, just no forced re-verify
    }
    if (pending) return { error: "", reverify: true };
  }
  return { error: "", ok: true };
}

/**
 * Delete the signed-in user's account (re-authenticates with the password).
 * Blocked while they are the SOLE owner of any org — that org would be orphaned;
 * they must transfer ownership or delete it first. The DELETE cascades their
 * memberships, OAuth identities, and verification rows.
 */
export async function deleteAccountAction(_prev: unknown, formData: FormData) {
  const { userId } = await requireUser();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const hash = rows[0]?.password_hash as string | undefined;
  if (hash) {
    // Password user → re-authenticate with the password.
    if (!(await bcrypt.compare(password, hash))) return { error: "Password is incorrect." };
  } else {
    // Social/SAML user (no password) → require the typed confirmation server-side
    // (they're already authenticated via the session cookie).
    if (confirm !== "DELETE") return { error: 'Type "DELETE" to confirm.' };
  }
  const sole = await pool.query(
    `SELECT o.org_id FROM memberships o
     WHERE o.user_id = $1 AND o.role = 'owner'
       AND (SELECT count(*) FROM memberships x WHERE x.org_id = o.org_id AND x.role = 'owner') = 1`,
    [userId]
  );
  if ((sole.rowCount ?? 0) > 0) {
    return {
      error:
        "You're the sole owner of one or more organizations. Transfer ownership or delete them before deleting your account.",
    };
  }
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  return { error: "", deleted: true };
}

/**
 * Unlink a connected sign-in provider (Google/GitHub/SAML). Delegated to the cloud
 * seam, which refuses to remove the user's LAST sign-in method (they'd be locked
 * out) — "set a password first". No-op in the open edition (no linked identities).
 */
export async function disconnectProviderAction(_prev: unknown, formData: FormData) {
  const { userId } = await requireUser();
  const provider = String(formData.get("provider") || "").trim();
  if (!provider) return { error: "No provider specified." };
  const disconnect = registeredAccountDisconnect();
  if (!disconnect) return { error: "Connected accounts aren't available here." };
  const res = await disconnect(userId, provider);
  if (res.error) return { error: res.error };
  revalidatePath("/settings/security");
  return { error: "", ok: true };
}

// Max length of a stored avatar/logo data: URL (mirrors lib/image MAX_DATA_URL_BYTES).
const MAX_IMAGE_DATA_URL = 512 * 1024;

/** Set or clear the signed-in user's avatar (a client-resized data: URL; "" removes it). */
export async function updateAvatarAction(dataUrl: string) {
  const { userId } = await requireUser();
  const v = String(dataUrl || "");
  if (v && (!v.startsWith("data:image/") || v.length > MAX_IMAGE_DATA_URL)) {
    return { error: "Invalid image." };
  }
  await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [v || null, userId]);
  revalidatePath("/settings/profile");
  return { error: "" };
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
  const { orgId, role: actorRole } = await requireAdminOrg();
  const targetId = String(formData.get("user_id") || "");
  const role = String(formData.get("role") || "member");
  if (!VALID_ROLES.has(role)) return;
  // Only an owner may grant the owner role — blocks an admin self-promoting to
  // owner (privilege escalation).
  if (role === "owner" && actorRole !== "owner") return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the org's owner rows: serializes concurrent role/remove changes so the
    // last-owner check can't be raced into orphaning the org (zero owners).
    const owners = await client.query(
      "SELECT user_id FROM memberships WHERE org_id = $1 AND role = 'owner' FOR UPDATE",
      [orgId]
    );
    const cur = await client.query(
      "SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2",
      [orgId, targetId]
    );
    const targetRole = cur.rows[0]?.role as string | undefined;
    if (!targetRole) { await client.query("ROLLBACK"); return; }
    // An actor cannot modify a member who outranks them (e.g. admin vs owner).
    if (roleRank(targetRole) > roleRank(actorRole)) { await client.query("ROLLBACK"); return; }
    // Refuse to demote the last owner.
    const ownerIds = owners.rows.map((r) => r.user_id as string);
    if (role !== "owner" && targetRole === "owner" && ownerIds.length <= 1) {
      await client.query("ROLLBACK"); return;
    }
    await client.query("UPDATE memberships SET role = $1 WHERE user_id = $2 AND org_id = $3", [role, targetId, orgId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  notifyMembershipChanged(targetId, orgId); // drop cached membership/role immediately
  // Tell the affected member their access level changed.
  await emitNotification({
    orgId,
    type: "role_changed",
    title: `Your role is now ${role}`,
    link: "/settings/team",
    audience: { userIds: [targetId] },
  });
  revalidatePath("/settings/team");
}

export async function removeMemberAction(formData: FormData) {
  const { orgId, userId: actorId, role: actorRole } = await requireAdminOrg();
  const targetId = String(formData.get("user_id") || "");

  let removedEmail = "";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owners = await client.query(
      "SELECT user_id FROM memberships WHERE org_id = $1 AND role = 'owner' FOR UPDATE",
      [orgId]
    );
    const cur = await client.query(
      `SELECT m.role, u.email FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 AND m.user_id = $2`,
      [orgId, targetId]
    );
    const targetRole = cur.rows[0]?.role as string | undefined;
    if (!targetRole) { await client.query("ROLLBACK"); return; }
    removedEmail = (cur.rows[0]?.email as string) || "";
    // An actor cannot remove a member who outranks them (e.g. admin vs owner).
    if (roleRank(targetRole) > roleRank(actorRole)) { await client.query("ROLLBACK"); return; }
    // Refuse to remove the last owner.
    const ownerIds = owners.rows.map((r) => r.user_id as string);
    if (targetRole === "owner" && ownerIds.length <= 1) { await client.query("ROLLBACK"); return; }
    await client.query("DELETE FROM memberships WHERE user_id = $1 AND org_id = $2", [targetId, orgId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  notifyMembershipChanged(targetId, orgId); // revoke cached access immediately
  // Notify the remaining admins (the removed user is no longer a member, so the
  // "admins" audience naturally excludes them).
  await emitNotification({
    orgId,
    type: "member_removed",
    title: `${removedEmail || "A member"} was removed from the organization`,
    link: "/settings/team",
    actorUserId: actorId,
    audience: "admins",
  });
  revalidatePath("/settings/team");
}

// Accept an invitation as an ALREADY-LOGGED-IN user (signupAction handles the
// new-account case). Joins the invited org with the invited role and marks the
// invite accepted, in one transaction. Without this, a user who already has an
// account can't accept an invite to a second org — team growth would break.
export async function acceptInviteAsUserAction(_prev: unknown, formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const userEmail = (session?.user as { email?: string })?.email || "";
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
    // Notify the org's admins that the invitee accepted and joined.
    await emitNotification({
      orgId,
      type: "member_joined",
      title: `${userEmail || "A new member"} joined the organization`,
      link: "/settings/team",
      actorUserId: userId,
      actorEmail: userEmail || undefined,
      audience: "admins",
    });
    return { error: "", orgId, role };
  } catch {
    await client.query("ROLLBACK");
    return { error: "Could not accept the invitation." };
  } finally {
    client.release();
  }
}
