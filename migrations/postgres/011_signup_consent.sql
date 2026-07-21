-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Signup consent: a marketing-email opt-in and the timestamp at which the user
-- accepted the Terms of Service + Privacy Policy on the signup form. Runs on a
-- fresh volume (initdb); already-provisioned commercial deployments get the same
-- columns via the cloud control-plane mirror (1011_signup_consent.sql).

ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
