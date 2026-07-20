-- Splyntra PostgreSQL Schema — user + organization branding.
-- avatar_url: the user's profile picture; logo_url: the organization's logo.
-- Stored as small (client-resized) data: URLs — no object store required.
-- Additive / idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
