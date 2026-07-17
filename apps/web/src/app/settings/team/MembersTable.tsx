// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
// Client wrapper for the org members table so it can offer client-side
// pagination + a rows-per-page selector (the parent page is a server component
// and can't use the useTableControls hook). Server actions are imported and used
// directly as <form action={...}>.
import { X } from "lucide-react";
import { updateRoleAction, removeMemberAction } from "@/app/auth-actions";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { Select } from "@/components/ui/Select";
import { useTableControls, TablePagination } from "@/components/ui/DataTable";

export interface TeamMember {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];
const ROLE_BADGE: Record<string, string> = {
  owner: "bg-gray-900 text-white dark:bg-white dark:text-gray-900",
  admin: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  member: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  viewer: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

function initials(name: string, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

export function MembersTable({
  members,
  canManage,
  ownerCount,
  myEmail,
}: {
  members: TeamMember[];
  canManage: boolean;
  ownerCount: number;
  myEmail: string;
}) {
  const tc = useTableControls(members, {
    pageSize: 10,
    searchText: (m) => `${m.name} ${m.email} ${m.role}`,
    sortAccessors: { name: (m) => (m.name || m.email).toLowerCase(), role: (m) => m.role, joined: (m) => m.created_at },
  });
  return (
    <>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
          <tr className="[&>th]:px-5 [&>th]:py-3 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
            <th>Member</th>
            <th>Role</th>
            <th>Joined</th>
            {canManage && <th className="text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {tc.view.map((m) => {
            const isLastOwner = m.role === "owner" && ownerCount <= 1;
            const isSelf = m.email === myEmail;
            return (
              <tr key={m.user_id} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-gray-600 to-gray-800 text-xs font-semibold text-white">
                      {initials(m.name, m.email)}
                    </span>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {m.name || m.email}
                        {isSelf && <span className="ml-1.5 text-[11px] font-normal text-gray-400">(you)</span>}
                      </div>
                      <div className="text-xs text-gray-500">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  {canManage && !isLastOwner ? (
                    <form action={updateRoleAction} className="inline-flex items-center gap-2">
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <Select
                        name="role"
                        defaultValue={m.role}
                        options={ROLE_OPTIONS}
                        size="sm"
                        ariaLabel={`Role for ${m.email}`}
                        className="min-w-[120px]"
                      />
                      <button className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
                        Save
                      </button>
                    </form>
                  ) : (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>
                      {m.role}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-xs text-gray-500">{new Date(m.created_at).toLocaleDateString()}</td>
                {canManage && (
                  <td className="px-5 py-3.5 text-right">
                    {!isLastOwner && (
                      <form action={removeMemberAction} className="inline">
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <ConfirmSubmitButton
                          confirm={{
                            title: "Remove member?",
                            description: `${m.name || m.email} will immediately lose access to this organization.`,
                            confirmText: "Remove member",
                            tone: "danger",
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        >
                          <X className="h-3.5 w-3.5" />
                          Remove
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {tc.total === 0 && (
            <tr>
              <td colSpan={canManage ? 4 : 3} className="px-5 py-10 text-center text-sm text-gray-500">
                No members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <TablePagination page={tc.page} pageCount={tc.pageCount} pageSize={tc.pageSize} total={tc.total} onPage={tc.setPage} onPageSize={tc.setPageSize} unit="member" />
    </>
  );
}
