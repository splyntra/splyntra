-- Additive migration for existing volumes: widen the detector enum to cover the
-- new depth detectors (output moderation + dangerous tool-call). Adding enum
-- values while preserving existing ids is a metadata-only change in ClickHouse.
-- Fresh installs already get these from 001_init.sql.
ALTER TABLE splyntra.detections
    MODIFY COLUMN detector Enum8('pii' = 1, 'secrets' = 2, 'injection' = 3, 'moderation' = 4, 'tool_guard' = 5);
