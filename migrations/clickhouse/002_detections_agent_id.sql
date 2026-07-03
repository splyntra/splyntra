-- Additive migration for existing volumes: denormalize agent_id onto detections
-- so the per-agent Trust view can filter security findings without a join back
-- to the traces table. Fresh installs already get this column from 001_init.sql;
-- IF NOT EXISTS keeps this a no-op there.
ALTER TABLE splyntra.detections
    ADD COLUMN IF NOT EXISTS agent_id String DEFAULT '' AFTER project_id;

ALTER TABLE splyntra.detections
    ADD INDEX IF NOT EXISTS idx_agent agent_id TYPE bloom_filter GRANULARITY 1;
