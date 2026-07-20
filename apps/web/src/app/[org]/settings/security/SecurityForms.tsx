// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { signOut } from "next-auth/react";
import { changePasswordAction, deleteAccountAction } from "@/app/auth-actions";
import { SettingsCard } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-splyntra-500 focus:ring-4 focus:ring-splyntra-500/10 dark:border-gray-700 dark:bg-gray-800 dark:text-white";

function SubmitButton({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  const cls = danger
    ? "bg-red-600 hover:bg-red-700"
    : "bg-splyntra-600 hover:bg-splyntra-700";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${cls}`}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

export function SecurityForms() {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [pwState, pwAction] = useFormState(changePasswordAction, { error: "" });
  const [delState, delAction] = useFormState(deleteAccountAction, { error: "" });
  const pwSeen = useRef(pwState);
  const delSeen = useRef(delState);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (pwState === pwSeen.current) return;
    pwSeen.current = pwState;
    const s = pwState as { ok?: boolean; error?: string };
    if (s.ok) {
      toast.success("Password changed.");
      formRef.current?.reset();
    } else if (s.error) toast.error(s.error);
  }, [pwState, toast]);

  useEffect(() => {
    if (delState === delSeen.current) return;
    delSeen.current = delState;
    const s = delState as { deleted?: boolean; error?: string };
    if (s.deleted) {
      toast.success("Account deleted. Signing you out.");
      setTimeout(() => signOut({ callbackUrl: "/login" }), 1500);
    } else if (s.error) toast.error(s.error);
  }, [delState, toast]);

  return (
    <div className="space-y-6">
      <SettingsCard title="Change password" description="Use at least 8 characters.">
        <form ref={formRef} action={pwAction} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Current password</span>
            <input name="current" type="password" required autoComplete="current-password" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">New password</span>
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Confirm new password</span>
            <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={INPUT} />
          </label>
          <SubmitButton label="Change password" />
        </form>
      </SettingsCard>

      <SettingsCard
        title="Delete account"
        description="Permanently delete your account and remove you from all organizations. This cannot be undone."
        danger
      >
        <form action={delAction} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Confirm your password</span>
            <input name="password" type="password" required autoComplete="current-password" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={INPUT}
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            disabled={confirmText !== "DELETE"}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete my account
          </button>
        </form>
      </SettingsCard>
    </div>
  );
}
