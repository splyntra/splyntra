-- Splyntra PostgreSQL Schema — Evaluation framework
-- Dataset metadata + evaluation runs/results/baselines. Dataset *items* live in
-- object storage (MinIO/S3); this holds the metadata and scores.

CREATE TABLE IF NOT EXISTS eval_datasets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, project_id, slug)
);

CREATE TABLE IF NOT EXISTS eval_dataset_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id UUID NOT NULL REFERENCES eval_datasets(id) ON DELETE CASCADE,
    version INT NOT NULL,
    item_count INT NOT NULL DEFAULT 0,
    object_key TEXT NOT NULL,                 -- S3 key of the JSONL items
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(dataset_id, version)
);

CREATE TABLE IF NOT EXISTS eval_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_id UUID NOT NULL REFERENCES eval_datasets(id) ON DELETE CASCADE,
    version INT NOT NULL DEFAULT 1,
    score DOUBLE PRECISION NOT NULL DEFAULT 0,   -- aggregate 0..1
    item_count INT NOT NULL DEFAULT 0,
    passed BOOLEAN NOT NULL DEFAULT TRUE,        -- regression-gate result
    regression BOOLEAN NOT NULL DEFAULT FALSE,
    per_scorer JSONB NOT NULL DEFAULT '{}',      -- {scorer: avg_score}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset ON eval_runs(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS eval_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    idx INT NOT NULL,
    input TEXT,
    expected TEXT,
    actual TEXT,
    passed BOOLEAN NOT NULL DEFAULT TRUE,
    scores JSONB NOT NULL DEFAULT '{}'           -- per-scorer score for this item
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id);

-- One current baseline per dataset; regression is measured against it.
CREATE TABLE IF NOT EXISTS eval_baselines (
    dataset_id UUID PRIMARY KEY REFERENCES eval_datasets(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    score DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
