// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useFormState } from "react-dom";
import { useState } from "react";
import { inviteMemberAction } from "@/app/auth-actions";

export function InviteForm() {
  const [state, action] = useFormState(inviteMemberAction, { error: "", token: "" });
  const [origin, setOrigin] = useState("");
  if (typeof window !== "undefined" && !origin) setOrigin(window.location.origin);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Invite a teammate</h2>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-xs text-gray-500">Email</span>
          <input name="email" type="email" required className="rounded-md border px-2 py-1.5 dark:bg-gray-800" />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-xs text-gray-500">Role</span>
          <select name="role" className="rounded-md border px-2 py-1.5 dark:bg-gray-800">
            <option value="viewer">viewer</option>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button className="rounded-lg bg-splyntra-600 px-4 py-2 text-sm font-medium text-white hover:bg-splyntra-700">
          Create invite
        </button>
      </form>
      {state?.error ? <p className="mt-2 text-sm text-red-600">{state.error}</p> : null}
      {state?.token ? (
        <div className="mt-3 rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-800">
          Share this invite link:
          <code className="ml-1 break-all text-splyntra-600">
            {origin}/accept-invite?token={state.token}
          </code>
        </div>
      ) : null}
    </div>
  );
}
