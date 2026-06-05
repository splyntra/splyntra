// SPDX-License-Identifier: AGPL-3.0-only
// Feature flags. All false in the open-source build. The cloud/enterprise build
// flips the relevant flags via injected runtime config (NEXT_PUBLIC_FEATURE_*),
// which lights up nav slots whose screens are composed in from the private
// frontend/cloud-screens package. Flags gate VISIBILITY of code that may ship;
// truly private screens ship only via slots (see slots.ts).
function flag(name: string): boolean {
  // NEXT_PUBLIC_* are inlined at build time; unset → false in OSS.
  return process.env[`NEXT_PUBLIC_FEATURE_${name}`] === "true";
}

export const features = {
  governance: flag("GOVERNANCE"), // policy engine, delegation, activity ledger
  sso: flag("SSO"),
  billing: flag("BILLING"),
  identity: flag("IDENTITY"),
} as const;

export type FeatureName = keyof typeof features;
