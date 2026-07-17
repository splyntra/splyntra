// SPDX-License-Identifier: FSL-1.1-ALv2
import { Users, Mail, Clock, X } from "lucide-react";
import { auth } from "@/auth";
import { pool, roleAtLeast } from "@/lib/db";
import { revokeInviteAction } from "@/app/auth-actions";
import { Card } from "@/components/ui/primitives";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { InviteForm } from "./InviteForm";
import { MembersTable } from "./MembersTable";

export const dynamic = "force-dynamic";

interface Member {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-gray-900 text-white dark:bg-white dark:text-gray-900",
  admin: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  member: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  viewer: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

export default async function TeamPage() {
  const session = await auth();
  const orgId = (session?.user as { orgId?: string })?.orgId;
  const myEmail = (session?.user as { email?: string })?.email;

  let members: Member[] = [];
  let invites: Invite[] = [];
  let canManage = false;

  if (orgId) {
    const [m, i] = await Promise.all([
      pool.query(
        `SELECT u.id::text AS user_id, u.email, u.name, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.org_id = $1 ORDER BY
           CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
           m.created_at ASC`,
        [orgId]
      ),
      pool.query(
        `SELECT id::text, email, role, created_at, expires_at FROM invitations
         WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [orgId]
      ),
    ]);
    members = m.rows;
    invites = i.rows;
    // DB-verified role (not the JWT) decides whether management controls render.
    const mine = members.find((x) => x.email === myEmail);
    canManage = roleAtLeast(mine?.role, "admin");
  }

  const ownerCount = members.filter((m) => m.role === "owner").length;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      {/* Header (inline — this is a Server Component, so we can't pass the icon
          component as a prop to the client-side PageHeader). */}
      <div className="mb-6 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Team</h1>
          <p className="text-sm text-gray-500">Manage who can access your organization and what they can do.</p>
        </div>
      </div>

      {canManage && (
        <div className="mb-6">
          <InviteForm />
        </div>
      )}

      {/* Pending invitations */}
      {canManage && invites.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-gray-500">
            Pending Invitations ({invites.length})
          </h2>
          <Card className="divide-y divide-gray-100 dark:divide-gray-800">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{inv.email}</div>
                  <div className="flex items-center gap-1 text-[11px] text-gray-400">
                    <Clock className="h-3 w-3" />
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_BADGE[inv.role] || ROLE_BADGE.member}`}>
                  {inv.role}
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="invite_id" value={inv.id} />
                  <ConfirmSubmitButton
                    title="Revoke invitation"
                    confirm={{
                      title: "Revoke invitation?",
                      description: `The invite link for ${inv.email} will stop working immediately.`,
                      confirmText: "Revoke invite",
                      tone: "danger",
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                  >
                    <X className="h-3.5 w-3.5" />
                    Revoke
                  </ConfirmSubmitButton>
                </form>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Members */}
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-gray-500">
        Members ({members.length})
      </h2>
      <Card className="overflow-hidden">
        <MembersTable members={members} canManage={canManage} ownerCount={ownerCount} myEmail={myEmail ?? ""} />
      </Card>
    </div>
  );
}
