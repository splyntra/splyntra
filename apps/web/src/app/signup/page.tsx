// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { signupAction } from "@/app/auth-actions";
import { AuthLayout, Field } from "@/components/auth/AuthLayout";
import { OAuthButtons } from "@/components/auth/OAuthButtons";

export default function SignupPage() {
  const [state, formAction] = useFormState(signupAction, { error: "" });
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start observing and securing your agents"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-white">
            Sign in
          </Link>
        </>
      }
    >
      <OAuthButtons />
      <form action={formAction} className="space-y-4">
        <Field name="name" type="text" label="Name" autoComplete="name" />
        <Field name="email" type="email" label="Email" autoComplete="email" />
        <Field name="password" type="password" label="Password (8+ chars)" autoComplete="new-password" />
        <Field name="confirm" type="password" label="Confirm password" autoComplete="new-password" />
        {state?.error ? <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}
        <SubmitButton />
      </form>
    </AuthLayout>
  );
}

// Disables during the pending server action to prevent a double-submit.
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Creating account…" : "Create account"}
    </button>
  );
}
