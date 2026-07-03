-- Separate agent-platform (orchestrator) runs from real agents at the data layer.
-- `platform` is empty for SDK-agent traces and set to the platform id (dify/n8n/…)
-- for webhook workflow runs, so every query can scope to its domain. workflow_name
-- + workflow_version power the Workflow Operations dashboard. Additive/metadata-only.
ALTER TABLE splyntra.traces ADD COLUMN IF NOT EXISTS platform String DEFAULT '' AFTER agent_id;
ALTER TABLE splyntra.traces ADD COLUMN IF NOT EXISTS workflow_name String DEFAULT '' AFTER workflow_id;
ALTER TABLE splyntra.traces ADD COLUMN IF NOT EXISTS workflow_version String DEFAULT '' AFTER workflow_name;
ALTER TABLE splyntra.traces ADD INDEX IF NOT EXISTS idx_platform platform TYPE set(0) GRANULARITY 1;
