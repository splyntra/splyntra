// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { changePasswordAction, deleteAccountAction, disconnectProviderAction } from "@/app/auth-actions";
import { SettingsCard } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import type { LinkedIdentity } from "@/lib/auth-extensions";

const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-splyntra-500 focus:ring-4 focus:ring-splyntra-500/10 dark:border-gray-700 dark:bg-gray-800 dark:text-white";

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  "microsoft-entra-id": "Microsoft",
  saml: "SSO (SAML)",
};
const label = (p: string) => PROVIDER_LABEL[p] || p;

function SubmitButton({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  const cls = danger ? "bg-red-600 hover:bg-red-700" : "bg-splyntra-600 hover:bg-splyntra-700";
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

export function SecurityForms({
  hasPassword,
  providers,
}: {
  hasPassword: boolean;
  providers: LinkedIdentity[];
}) {
  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pwState, pwAction] = useFormState(changePasswordAction, { error: "" });
  const [delState, delAction] = useFormState(deleteAccountAction, { error: "" });
  const [discState, discAction] = useFormState(disconnectProviderAction, { error: "" });
  const pwSeen = useRef(pwState);
  const delSeen = useRef(delState);
  const discSeen = useRef(discState);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (pwState === pwSeen.current) return;
    pwSeen.current = pwState;
    const s = pwState as { ok?: boolean; set?: boolean; error?: string };
    if (s.ok) {
      toast.success(s.set ? "Password set. You can now sign in with email + password." : "Password changed.");
      formRef.current?.reset();
      if (s.set) router.refresh(); // flip "Set" → "Change"
    } else if (s.error) toast.error(s.error);
  }, [pwState, toast, router]);

  useEffect(() => {
    if (delState === delSeen.current) return;
    delSeen.current = delState;
    const s = delState as { deleted?: boolean; error?: string };
    if (s.deleted) {
      toast.success("Account deleted. Signing you out.");
      setTimeout(() => signOut({ callbackUrl: "/login" }), 1500);
    } else if (s.error) toast.error(s.error);
  }, [delState, toast]);

  useEffect(() => {
    if (discState === discSeen.current) return;
    discSeen.current = discState;
    const s = discState as { ok?: boolean; error?: string };
    if (s.ok) {
      toast.success("Disconnected.");
      router.refresh();
    } else if (s.error) toast.error(s.error);
  }, [discState, toast, router]);

  // Guard mirrored from the server: a provider can't be removed if it's the user's
  // only way in (no password AND only one provider).
  const lastMethod = !hasPassword && providers.length <= 1;

  return (
    <div className="space-y-6">
      <SettingsCard
        title={hasPassword ? "Change password" : "Set a password"}
        description={
          hasPassword
            ? "Use at least 8 characters."
            : "You signed up with a connected account. Add a password to also sign in with email + password."
        }
      >
        <form ref={formRef} action={pwAction} className="space-y-4">
          {hasPassword && (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Current password</span>
              <input name="current" type="password" required autoComplete="current-password" className={INPUT} />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">New password</span>
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Confirm new password</span>
            <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={INPUT} />
          </label>
          <SubmitButton label={hasPassword ? "Change password" : "Set password"} />
        </form>
      </SettingsCard>

      {providers.length > 0 && (
        <SettingsCard title="Connected sign-ins" description="Accounts you can use to sign in.">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {providers.map((p) => (
              <li key={p.provider} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{label(p.provider)}</div>
                  {p.email && <div className="truncate text-[13px] text-gray-500 dark:text-gray-400">{p.email}</div>}
                </div>
                <form action={discAction}>
                  <input type="hidden" name="provider" value={p.provider} />
                  <button
                    type="submit"
                    disabled={lastMethod}
                    title={lastMethod ? "Set a password first — this is your only way to sign in." : undefined}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    Disconnect
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {lastMethod && (
            <p className="mt-3 text-xs text-gray-400">Set a password above to disconnect your only sign-in method.</p>
          )}
        </SettingsCard>
      )}

      <SettingsCard
        title="Delete account"
        description="Permanently delete your account and remove you from all organizations. This cannot be undone."
        danger
      >
        <form action={delAction} className="space-y-4">
          {hasPassword && (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Confirm your password</span>
              <input name="password" type="password" required autoComplete="current-password" className={INPUT} />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </span>
            <input
              name="confirm"
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
