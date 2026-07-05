// SPDX-License-Identifier: AGPL-3.0-only
// Feature flags. All false in the open-source build. The cloud/enterprise build
// flips the relevant flags via injected runtime config (NEXT_PUBLIC_FEATURE_*),
// which lights up nav slots whose screens are composed in from the private
// frontend/cloud-screens package. Flags gate VISIBILITY of code that may ship;
// truly private screens ship only via slots (see slots.ts).
// IMPORTANT: reference each NEXT_PUBLIC_FEATURE_* var STATICALLY. Next.js inlines
// process.env.NEXT_PUBLIC_* at build time only for literal member accesses — a
// dynamic `process.env[`NEXT_PUBLIC_FEATURE_${name}`]` is NOT replaced and reads
// as undefined in the browser, so client components (e.g. the Sidebar) would see
// every flag as false and hide all commercial nav. Keep these literal.
export const features = {
  governance: process.env.NEXT_PUBLIC_FEATURE_GOVERNANCE === "true", // ledger, policies, delegation
  sso: process.env.NEXT_PUBLIC_FEATURE_SSO === "true",
  billing: process.env.NEXT_PUBLIC_FEATURE_BILLING === "true",
  identity: process.env.NEXT_PUBLIC_FEATURE_IDENTITY === "true",
} as const;

export type FeatureName = keyof typeof features;
