// SPDX-License-Identifier: AGPL-3.0-only
// Extension point: the open edition registers no extra auth providers (it uses
// email/password Credentials with a single implicit organization). The
// commercial cloud build replaces this file in its composition step to register
// OAuth providers (Google / GitHub / Microsoft-OIDC) and an org-onboarding hook
// via lib/auth-extensions. Importing this module for its side effects is a no-op
// here, which keeps the open build standalone.
export {};
