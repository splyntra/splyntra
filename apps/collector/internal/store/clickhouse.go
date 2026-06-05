// SPDX-License-Identifier: AGPL-3.0-only
package store

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
)

// LLM cost table (USD per 1K tokens) - updated pricing as of 2024
var modelCosts = map[string]struct{ promptPer1K, completionPer1K float64 }{
	"gpt-4":             {0.03, 0.06},
	"gpt-4-turbo":       {0.01, 0.03},
	"gpt-4o":            {0.005, 0.015},
	"gpt-4o-mini":       {0.00015, 0.0006},
	"gpt-3.5-turbo":     {0.0005, 0.0015},
	"claude-3-opus":     {0.015, 0.075},
	"claude-3-sonnet":   {0.003, 0.015},
	"claude-3-haiku":    {0.00025, 0.00125},
	"claude-3.5-sonnet": {0.003, 0.015},
	"claude-4-sonnet":   {0.003, 0.015},
	"claude-4-opus":     {0.015, 0.075},
	"gemini-1.5-pro":    {0.0035, 0.0105},
	"gemini-1.5-flash":  {0.000075, 0.0003},
	"command-r-plus":    {0.003, 0.015},
	"mistral-large":     {0.004, 0.012},
	"mistral-small":     {0.001, 0.003},
}

// ComputeCost calculates the USD cost for a span based on model and tokens.
func ComputeCost(model string, promptTokens, completionTokens uint32) float64 {
	pricing, ok := modelCosts[model]
	if !ok {
		// Try partial match for versioned model names (e.g., "gpt-4o-2024-05-13")
		for prefix, p := range modelCosts {
			if len(model) > len(prefix) && model[:len(prefix)] == prefix {
				pricing = p
				ok = true
				break
			}
		}
		if !ok {
			return 0
		}
	}
	return (float64(promptTokens)/1000)*pricing.promptPer1K +
		(float64(completionTokens)/1000)*pricing.completionPer1K
}

// ClickHouseStore handles writing and querying trace data.
type ClickHouseStore struct {
	conn   driver.Conn
	logger *zap.Logger

	// Batch buffer
	mu         sync.Mutex
	spanBuf    []*streaming.SpanEvent
	traceBuf   []*streaming.TraceEvent
	flushTimer *time.Ticker
	done       chan struct{}
}

const (
	batchSize     = 500
	flushInterval = 2 * time.Second
)

func NewClickHouseStore(dsn string, logger *zap.Logger) (*ClickHouseStore, error) {
	opts, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse clickhouse dsn: %w", err)
	}

	conn, err := clickhouse.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("open clickhouse: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping clickhouse: %w", err)
	}

	logger.Info("ClickHouse connected")

	s := &ClickHouseStore{
		conn:       conn,
		logger:     logger,
		spanBuf:    make([]*streaming.SpanEvent, 0, batchSize),
		traceBuf:   make([]*streaming.TraceEvent, 0, batchSize),
		flushTimer: time.NewTicker(flushInterval),
		done:       make(chan struct{}),
	}

	go s.flushLoop()
	return s, nil
}

func (s *ClickHouseStore) flushLoop() {
	for {
		select {
		case <-s.flushTimer.C:
			s.Flush()
		case <-s.done:
			return
		}
	}
}

// Flush writes all buffered data to ClickHouse.
func (s *ClickHouseStore) Flush() {
	s.mu.Lock()
	spans := s.spanBuf
	traces := s.traceBuf
	s.spanBuf = make([]*streaming.SpanEvent, 0, batchSize)
	s.traceBuf = make([]*streaming.TraceEvent, 0, batchSize)
	s.mu.Unlock()

	if len(spans) > 0 {
		s.flushSpans(spans)
	}
	if len(traces) > 0 {
		s.flushTraces(traces)
	}
}

