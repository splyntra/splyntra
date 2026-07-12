-- Splyntra PostgreSQL Schema — Evaluation leaderboard dimensions.
-- agent_id/model let eval runs be ranked per agent + model (the leaderboard),
-- and enable version-over-version regression (the version column already exists
-- on eval_runs from 003_evaluation.sql; it is now populated by the run insert).
-- Additive / idempotent.

ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS agent_id VARCHAR(255);
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS model VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_eval_runs_leaderboard
    ON eval_runs (org_id, project_id, agent_id, model);
