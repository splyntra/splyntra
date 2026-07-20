// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AuthLayout, Field } from "@/components/auth/AuthLayout";
import { OAuthButtons } from "@/components/auth/OAuthButtons";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Status from the email-verification link redirect (cloud). Read from the URL
  // directly (no useSearchParams → no Suspense boundary needed). Inert in the
  // open edition, which never sets these params.
  const [notice, setNotice] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("verified") === "1") {
      setNotice({ kind: "ok", text: "Email verified — you can sign in now." });
    } else if (p.get("verify") === "expired") {
      setNotice({ kind: "warn", text: "That verification link has expired. Sign up again to get a new one." });
    } else if (p.get("verify") === "invalid") {
      setNotice({ kind: "warn", text: "That verification link is invalid." });
    }
  }, []);

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
    if (res?.error) {
      // A registered sign-in hook denies pending (unverified) accounts → AccessDenied.
      setError(
        res.error === "AccessDenied"
          ? "Please verify your email before signing in — check your inbox for the link."
          : "Invalid email or password."
      );
    } else router.push("/");
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your account"
      footer={
        <>
          Don&rsquo;t have an account?{" "}
          <Link href="/signup" className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-white">
            Sign up
          </Link>
        </>
      }
    >
      {notice ? (
        <div
          className={`mb-4 rounded-lg border px-3.5 py-2.5 text-[13px] ${
            notice.kind === "ok"
              ? "border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-900/50 dark:bg-lime-950/40 dark:text-lime-300"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
          }`}
        >
          {notice.text}
        </div>
      ) : null}
      <OAuthButtons />
      <form onSubmit={onSubmit} className="space-y-4">
        <Field name="email" type="email" label="Email" autoComplete="email" />
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Password</span>
          </div>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-[14px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
