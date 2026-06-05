-- Splyntra PostgreSQL Schema
-- Metadata store: orgs, projects, API keys, agents

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    environment VARCHAR(50) NOT NULL DEFAULT 'development',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, slug, environment)
);

-- API Keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hash of the key
    key_prefix VARCHAR(12) NOT NULL,        -- First 8 chars for identification
    scopes TEXT[] NOT NULL DEFAULT '{"ingest"}',
    rate_limit_rps INT NOT NULL DEFAULT 1000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_org ON api_keys(org_id);

-- Registered Agents
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id VARCHAR(255) NOT NULL,  -- User-provided agent identifier
    name VARCHAR(255) NOT NULL,
    description TEXT,
    framework VARCHAR(100),           -- langgraph, crewai, openai-agents, etc.
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, project_id, agent_id)
);

-- Alert configurations
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,          -- risk_threshold, cost_threshold, error_rate
    config JSONB NOT NULL,              -- threshold, conditions
    channels TEXT[] NOT NULL DEFAULT '{"email"}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed dev data
INSERT INTO organizations (id, name, slug) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Dev Organization', 'dev-org');

INSERT INTO projects (id, org_id, name, slug, environment) VALUES
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Default Project', 'default', 'development');

-- Dev API key (SHA-256 hash of 'splyntra_dev_key')
INSERT INTO api_keys (org_id, project_id, name, key_hash, key_prefix, scopes) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Development Key', '710e22b4a0d023555dedb8b4da694f4275f4faa8a956ada97b3f29119f458987', 'splyntra_', '{"ingest","read"}');