func (s *ClickHouseStore) flushSpans(spans []*streaming.SpanEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	batch, err := s.conn.PrepareBatch(ctx, `
		INSERT INTO spans (
			trace_id, span_id, parent_span_id, org_id, project_id,
			type, name, status, latency_ms,
			model, prompt_tokens, completion_tokens, cost_usd,
			input_preview, output_preview,
			attributes, started_at
		)`)
	if err != nil {
		s.logger.Error("prepare span batch failed", zap.Error(err))
		return
	}

	for _, span := range spans {
		// Truncate previews to 2KB max for storage efficiency
		inputPreview := truncate(span.RawInput, 2048)
		outputPreview := truncate(span.RawOutput, 2048)

		if err := batch.Append(
			span.TraceID, span.SpanID, span.ParentSpanID, span.OrgID, span.ProjectID,
			span.Type, span.Name, span.Status, span.LatencyMs,
			span.Model, span.PromptTokens, span.CompletionTokens, span.CostUSD,
			inputPreview, outputPreview,
			span.Attributes, span.StartedAt,
		); err != nil {
			s.logger.Error("append span to batch failed", zap.Error(err), zap.String("span_id", span.SpanID))
		}
	}

	if err := batch.Send(); err != nil {
		s.logger.Error("send span batch failed", zap.Error(err), zap.Int("count", len(spans)))
	} else {
		s.logger.Debug("flushed spans", zap.Int("count", len(spans)))
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func (s *ClickHouseStore) flushTraces(traces []*streaming.TraceEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	batch, err := s.conn.PrepareBatch(ctx, `
		INSERT INTO traces (
			trace_id, org_id, project_id, environment, agent_id, workflow_id,
			status, latency_ms, total_tokens, prompt_tokens, completion_tokens,
			cost_usd, span_count, started_at, completed_at
		)`)
	if err != nil {
		s.logger.Error("prepare trace batch failed", zap.Error(err))
		return
	}

	for _, trace := range traces {
		var totalLatency uint32
		var totalPrompt, totalCompletion uint32
		var totalCost float64
		var spanCount uint16
		traceStatus := "ok"

		for _, sp := range trace.Spans {
			spanCount++
			if sp.LatencyMs > totalLatency {
				totalLatency = sp.LatencyMs
			}
			totalPrompt += sp.PromptTokens
			totalCompletion += sp.CompletionTokens
			totalCost += sp.CostUSD
			if sp.Status == "error" {
				traceStatus = "error"
			}
		}

		totalTokens := totalPrompt + totalCompletion

		var startedAt time.Time
		if len(trace.Spans) > 0 {
			startedAt = trace.Spans[0].StartedAt
		} else {
			startedAt = trace.IngestedAt
		}

		if err := batch.Append(
			trace.TraceID, trace.OrgID, trace.ProjectID, trace.Environment,
			trace.AgentID, trace.WorkflowID,
			traceStatus, totalLatency, totalTokens, totalPrompt, totalCompletion,
			totalCost, spanCount, startedAt, trace.IngestedAt,
		); err != nil {
			s.logger.Error("append trace to batch failed", zap.Error(err), zap.String("trace_id", trace.TraceID))
		}
	}

	if err := batch.Send(); err != nil {
		s.logger.Error("send trace batch failed", zap.Error(err), zap.Int("count", len(traces)))
	} else {
		s.logger.Debug("flushed traces", zap.Int("count", len(traces)))
	}
}

// InsertSpan buffers a span for batch insertion.
func (s *ClickHouseStore) InsertSpan(ctx context.Context, span *streaming.SpanEvent) error {
	// Compute cost before buffering
	if span.Model != "" && span.CostUSD == 0 {
		span.CostUSD = ComputeCost(span.Model, span.PromptTokens, span.CompletionTokens)
	}

	s.mu.Lock()
	s.spanBuf = append(s.spanBuf, span)
	shouldFlush := len(s.spanBuf) >= batchSize
	s.mu.Unlock()

	if shouldFlush {
		go s.Flush()
	}
	return nil
}

// InsertTrace buffers a trace for batch insertion.
func (s *ClickHouseStore) InsertTrace(ctx context.Context, trace *streaming.TraceEvent) error {
	s.mu.Lock()
	s.traceBuf = append(s.traceBuf, trace)
	shouldFlush := len(s.traceBuf) >= batchSize
	s.mu.Unlock()

	if shouldFlush {
		go s.Flush()
	}
	return nil
}

// InsertDetection writes a detection finding to ClickHouse.
func (s *ClickHouseStore) InsertDetection(ctx context.Context, d *Detection) error {
	err := s.conn.Exec(ctx, `
		INSERT INTO detections (
			trace_id, span_id, org_id, project_id,
			detector, category, severity, confidence, description, is_beta
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.TraceID, d.SpanID, d.OrgID, d.ProjectID,
		d.Detector, d.Category, d.Severity, d.Confidence, d.Description, d.IsBeta,
	)
	if err != nil {
		s.logger.Error("insert detection failed", zap.Error(err))
		return fmt.Errorf("insert detection: %w", err)
	}
	return nil
}

// Detection represents a security finding to store.
type Detection struct {
	TraceID     string
	SpanID      string
	OrgID       string
	ProjectID   string
	Detector    string
	Category    string
	Severity    string
	Confidence  float32
	Description string
	IsBeta      uint8
}

// QueryTraces returns recent traces for a project.
func (s *ClickHouseStore) QueryTraces(ctx context.Context, orgID, projectID string, limit int) ([]TraceRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	rows, err := s.conn.Query(ctx, `
		SELECT
			trace_id, agent_id, workflow_id, status, latency_ms,
			total_tokens, cost_usd, risk_score, risk_severity,
			detection_count, span_count, started_at, completed_at
		FROM traces
		WHERE org_id = ? AND project_id = ?
		ORDER BY started_at DESC
		LIMIT ?`,
		orgID, projectID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query traces: %w", err)
	}
	defer rows.Close()

	var traces []TraceRow
	for rows.Next() {
		var t TraceRow
		if err := rows.Scan(
			&t.TraceID, &t.AgentID, &t.WorkflowID, &t.Status, &t.LatencyMs,
			&t.TotalTokens, &t.CostUSD, &t.RiskScore, &t.RiskSeverity,
			&t.DetectionCount, &t.SpanCount, &t.StartedAt, &t.CompletedAt,
		); err != nil {
			return nil, fmt.Errorf("scan trace: %w", err)
		}
		traces = append(traces, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traces: %w", err)
	}
	return traces, nil
}

// QuerySpans returns all spans for a trace, scoped to a tenant.
func (s *ClickHouseStore) QuerySpans(ctx context.Context, traceID, orgID, projectID string) ([]SpanRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			trace_id, span_id, parent_span_id, type, name, status,
			latency_ms, model, prompt_tokens, completion_tokens, cost_usd,
			input_preview, output_preview,
			attributes, started_at
		FROM spans
		WHERE trace_id = ? AND org_id = ? AND project_id = ?
		ORDER BY started_at ASC`,
		traceID, orgID, projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("query spans: %w", err)
	}
	defer rows.Close()

	var spans []SpanRow
	for rows.Next() {
		var sp SpanRow
		if err := rows.Scan(
			&sp.TraceID, &sp.SpanID, &sp.ParentSpanID, &sp.Type, &sp.Name, &sp.Status,
			&sp.LatencyMs, &sp.Model, &sp.PromptTokens, &sp.CompletionTokens, &sp.CostUSD,
			&sp.InputPreview, &sp.OutputPreview,
			&sp.Attributes, &sp.StartedAt,
		); err != nil {
			return nil, fmt.Errorf("scan span: %w", err)
		}
		spans = append(spans, sp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate spans: %w", err)
	}
	return spans, nil
}

// QueryDetections returns detections for a trace, scoped to a tenant.
func (s *ClickHouseStore) QueryDetections(ctx context.Context, traceID, orgID, projectID string) ([]DetectionRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			trace_id, span_id, detector, category, severity,
			confidence, description, is_beta, detected_at
		FROM detections
		WHERE trace_id = ? AND org_id = ? AND project_id = ?
		ORDER BY detected_at ASC`,
		traceID, orgID, projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("query detections: %w", err)
	}
	defer rows.Close()

	var dets []DetectionRow
	for rows.Next() {
		var d DetectionRow
		if err := rows.Scan(
			&d.TraceID, &d.SpanID, &d.Detector, &d.Category, &d.Severity,
			&d.Confidence, &d.Description, &d.IsBeta, &d.DetectedAt,
		); err != nil {
			return nil, fmt.Errorf("scan detection: %w", err)
		}
		dets = append(dets, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate detections: %w", err)
	}
	return dets, nil
}

// Row types for query results

type TraceRow struct {
	TraceID        string    `json:"trace_id"`
	AgentID        string    `json:"agent_id"`
	WorkflowID     string    `json:"workflow_id"`
	Status         string    `json:"status"`
	LatencyMs      uint32    `json:"latency_ms"`
	TotalTokens    uint32    `json:"total_tokens"`
	CostUSD        float64   `json:"cost_usd"`
	RiskScore      uint8     `json:"risk_score"`
	RiskSeverity   string    `json:"risk_severity"`
	DetectionCount uint16    `json:"detection_count"`
	SpanCount      uint16    `json:"span_count"`
	StartedAt      time.Time `json:"started_at"`
	CompletedAt    time.Time `json:"completed_at"`
}

type SpanRow struct {
	TraceID          string            `json:"trace_id"`
	SpanID           string            `json:"span_id"`
	ParentSpanID     string            `json:"parent_span_id"`
	Type             string            `json:"type"`
	Name             string            `json:"name"`
	Status           string            `json:"status"`
	LatencyMs        uint32            `json:"latency_ms"`
	Model            string            `json:"model"`
	PromptTokens     uint32            `json:"prompt_tokens"`
	CompletionTokens uint32            `json:"completion_tokens"`
	CostUSD          float64           `json:"cost_usd"`
	InputPreview     string            `json:"input_preview,omitempty"`
	OutputPreview    string            `json:"output_preview,omitempty"`
	Attributes       map[string]string `json:"attributes"`
	StartedAt        time.Time         `json:"started_at"`
}

type DetectionRow struct {
	TraceID     string    `json:"trace_id"`
	SpanID      string    `json:"span_id"`
	Detector    string    `json:"detector"`
	Category    string    `json:"category"`
	Severity    string    `json:"severity"`
	Confidence  float32   `json:"confidence"`
	Description string    `json:"description"`
	IsBeta      uint8     `json:"is_beta"`
	DetectedAt  time.Time `json:"detected_at"`
}

// Close flushes pending data and closes the ClickHouse connection.
func (s *ClickHouseStore) Close() error {
	close(s.done)
	s.flushTimer.Stop()
	s.Flush() // Final flush
	return s.conn.Close()
}

// Ping checks if ClickHouse is reachable.
func (s *ClickHouseStore) Ping(ctx context.Context) error {
	return s.conn.Ping(ctx)
}

// ─── Agent and Cost Queries ─────────────────────────────────────────────────

// AgentRow represents aggregated agent stats.
type AgentRow struct {
	AgentID        string    `json:"agent_id"`
	TraceCount     uint64    `json:"trace_count"`
	ErrorCount     uint64    `json:"error_count"`
	AvgLatencyMs   float64   `json:"avg_latency_ms"`
	P95LatencyMs   float64   `json:"p95_latency_ms"`
	TotalTokens    uint64    `json:"total_tokens"`
	TotalCost      float64   `json:"total_cost"`
	DetectionCount uint64    `json:"detection_count"`
	LastSeenAt     time.Time `json:"last_seen_at"`
}

// QueryAgents returns aggregated agent stats for a project.
func (s *ClickHouseStore) QueryAgents(ctx context.Context, orgID, projectID string) ([]AgentRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			agent_id,
			count() AS trace_count,
			countIf(status = 'error') AS error_count,
			avg(latency_ms) AS avg_latency_ms,
			quantile(0.95)(latency_ms) AS p95_latency_ms,
			sum(total_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost,
			sum(detection_count) AS detection_count,
			max(started_at) AS last_seen_at
		FROM traces
		WHERE org_id = ? AND project_id = ?
		GROUP BY agent_id
		ORDER BY trace_count DESC
		LIMIT 100`,
		orgID, projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("query agents: %w", err)
	}
	defer rows.Close()

	var agents []AgentRow
	for rows.Next() {
		var a AgentRow
		if err := rows.Scan(
			&a.AgentID, &a.TraceCount, &a.ErrorCount,
			&a.AvgLatencyMs, &a.P95LatencyMs,
			&a.TotalTokens, &a.TotalCost, &a.DetectionCount, &a.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("scan agent: %w", err)
		}
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agents: %w", err)
	}
	return agents, nil
}

// CostRow represents cost breakdown by model.
type CostRow struct {
	Model           string  `json:"model"`
	CallCount       uint64  `json:"call_count"`
	TotalPrompt     uint64  `json:"total_prompt_tokens"`
	TotalCompletion uint64  `json:"total_completion_tokens"`
	TotalCost       float64 `json:"total_cost"`
	AvgCostPerCall  float64 `json:"avg_cost_per_call"`
}

// QueryCosts returns cost breakdown by model for a project.
func (s *ClickHouseStore) QueryCosts(ctx context.Context, orgID, projectID string) ([]CostRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			model,
			count() AS call_count,
			sum(prompt_tokens) AS total_prompt_tokens,
			sum(completion_tokens) AS total_completion_tokens,
			sum(cost_usd) AS total_cost,
			avg(cost_usd) AS avg_cost_per_call
		FROM spans
		WHERE org_id = ? AND project_id = ? AND model != ''
		GROUP BY model
		ORDER BY total_cost DESC
		LIMIT 50`,
		orgID, projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("query costs: %w", err)
	}
	defer rows.Close()

	var costs []CostRow
	for rows.Next() {
		var c CostRow
		if err := rows.Scan(
			&c.Model, &c.CallCount, &c.TotalPrompt,
			&c.TotalCompletion, &c.TotalCost, &c.AvgCostPerCall,
		); err != nil {
			return nil, fmt.Errorf("scan cost: %w", err)
		}
		costs = append(costs, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate costs: %w", err)
	}
	return costs, nil
}

// ProjectCostRow represents cost aggregated by project within an org.
type ProjectCostRow struct {
	ProjectID   string  `json:"project_id"`
	CallCount   uint64  `json:"call_count"`
	TotalTokens uint64  `json:"total_tokens"`
	TotalCost   float64 `json:"total_cost"`
}

// QueryCostByProject returns cost aggregated by project across the org. This
// powers the per-project cost dimension of the analytics view (DoD #4).
func (s *ClickHouseStore) QueryCostByProject(ctx context.Context, orgID string) ([]ProjectCostRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			project_id,
			count() AS call_count,
			sum(prompt_tokens + completion_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost
		FROM spans
		WHERE org_id = ? AND model != ''
		GROUP BY project_id
		ORDER BY total_cost DESC
		LIMIT 100`,
		orgID,
	)
	if err != nil {
		return nil, fmt.Errorf("query cost by project: %w", err)
	}
	defer rows.Close()

	var out []ProjectCostRow
	for rows.Next() {
		var c ProjectCostRow
		if err := rows.Scan(&c.ProjectID, &c.CallCount, &c.TotalTokens, &c.TotalCost); err != nil {
			return nil, fmt.Errorf("scan project cost: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project costs: %w", err)
	}
	return out, nil
}

// CostSummary returns total cost aggregates for a project.
type CostSummary struct {
	TotalCost      float64 `json:"total_cost"`
	TotalCalls     uint64  `json:"total_calls"`
	TotalTokens    uint64  `json:"total_tokens"`
	AvgCostPerCall float64 `json:"avg_cost_per_call"`
}

func (s *ClickHouseStore) QueryCostSummary(ctx context.Context, orgID, projectID string) (*CostSummary, error) {
	var cs CostSummary
	err := s.conn.QueryRow(ctx, `
		SELECT
			sum(cost_usd) AS total_cost,
			count() AS total_calls,
			sum(prompt_tokens + completion_tokens) AS total_tokens,
			if(count() > 0, sum(cost_usd) / count(), 0) AS avg_cost_per_call
		FROM spans
		WHERE org_id = ? AND project_id = ? AND model != ''`,
		orgID, projectID,
	).Scan(&cs.TotalCost, &cs.TotalCalls, &cs.TotalTokens, &cs.AvgCostPerCall)
	if err != nil {
		return nil, fmt.Errorf("query cost summary: %w", err)
	}
	return &cs, nil
}

// ─── Time-series Metrics ────────────────────────────────────────────────────

// MetricPoint is one time bucket of aggregated trace metrics.
type MetricPoint struct {
	Bucket       time.Time `json:"bucket"`
	TraceCount   uint64    `json:"trace_count"`
	ErrorCount   uint64    `json:"error_count"`
	AvgLatencyMs float64   `json:"avg_latency_ms"`
	P95LatencyMs float64   `json:"p95_latency_ms"`
	TotalTokens  uint64    `json:"total_tokens"`
	TotalCost    float64   `json:"total_cost"`
}

// QueryMetricsTimeseries returns trace metrics bucketed by intervalSec over the
// trailing windowSec, for the dashboard's Metrics view (latency, throughput,
// error rate, tokens, cost over time).
func (s *ClickHouseStore) QueryMetricsTimeseries(ctx context.Context, orgID, projectID string, windowSec, intervalSec int) ([]MetricPoint, error) {
	if intervalSec <= 0 {
		intervalSec = 300
	}
	if windowSec <= 0 {
		windowSec = 86400
	}
	rows, err := s.conn.Query(ctx, `
		SELECT
			toStartOfInterval(started_at, toIntervalSecond(?)) AS bucket,
			count() AS trace_count,
			countIf(status = 'error') AS error_count,
			avg(latency_ms) AS avg_latency,
			quantile(0.95)(latency_ms) AS p95_latency,
			sum(total_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost
		FROM traces
		WHERE org_id = ? AND project_id = ?
		  AND started_at >= now() - toIntervalSecond(?)
		GROUP BY bucket
		ORDER BY bucket ASC`,
		intervalSec, orgID, projectID, windowSec,
	)
	if err != nil {
		return nil, fmt.Errorf("query metrics timeseries: %w", err)
	}
	defer rows.Close()

	var points []MetricPoint
	for rows.Next() {
		var p MetricPoint
		if err := rows.Scan(
			&p.Bucket, &p.TraceCount, &p.ErrorCount,
			&p.AvgLatencyMs, &p.P95LatencyMs, &p.TotalTokens, &p.TotalCost,
		); err != nil {
			return nil, fmt.Errorf("scan metric point: %w", err)
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate metrics: %w", err)
	}
	return points, nil
}

// WindowCostUSD returns total spend in the trailing windowSec for a project —
// used to evaluate cost_threshold alerts.
func (s *ClickHouseStore) WindowCostUSD(ctx context.Context, orgID, projectID string, windowSec int) (float64, error) {
	if windowSec <= 0 {
		windowSec = 86400
	}
	var cost float64
	err := s.conn.QueryRow(ctx, `
		SELECT sum(cost_usd) FROM traces
		WHERE org_id = ? AND project_id = ? AND started_at >= now() - toIntervalSecond(?)`,
		orgID, projectID, windowSec,
	).Scan(&cost)
	if err != nil {
		return 0, fmt.Errorf("query window cost: %w", err)
	}
	return cost, nil
}

// ─── Detection Result Storage ───────────────────────────────────────────────

// InsertDetectionResult writes all detections from a result to ClickHouse.
func (s *ClickHouseStore) InsertDetectionResult(ctx context.Context, result *streaming.DetectionResult) error {
	for _, d := range result.Detections {
		isBeta := uint8(0)
		if d.Beta {
			isBeta = 1
		}
		if err := s.InsertDetection(ctx, &Detection{
			TraceID:     result.TraceID,
			SpanID:      result.SpanID,
			OrgID:       result.OrgID,
			ProjectID:   result.ProjectID,
			Detector:    d.Detector,
			Category:    d.Category,
			Severity:    d.Severity,
			Confidence:  d.Confidence,
			Description: d.Description,
			IsBeta:      isBeta,
		}); err != nil {
			return err
		}
	}
	return nil
}

// UpdateTraceRisk updates the risk score and detection count on a trace.
// Uses ClickHouse lightweight ALTER TABLE ... UPDATE (async mutation).
func (s *ClickHouseStore) UpdateTraceRisk(ctx context.Context, traceID, orgID, projectID string, riskScore int, severity string, detectionCount int) error {
	err := s.conn.Exec(ctx, `
		ALTER TABLE traces UPDATE
			risk_score = ?,
			risk_severity = ?,
			detection_count = detection_count + ?
		WHERE trace_id = ? AND org_id = ? AND project_id = ?`,
		uint8(riskScore), severity, uint16(detectionCount),
		traceID, orgID, projectID,
	)
	if err != nil {
		s.logger.Error("update trace risk failed", zap.Error(err))
		return fmt.Errorf("update trace risk: %w", err)
	}
	return nil
}
