// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Suspense } from "react";
import { useFormState } from "react-dom";
import { useSearchParams } from "next/navigation";
import { signupAction } from "@/app/auth-actions";
import { AuthCard, Field } from "@/components/auth/AuthCard";

function AcceptInviteForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const email = params.get("email") || "";
  const [state, formAction] = useFormState(signupAction, { error: "" });

  return (
    <AuthCard title="Accept your invitation">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="invite" value={token} />
        <Field name="name" type="text" label="Name" />
        <Field name="email" type="email" label="Email" defaultValue={email} />
        <Field name="password" type="password" label="Password (8+ chars)" />
        {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        {!token && <p className="text-sm text-amber-600">Missing invite token.</p>}
        <button
          type="submit"
          disabled={!token}
          className="w-full rounded-lg bg-splyntra-600 py-2 text-sm font-medium text-white hover:bg-splyntra-700 disabled:opacity-50"
        >
          Join team
        </button>
      </form>
    </AuthCard>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<AuthCard title="Accept your invitation">Loading…</AuthCard>}>
      <AcceptInviteForm />
    </Suspense>
  );
}
