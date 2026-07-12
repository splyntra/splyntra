-- Splyntra ClickHouse Schema — structured agent logs (Layer 1 Observability).
-- OTLP LogRecords ingested at /v1/logs, trace-correlated via trace_id/span_id when
-- emitted inside an active span. Modeled on the spans table: ReplacingMergeTree for
-- idempotent re-ingest, monthly partitions, 90-day TTL. Severity is an Enum8 whose
-- ordinals ascend TRACE→FATAL so a min-severity filter is `severity >= ?`.
--
-- Fresh installs get this via docker-entrypoint-initdb.d; existing ClickHouse
-- volumes must run this file manually (see 001_init.sql upgrade note).

CREATE TABLE IF NOT EXISTS splyntra.logs (
    timestamp DateTime64(3),
    org_id String,
    project_id String,
    environment String DEFAULT '',
    agent_id String DEFAULT '',
    trace_id String DEFAULT '',
    span_id String DEFAULT '',
    severity Enum8('TRACE' = 1, 'DEBUG' = 2, 'INFO' = 3, 'WARN' = 4, 'ERROR' = 5, 'FATAL' = 6),
    body String,
    attributes Map(String, String) DEFAULT map(),
    ingested_at DateTime64(3) DEFAULT now64(3),

    INDEX idx_logs_agent agent_id TYPE bloom_filter GRANULARITY 4,
    INDEX idx_logs_trace trace_id TYPE bloom_filter GRANULARITY 4,
    INDEX idx_logs_severity severity TYPE set(6) GRANULARITY 1
)
-- Idempotent: a re-sent log collapses on (org, project, timestamp, trace_id,
-- span_id, severity, body) to the latest ingested_at on merge.
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (org_id, project_id, timestamp, trace_id, span_id, severity, body)
TTL toDateTime(timestamp) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
