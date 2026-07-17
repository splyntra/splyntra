// SPDX-License-Identifier: FSL-1.1-ALv2
// Auth extension seam (mirrors lib/slots.ts). Lets a build inject additional
// next-auth providers and post-sign-in hooks without forking the open auth
// setup. The open edition registers nothing here (Credentials + the implicit
// single org); the commercial build's overlay registers OAuth providers
// (Google/GitHub/OIDC) and an org-onboarding hook.
//
// auth.ts imports lib/auth-providers (a no-op file in the open repo, replaced by
// the cloud overlay) for its registration side effects, then reads the values
// below when constructing NextAuth.
import type { NextAuthConfig } from "next-auth";

type Provider = NonNullable<NextAuthConfig["providers"]>[number];
type SignInUser = { id?: string; email?: string | null; name?: string | null };
// A sign-in guard runs in the next-auth `signIn` callback (it can DENY sign-in).
// Return false (or throw) to reject; void/true allows. Used by the cloud build to
// link the OAuth identity and refuse unverified-email linking — and to fail
// closed if persistence fails (so a user never gets a session with no backing row).
type SignInHook = (
  user: SignInUser,
  account: unknown,
  profile: unknown
) => Promise<boolean | void> | boolean | void;

const extraProviders: Provider[] = [];
const signInHooks: SignInHook[] = [];
let onboardingPath: string | null = null;

/** Register one or more next-auth providers (called from the cloud overlay). */
export function registerAuthProviders(...providers: Provider[]): void {
  extraProviders.push(...providers);
}

/** Providers contributed by extensions (empty in the open edition). */
export function registeredAuthProviders(): Provider[] {
  return extraProviders;
}

/** Register a hook run after a successful sign-in (e.g. link OAuth identity). */
export function registerSignInHook(fn: SignInHook): void {
  signInHooks.push(fn);
}

export function registeredSignInHooks(): SignInHook[] {
  return signInHooks;
}

/** The cloud build sets this so users without an org are sent to onboarding. */
export function setOnboardingRedirect(path: string): void {
  onboardingPath = path;
}

export function onboardingRedirect(): string | null {
  return onboardingPath;
}

// Invite handler seam. The open edition creates the invitation row itself; the
// cloud build registers a handler that ALSO enforces the plan's seat cap and
// emails the invitee (lib/cloud/invites). When registered, inviteMemberAction
// delegates invite creation to it entirely.
export type InviteHandler = (args: {
  orgId: string;
  invitedByUserId: string;
  inviterEmail: string;
  email: string;
  role: string;
}) => Promise<{ error?: string; token?: string }>;

let inviteHandler: InviteHandler | null = null;

/** Register the cloud invite handler (seat cap + email). Open edition: none. */
export function registerInviteHandler(fn: InviteHandler): void {
  inviteHandler = fn;
}

export function registeredInviteHandler(): InviteHandler | null {
  return inviteHandler;
}
