// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import { signupAction } from "@/app/auth-actions";
import { AuthCard, Field } from "@/components/auth/AuthCard";

export default function SignupPage() {
  const [state, formAction] = useFormState(signupAction, { error: "" });
  return (
    <AuthCard title="Create your Splyntra account">
      <form action={formAction} className="space-y-3">
        <Field name="name" type="text" label="Name" />
        <Field name="email" type="email" label="Email" />
        <Field name="password" type="password" label="Password (8+ chars)" />
        {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <button
          type="submit"
          className="w-full rounded-lg bg-splyntra-600 py-2 text-sm font-medium text-white hover:bg-splyntra-700"
        >
          Create account
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="text-splyntra-600 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
