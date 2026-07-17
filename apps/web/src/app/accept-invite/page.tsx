// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { Suspense, useEffect } from "react";
import { useFormState } from "react-dom";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { signupAction, acceptInviteAsUserAction } from "@/app/auth-actions";
import { AuthCard, Field } from "@/components/auth/AuthCard";

// Logged-in user: accepting an invite just joins the org (no new account).
function AcceptAsExistingUser({ token }: { token: string }) {
  const [state, formAction] = useFormState(acceptInviteAsUserAction, { error: "" });
  const router = useRouter();
  const { update } = useSession();
  useEffect(() => {
    const s = state as { orgId?: string; role?: string };
    if (state && !state.error && s.orgId) {
      // Activate the newly-joined org in the session before navigating — else a
      // user with no active org loops back to /onboarding, or lands on the old org.
      update({ orgId: s.orgId, role: s.role || "member" }).then(() => router.push("/"));
    }
  }, [state, router, update]);
  return (
    <AuthCard title="Accept your invitation">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="invite" value={token} />
        <p className="text-sm text-gray-500">You&rsquo;re signed in — join this organization to continue.</p>
        {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        {!token && <p className="text-sm text-amber-600">Missing invite token.</p>}
        <button type="submit" disabled={!token}
          className="w-full rounded-lg bg-splyntra-600 py-2 text-sm font-medium text-white hover:bg-splyntra-700 disabled:opacity-50">
          Join organization
        </button>
      </form>
    </AuthCard>
  );
}

function AcceptInviteForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const email = params.get("email") || "";
  const { status } = useSession();
  const [state, formAction] = useFormState(signupAction, { error: "" });

  // Already authenticated → join directly instead of creating an account.
  if (status === "authenticated") return <AcceptAsExistingUser token={token} />;

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
      {/* Already registered? Log in, then return here to accept as an existing
          user (signup would reject an existing email). */}
      {token && (
        <p className="mt-3 text-center text-xs text-gray-500">
          Already have an account?{" "}
          <a
            className="font-medium text-splyntra-600 hover:underline"
            href={`/login?callbackUrl=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
          >
            Log in to accept
          </a>
        </p>
      )}
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
