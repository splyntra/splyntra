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

// Signup org-provisioner seam. The open edition joins the seeded dev org
// (auth-actions.ts). The cloud build registers a provisioner that creates the
// user's OWN org (name + type) as their single default org. It runs INSIDE
// signupAction's transaction and is handed the in-flight DB client, so the org +
// membership commit atomically with the user row (no orphaned user, no dev-org
// join). `client` is typed `unknown` to keep this module free of a pg import.
export type SignupProvisioner = (
  client: unknown,
  args: { userId: string; email: string; orgName: string; orgType: string }
) => Promise<{ orgId: string; role: string }>;

let signupProvisioner: SignupProvisioner | null = null;

/** Register the cloud signup org provisioner. Open edition: none → dev org. */
export function registerSignupProvisioner(fn: SignupProvisioner): void {
  signupProvisioner = fn;
}

export function registeredSignupProvisioner(): SignupProvisioner | null {
  return signupProvisioner;
}

// Email-verification sender seam. Called by signupAction AFTER the account +
// org are committed. The cloud implementation stores a verification token and
// emails the verify link; it returns `{ pending: true }` only when it actually
// left the account in a pending (must-verify) state — i.e. the email was sent.
// If verification isn't configured or the send fails, it returns
// `{ pending: false }` (and leaves NO pending row), so signupAction falls back
// to signing the user straight in — a misconfigured deploy never traps signups.
// Login is then blocked for pending accounts by a registered sign-in hook. Open
// edition registers no sender → accounts are usable immediately.
export type VerificationSender = (args: {
  userId: string;
  email: string;
  name: string;
}) => Promise<{ pending: boolean }>;

let verificationSender: VerificationSender | null = null;

/** Register the cloud email-verification sender. Open edition: none. */
export function registerVerificationSender(fn: VerificationSender): void {
  verificationSender = fn;
}

export function registeredVerificationSender(): VerificationSender | null {
  return verificationSender;
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

// Account auth-method seam. The Security/Profile pages need to know which OAuth/
// SAML identities a user has linked (a cloud-only `user_identities` table) so they
// can adapt: social/SAML users have no password (they'd get "set a password", not
// "change"), their login email is provider-managed (read-only), and account delete
// can't gate on a password they don't have. The cloud build registers a reader over
// user_identities; the open edition registers none → getter returns null → pages
// treat everyone as a password user (correct: the open edition has no OAuth/SAML).
export type LinkedIdentity = { provider: string; email: string | null };
export type AccountAuthInfo = (userId: string) => Promise<{ providers: LinkedIdentity[] }>;

let accountAuthInfo: AccountAuthInfo | null = null;

/** Register the cloud reader for a user's linked identities. Open edition: none. */
export function registerAccountAuthInfo(fn: AccountAuthInfo): void {
  accountAuthInfo = fn;
}

export function registeredAccountAuthInfo(): AccountAuthInfo | null {
  return accountAuthInfo;
}

// Disconnect-identity seam. Unlinks one OAuth/SAML provider from the user, but MUST
// refuse to remove their last sign-in method (they'd be locked out) — so the cloud
// implementation checks `password_hash` + remaining identities before deleting.
export type AccountDisconnect = (
  userId: string,
  provider: string
) => Promise<{ ok?: true; error?: string }>;

let accountDisconnect: AccountDisconnect | null = null;

/** Register the cloud identity-disconnect handler. Open edition: none. */
export function registerAccountDisconnect(fn: AccountDisconnect): void {
  accountDisconnect = fn;
}

export function registeredAccountDisconnect(): AccountDisconnect | null {
  return accountDisconnect;
}
