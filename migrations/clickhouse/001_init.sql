-- Splyntra ClickHouse Schema
-- Analytics store: traces, spans, detections at scale.
-- Objects live in the `splyntra` database (matching the collector's DSN) and are
-- fully qualified so initialization is correct regardless of the session's
-- current database.
--
-- UPGRADE NOTE: traces/spans/detections use ReplacingMergeTree for idempotent
-- ingestion (see per-table notes). ClickHouse cannot ALTER a table's engine in
-- place, so an existing deployment created before this change must be re-initialized
-- (`docker compose down -v` the ClickHouse volume, or rebuild the three tables)
-- to pick it up. Fresh installs need no action.

CREATE DATABASE IF NOT EXISTS splyntra;

-- Traces table (one row per agent execution)
CREATE TABLE IF NOT EXISTS splyntra.traces (
    trace_id String,
    org_id String,
    project_id String,
    environment String,
    agent_id String,
    platform String DEFAULT '',              -- '' = SDK agent; else the platform id (dify/n8n/…)
    workflow_id String DEFAULT '',
    workflow_name String DEFAULT '',
    workflow_version String DEFAULT '',
    status Enum8('ok' = 1, 'error' = 2),
    latency_ms UInt32,
    total_tokens UInt32 DEFAULT 0,
    prompt_tokens UInt32 DEFAULT 0,
    completion_tokens UInt32 DEFAULT 0,
    cost_usd Float64 DEFAULT 0,
    risk_score UInt8 DEFAULT 0,
    risk_severity Enum8('NONE' = 0, 'LOW' = 1, 'MEDIUM' = 2, 'HIGH' = 3, 'CRITICAL' = 4),
    detection_count UInt16 DEFAULT 0,
    span_count UInt16 DEFAULT 0,
    started_at DateTime64(3),
    completed_at DateTime64(3),
    ingested_at DateTime64(3) DEFAULT now64(3),

    -- Partition and sort for efficient queries
    INDEX idx_agent_id agent_id TYPE bloom_filter GRANULARITY 4,
    INDEX idx_platform platform TYPE set(0) GRANULARITY 1,
    INDEX idx_risk risk_score TYPE minmax GRANULARITY 4
)
-- ReplacingMergeTree makes ingestion idempotent (TRD §14): a re-sent trace has
-- the same (org, project, started_at, trace_id) sort key and collapses to the
-- latest ingested_at on merge. Reads that must be exact use FINAL.
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (org_id, project_id, started_at, trace_id)
TTL toDateTime(started_at) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- Spans table (individual steps within a trace)
CREATE TABLE IF NOT EXISTS splyntra.spans (
    trace_id String,
    span_id String,
    parent_span_id String DEFAULT '',
    org_id String,
    project_id String,
    type Enum8('agent' = 1, 'llm_call' = 2, 'tool_call' = 3, 'step' = 4, 'retrieval' = 5, 'db' = 6, 'vector_search' = 7),
    name String,
    status Enum8('ok' = 1, 'error' = 2),
    latency_ms UInt32,
    -- Token usage (for llm_call spans)
    model String DEFAULT '',
    prompt_tokens UInt32 DEFAULT 0,
    completion_tokens UInt32 DEFAULT 0,
    cost_usd Float64 DEFAULT 0,
    -- Input/Output for replay (redacted content)
    input_preview String DEFAULT '',
    output_preview String DEFAULT '',
    -- Metadata
    attributes Map(String, String) DEFAULT map(),
    -- Timestamps
    started_at DateTime64(3),
    ingested_at DateTime64(3) DEFAULT now64(3),

    INDEX idx_type type TYPE set(4) GRANULARITY 1
)
-- Idempotent: a re-sent span has the same (org, project, trace_id, started_at,
-- span_id) sort key and collapses to the latest ingested_at on merge.
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (org_id, project_id, trace_id, started_at, span_id)
TTL toDateTime(started_at) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- Detections table (security findings)
CREATE TABLE IF NOT EXISTS splyntra.detections (
    trace_id String,
    span_id String,
    org_id String,
    project_id String,
    -- agent_id is denormalized from the owning trace so the per-agent Trust view
    -- can filter detections directly (no join back to traces). Threaded through
    -- the detect message → detector service → result, set at ingest time.
    agent_id String DEFAULT '',
    detector Enum8('pii' = 1, 'secrets' = 2, 'injection' = 3, 'moderation' = 4, 'tool_guard' = 5),
    category String,
    severity Enum8('LOW' = 1, 'MEDIUM' = 2, 'HIGH' = 3, 'CRITICAL' = 4),
    confidence Float32,
    description String,
    is_beta UInt8 DEFAULT 0,
    detected_at DateTime64(3) DEFAULT now64(3),

    INDEX idx_severity severity TYPE set(4) GRANULARITY 1,
    INDEX idx_detector detector TYPE set(3) GRANULARITY 1,
    INDEX idx_agent agent_id TYPE bloom_filter GRANULARITY 1
)
-- Idempotent: dedup identity is the finding itself (trace+span+detector+
-- category), NOT the insert-time detected_at — so re-detecting a re-ingested
-- span collapses instead of duplicating. Version = detected_at (latest wins).
ENGINE = ReplacingMergeTree(detected_at)
PARTITION BY toYYYYMM(detected_at)
ORDER BY (org_id, project_id, trace_id, span_id, detector, category)
TTL toDateTime(detected_at) + INTERVAL 180 DAY
SETTINGS index_granularity = 8192;

-- Cost analytics materialized view (per-day aggregation).
-- Grouped by the columns available on `spans` (no agent_id — that lives on
-- traces); the dashboard's per-model and per-project cost views read this.
CREATE MATERIALIZED VIEW IF NOT EXISTS splyntra.cost_daily_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (org_id, project_id, model, day)
AS SELECT
    org_id,
    project_id,
    model,
    toDate(started_at) AS day,
    sum(cost_usd) AS total_cost,
    sum(prompt_tokens) AS total_prompt_tokens,
    sum(completion_tokens) AS total_completion_tokens,
    count() AS trace_count
FROM splyntra.spans
WHERE type = 'llm_call'
GROUP BY org_id, project_id, model, day;
