-- Splyntra PostgreSQL Schema — alert history
-- Records each time an alert configuration fires, for the dashboard's
-- "triggered alerts" history view.

CREATE TABLE IF NOT EXISTS alert_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    alert_id UUID,                       -- nullable: config may be deleted later
    alert_name VARCHAR(255) NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    risk_score INT NOT NULL DEFAULT 0,
    severity VARCHAR(20) NOT NULL DEFAULT 'NONE',
    fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_events_org ON alert_events(org_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_project ON alert_events(project_id, fired_at DESC);

-- Seed a sample risk-threshold alert for the dev project so the dashboard
-- shows a configured alert out of the box.
INSERT INTO alerts (org_id, project_id, name, type, config, channels)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'High-risk traces',
    'risk_threshold',
    '{"threshold": 70}',
    '{"email"}'
)
ON CONFLICT DO NOTHING;
