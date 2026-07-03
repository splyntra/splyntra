-- Agent profiles — the persisted configuration behind the Connect wizard and the
-- per-agent dashboard. An agent is auto-discovered on first ingest (agents table);
-- a profile marks it as explicitly CONFIGURED: which frameworks/providers/stores it
-- uses, its security posture, and whether alerts are on. The wizard mints an ingest
-- key (api_key_id) and the generated connect-code carries agent_id + that key.
CREATE TABLE IF NOT EXISTS agent_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    agent_id VARCHAR(255) NOT NULL,                 -- logical id (SDK service.name / splyntra.agent.name)
    name VARCHAR(255) NOT NULL DEFAULT '',
    frameworks TEXT[] NOT NULL DEFAULT '{}',
    providers TEXT[] NOT NULL DEFAULT '{}',
    vectordbs TEXT[] NOT NULL DEFAULT '{}',
    databases TEXT[] NOT NULL DEFAULT '{}',
    guard_mode VARCHAR(16) NOT NULL DEFAULT 'off',  -- off | monitor | block
    detectors TEXT[] NOT NULL DEFAULT '{}',
    alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    api_key_id UUID,                                -- the ingest key minted for this agent
    alert_id UUID,                                  -- the alert rule created when alerts_enabled
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, project_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_org ON agent_profiles(org_id, project_id);
