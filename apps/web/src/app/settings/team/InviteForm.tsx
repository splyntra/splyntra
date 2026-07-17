// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useState } from "react";
import { UserPlus, Copy, Check, AlertTriangle } from "lucide-react";
import { inviteMemberAction } from "@/app/auth-actions";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";

const INVITE_ROLES = [
  { value: "viewer", label: "Viewer" },
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800";

export function InviteForm() {
  const [state, action] = useFormState(inviteMemberAction, { error: "", token: "" });
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // Announce the outcome of each invite submission (server action result).
  useEffect(() => {
    if (state?.token) toast.success("Invitation created — share the link below.");
    else if (state?.error) toast.error(state.error);
  }, [state, toast]);

  const link = state?.token ? `${origin}/accept-invite?token=${state.token}` : "";

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-3 dark:border-gray-800 dark:bg-gray-900/50">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Invite a teammate</h3>
      </div>
      <form action={action} className="flex flex-wrap items-end gap-3 p-5">
        <label className="min-w-[220px] flex-1">
          <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Email</span>
          <input name="email" type="email" required placeholder="teammate@company.com" className={INPUT} />
        </label>
        <label className="min-w-[140px]">
          <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Role</span>
          <Select name="role" defaultValue="member" options={INVITE_ROLES} ariaLabel="Invite role" />
        </label>
        <SubmitButton />
      </form>

      {state?.error ? (
        <p className="flex items-center gap-1.5 px-5 pb-4 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {state.error}
        </p>
      ) : null}

      {link ? (
        <div className="mx-5 mb-5 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/50">
          <p className="mb-1.5 text-[12px] font-medium text-gray-600 dark:text-gray-400">
            Invitation created — share this link (valid for 7 days):
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-[11px] text-gray-700 dark:bg-gray-900 dark:text-gray-300">{link}</code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium transition-colors hover:bg-white dark:border-gray-700 dark:hover:bg-gray-900"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// Disables during the pending server action to prevent a double-submit.
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
    >
      <UserPlus className="h-4 w-4" />
      {pending ? "Creating…" : "Create invite"}
    </button>
  );
}
