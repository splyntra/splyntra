// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AuthCard, Field } from "@/components/auth/AuthCard";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    });
    setBusy(false);
    if (res?.error) setError("Invalid email or password.");
    else router.push("/");
  }

  return (
    <AuthCard title="Sign in to Splyntra">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field name="email" type="email" label="Email" />
        <Field name="password" type="password" label="Password" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-r from-splyntra-600 to-splyntra-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-splyntra-500/20 transition-all hover:from-splyntra-700 hover:to-splyntra-600 hover:shadow-lg hover:shadow-splyntra-500/30 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-5 text-center text-[13px] text-gray-500">
        No account?{" "}
        <Link href="/signup" className="font-medium text-splyntra-600 hover:text-splyntra-700 hover:underline">
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
