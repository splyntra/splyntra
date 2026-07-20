// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { signOut } from "next-auth/react";
import { updateProfileAction, changeEmailAction } from "@/app/auth-actions";
import { SettingsCard } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-splyntra-500 focus:ring-4 focus:ring-splyntra-500/10 dark:border-gray-700 dark:bg-gray-800 dark:text-white";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-splyntra-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-splyntra-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const toast = useToast();
  const [nameState, nameAction] = useFormState(updateProfileAction, { error: "" });
  const [emailState, emailAction] = useFormState(changeEmailAction, { error: "" });
  const nameSeen = useRef(nameState);
  const emailSeen = useRef(emailState);

  useEffect(() => {
    if (nameState === nameSeen.current) return;
    nameSeen.current = nameState;
    const s = nameState as { ok?: boolean; error?: string };
    if (s.ok) toast.success("Profile updated.");
    else if (s.error) toast.error(s.error);
  }, [nameState, toast]);

  useEffect(() => {
    if (emailState === emailSeen.current) return;
    emailSeen.current = emailState;
    const s = emailState as { ok?: boolean; reverify?: boolean; error?: string };
    if (s.reverify) {
      toast.success("Check your new inbox to verify — signing you out.");
      setTimeout(() => signOut({ callbackUrl: "/login" }), 1600);
    } else if (s.ok) {
      toast.success("Email updated.");
    } else if (s.error) {
      toast.error(s.error);
    }
  }, [emailState, toast]);

  return (
    <div className="space-y-6">
      <SettingsCard title="Display name" description="How you appear to your teammates.">
        <form action={nameAction} className="flex items-end gap-3">
          <label className="flex-1">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Name</span>
            <input name="name" defaultValue={name} required maxLength={255} className={INPUT} />
          </label>
          <SaveButton label="Save" />
        </form>
      </SettingsCard>

      <SettingsCard
        title="Email address"
        description="Used to sign in. Changing it requires confirming your password and re-verifying the new address."
      >
        <form action={emailAction} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Email</span>
            <input name="email" type="email" defaultValue={email} required className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Current password</span>
            <input name="password" type="password" required autoComplete="current-password" className={INPUT} />
          </label>
          <SaveButton label="Update email" />
        </form>
      </SettingsCard>
    </div>
  );
}
