// SPDX-License-Identifier: AGPL-3.0-only
import { Users } from "lucide-react";
import { auth } from "@/auth";
import { pool, roleAtLeast } from "@/lib/db";
import { updateRoleAction, removeMemberAction } from "@/app/auth-actions";
import { InviteForm } from "./InviteForm";

export const dynamic = "force-dynamic";

interface Member {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export default async function TeamPage() {
  const session = await auth();
  const orgId = (session?.user as { orgId?: string })?.orgId;
  const myRole = (session?.user as { role?: string })?.role;
  const canManage = roleAtLeast(myRole, "admin");

  let members: Member[] = [];
  if (orgId) {
    const { rows } = await pool.query(
      `SELECT u.id::text AS user_id, u.email, u.name, m.role, m.created_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 ORDER BY m.created_at ASC`,
      [orgId]
    );
    members = rows;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-splyntra-50 text-splyntra-600 dark:bg-splyntra-900/30">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Team</h1>
          <p className="text-sm text-gray-500">
            Members of your organization · your role: <span className="font-medium">{myRole || "—"}</span>
          </p>
        </div>
      </div>

      {canManage && (
        <div className="mb-6">
          <InviteForm />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-800/50">
            <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:text-gray-500">
              <th>Member</th>
              <th>Role</th>
              <th className="text-right">Joined</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {members.map((m) => (
              <tr key={m.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <td className="px-4 py-3">
                  <div className="font-medium">{m.name || m.email}</div>
                  <div className="text-xs text-gray-500">{m.email}</div>
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <form action={updateRoleAction} className="inline-flex items-center gap-2">
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <select name="role" defaultValue={m.role} className="rounded-md border px-2 py-1 text-xs dark:bg-gray-800">
                        {["owner", "admin", "member", "viewer"].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button className="text-xs text-splyntra-600 hover:underline">save</button>
                    </form>
                  ) : (
                    <span className="text-gray-600">{m.role}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-500">
                  {new Date(m.created_at).toLocaleDateString()}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <form action={removeMemberAction}>
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <button className="text-xs text-red-600 hover:underline">remove</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
