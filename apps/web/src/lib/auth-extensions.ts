// SPDX-License-Identifier: AGPL-3.0-only
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
type SignInHook = (user: SignInUser, account: unknown) => Promise<void> | void;

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
