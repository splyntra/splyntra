// SPDX-License-Identifier: FSL-1.1-ALv2
package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
)

type modelPrice struct{ promptPer1K, completionPer1K float64 }

// LLM cost table (USD per 1K tokens) - updated pricing as of 2024
var modelCosts = map[string]modelPrice{
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

// sortedModelPrefixes holds the price-table keys sorted longest-first so that
// prefix matching of versioned model names is DETERMINISTIC (a Go map iterates
// in random order, which previously made "gpt-4o-2024-05-13" bind to either
// "gpt-4o" or "gpt-4" depending on the run). Longest-prefix wins.
// ModelPrice is the exported per-1K-token pricing used when loading the price
// table from Postgres (see SetModelPrices).
type ModelPrice struct {
	PromptPer1K     float64
	CompletionPer1K float64
}

// priceTable is the active price map plus its keys sorted longest-first for
// deterministic longest-prefix matching. Swapped atomically on reload.
type priceTable struct {
	prices   map[string]modelPrice
	prefixes []string
}

var activePrices atomic.Value // *priceTable

// unpricedModels dedupes the "unpriced model" warning so we log each unknown
// model once instead of on every span.
var unpricedModels sync.Map

func init() {
	setPriceTable(modelCosts) // seed with the built-in defaults
}

func setPriceTable(m map[string]modelPrice) {
	prefixes := make([]string, 0, len(m))
	for k := range m {
		prefixes = append(prefixes, k)
	}
	sort.Slice(prefixes, func(i, j int) bool {
		if len(prefixes[i]) != len(prefixes[j]) {
			return len(prefixes[i]) > len(prefixes[j])
		}
		return prefixes[i] < prefixes[j]
	})
	activePrices.Store(&priceTable{prices: m, prefixes: prefixes})
}

// SetModelPrices replaces the active price table (called by the collector after
// loading model_prices from Postgres, and on periodic refresh). An empty map is
// ignored so a transient DB failure keeps the last-known/built-in prices.
func SetModelPrices(prices map[string]ModelPrice) {
	if len(prices) == 0 {
		return
	}
	m := make(map[string]modelPrice, len(prices))
	for k, v := range prices {
		m[k] = modelPrice{v.PromptPer1K, v.CompletionPer1K}
	}
	setPriceTable(m)
}

// UnpricedModels returns the distinct model names seen at ingest that had no
// price-table entry (so their cost was recorded as $0). Surfaced by the pricing
// admin API so operators can see + fix understated spend.
func UnpricedModels() []string {
	var out []string
	unpricedModels.Range(func(k, _ any) bool {
		if s, ok := k.(string); ok {
			out = append(out, s)
		}
		return true
	})
	sort.Strings(out)
	return out
}

// lookupModelPrice resolves a model's pricing: exact match first, then a
// deterministic longest-prefix match for versioned names. Returns false when the
// model is not in the price table (caller records $0 and should surface it).
func lookupModelPrice(model string) (modelPrice, bool) {
	pt, _ := activePrices.Load().(*priceTable)
	if pt == nil {
		return modelPrice{}, false
	}
	if p, ok := pt.prices[model]; ok {
		return p, true
	}
	for _, prefix := range pt.prefixes {
		if strings.HasPrefix(model, prefix) {
			return pt.prices[prefix], true
		}
	}
	return modelPrice{}, false
}

// ComputeCost calculates the USD cost for a span based on model and tokens.
// Unknown models cost $0 (surfaced via a one-time warning in InsertSpan).
func ComputeCost(model string, promptTokens, completionTokens uint32) float64 {
	p, ok := lookupModelPrice(model)
	if !ok {
		return 0
	}
	return (float64(promptTokens)/1000)*p.promptPer1K +
		(float64(completionTokens)/1000)*p.completionPer1K
}

// ClickHouseStore handles writing and querying trace data.
type ClickHouseStore struct {
	conn   driver.Conn
	logger *zap.Logger

	// Batch buffer
	mu         sync.Mutex
	spanBuf    []*streaming.SpanEvent
	traceBuf   []*streaming.TraceEvent
	logBuf     []*streaming.LogEvent
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
		logBuf:     make([]*streaming.LogEvent, 0, batchSize),
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
	logs := s.logBuf
	s.spanBuf = make([]*streaming.SpanEvent, 0, batchSize)
	s.traceBuf = make([]*streaming.TraceEvent, 0, batchSize)
	s.logBuf = make([]*streaming.LogEvent, 0, batchSize)
	s.mu.Unlock()

	if len(spans) > 0 {
		s.flushSpans(spans)
	}
	if len(traces) > 0 {
		s.flushTraces(traces)
	}
	if len(logs) > 0 {
		s.flushLogs(logs)
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
	// Back up to a rune boundary so a multi-byte UTF-8 character is never split,
	// which would store an invalid trailing byte in the preview/body columns.
	end := maxLen
	for end > 0 && !utf8.RuneStart(s[end]) {
		end--
	}
	return s[:end]
}

func (s *ClickHouseStore) flushLogs(logs []*streaming.LogEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	batch, err := s.conn.PrepareBatch(ctx, `
		INSERT INTO logs (
			timestamp, org_id, project_id, environment, agent_id,
			trace_id, span_id, severity, body, attributes
		)`)
	if err != nil {
		s.logger.Error("prepare log batch failed", zap.Error(err))
		return
	}
	for _, l := range logs {
		sev := l.Severity
		if sev == "" {
			sev = "INFO"
		}
		if err := batch.Append(
			l.Timestamp, l.OrgID, l.ProjectID, l.Environment, l.AgentID,
			l.TraceID, l.SpanID, sev, truncate(l.Body, 8192), l.Attributes,
		); err != nil {
			s.logger.Error("append log to batch failed", zap.Error(err))
		}
	}
	if err := batch.Send(); err != nil {
		s.logger.Error("send log batch failed", zap.Error(err), zap.Int("count", len(logs)))
	} else {
		s.logger.Debug("flushed logs", zap.Int("count", len(logs)))
	}
}

// InsertLog buffers a structured log record for batch insertion.
func (s *ClickHouseStore) InsertLog(ctx context.Context, log *streaming.LogEvent) error {
	s.mu.Lock()
	s.logBuf = append(s.logBuf, log)
	shouldFlush := len(s.logBuf) >= batchSize
	s.mu.Unlock()
	if shouldFlush {
		go s.Flush()
	}
	return nil
}

// LogRow is a stored structured log record for the dashboard logs view.
type LogRow struct {
	Timestamp  time.Time         `json:"timestamp"`
	AgentID    string            `json:"agent_id"`
	TraceID    string            `json:"trace_id"`
	SpanID     string            `json:"span_id"`
	Severity   string            `json:"severity"`
	Body       string            `json:"body"`
	Attributes map[string]string `json:"attributes"`
}

// LogFilter carries list filters + pagination for QueryLogs. MinSeverity uses the
// severity Enum8 ordinal (>=), so "WARN" returns WARN/ERROR/FATAL.
type LogFilter struct {
	Limit       int
	Offset      int
	AgentID     string
	TraceID     string
	MinSeverity string // "", TRACE|DEBUG|INFO|WARN|ERROR|FATAL
	Search      string // substring match on body
	SinceSec    int
	Source      string // "", "agent", "platform"
	Platform    string
}

// QueryLogs returns a page of structured logs matching the filter + total count.
// Source/platform scope is applied via the traces table (logs carry trace_id).
func (s *ClickHouseStore) QueryLogs(ctx context.Context, orgID, projectID string, f LogFilter) ([]LogRow, uint64, error) {
	where := "org_id = ? AND project_id = ?"
	args := []any{orgID, projectID}
	if f.AgentID != "" {
		where += " AND agent_id = ?"
		args = append(args, f.AgentID)
	}
	if f.TraceID != "" {
		where += " AND trace_id = ?"
		args = append(args, f.TraceID)
	}
	if f.MinSeverity != "" {
		where += " AND severity >= ?"
		args = append(args, f.MinSeverity)
	}
	if f.Search != "" {
		where += " AND positionCaseInsensitive(body, ?) > 0"
		args = append(args, f.Search)
	}
	if f.SinceSec > 0 {
		where += " AND timestamp >= now() - toIntervalSecond(?)"
		args = append(args, f.SinceSec)
	}
	if clause, subArgs := traceScopeSubquery(orgID, projectID, f.Source, f.Platform); clause != "" {
		where += clause
		args = append(args, subArgs...)
	}

	var total uint64
	if err := s.conn.QueryRow(ctx, "SELECT count() FROM logs WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count logs: %w", err)
	}

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.conn.Query(ctx, `
		SELECT timestamp, agent_id, trace_id, span_id, severity, body, attributes
		FROM logs WHERE `+where+`
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("query logs: %w", err)
	}
	defer rows.Close()
	var out []LogRow
	for rows.Next() {
		var l LogRow
		if err := rows.Scan(&l.Timestamp, &l.AgentID, &l.TraceID, &l.SpanID, &l.Severity, &l.Body, &l.Attributes); err != nil {
			return nil, 0, fmt.Errorf("scan log: %w", err)
		}
		out = append(out, l)
	}
	return out, total, rows.Err()
}

func (s *ClickHouseStore) flushTraces(traces []*streaming.TraceEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	batch, err := s.conn.PrepareBatch(ctx, `
		INSERT INTO traces (
			trace_id, org_id, project_id, environment, agent_id, platform, workflow_id, workflow_name, workflow_version,
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
			trace.AgentID, trace.Platform, trace.WorkflowID, trace.WorkflowName, trace.WorkflowVersion,
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
	// Compute cost before buffering. Warn once per unknown model so silent $0
	// pricing (understated spend) is visible in the logs instead of hidden.
	if span.Model != "" && span.CostUSD == 0 {
		if _, priced := lookupModelPrice(span.Model); !priced {
			if _, seen := unpricedModels.LoadOrStore(span.Model, true); !seen {
				s.logger.Warn("unpriced model — cost recorded as $0; add it to the price table",
					zap.String("model", span.Model))
			}
		}
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
			trace_id, span_id, org_id, project_id, agent_id,
			detector, category, severity, confidence, description, is_beta
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.TraceID, d.SpanID, d.OrgID, d.ProjectID, d.AgentID,
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
	AgentID     string
	Detector    string
	Category    string
	Severity    string
	Confidence  float32
	Description string
	IsBeta      uint8
}

// QueryTraces returns recent traces for a project.
// TraceFilter carries list filters + pagination for QueryTraces. Zero values
// mean "no filter". MinRisk filters on risk_score (>=); SinceSec bounds to the
// trailing window.
type TraceFilter struct {
	Limit      int
	Offset     int
	AgentID    string
	WorkflowID string
	Status     string // "", "ok", "error"
	MinRisk    int    // risk_score >= MinRisk
	SinceSec   int
	// Source-domain scoping (shared across trace/metric/incident/cost queries):
	// Source "" = all, "agent" = SDK agents (platform=''), "platform" = any
	// platform run (platform<>''). Platform, when set, narrows to that platform id.
	Source   string
	Platform string
}

// sourceWhere appends a platform-domain scoping clause to a WHERE fragment and
// returns the extended clause + args. It is the single place the Agents vs Agent
// Platforms separation is enforced at the query layer. An explicit platform id
// wins over source; source "agent"→platform='', "platform"→platform<>'',
// ""→no clause (fleet/all).
func sourceWhere(where string, args []any, source, platform string) (string, []any) {
	if platform != "" {
		return where + " AND platform = ?", append(args, platform)
	}
	switch source {
	case "agent":
		return where + " AND platform = ''", args
	case "platform":
		return where + " AND platform <> ''", args
	}
	return where, args
}

// traceScopeSubquery returns an `AND trace_id IN (…)` clause (+ args) restricting
// a detections/spans query to traces of a given source domain. Those tables don't
// carry `platform`, so the domain filter is applied via a subquery on `traces`.
// Returns "" when no scoping is requested (source "" and no platform id).
func traceScopeSubquery(orgID, projectID, source, platform string) (string, []any) {
	if platform == "" && source != "agent" && source != "platform" {
		return "", nil
	}
	sw, swArgs := sourceWhere("org_id = ? AND project_id = ?", []any{orgID, projectID}, source, platform)
	return " AND trace_id IN (SELECT trace_id FROM traces WHERE " + sw + ")", swArgs
}

// QueryTraces returns a page of traces matching the filter, plus the TOTAL count
// of matches (for real pagination). All filters are applied to both queries and
// every query is org+project scoped.
func (s *ClickHouseStore) QueryTraces(ctx context.Context, orgID, projectID string, f TraceFilter) ([]TraceRow, uint64, error) {
	where := "org_id = ? AND project_id = ?"
	args := []any{orgID, projectID}
	if f.AgentID != "" {
		where += " AND agent_id = ?"
		args = append(args, f.AgentID)
	}
	if f.WorkflowID != "" {
		where += " AND workflow_id = ?"
		args = append(args, f.WorkflowID)
	}
	where, args = sourceWhere(where, args, f.Source, f.Platform)
	if f.Status == "ok" || f.Status == "error" {
		where += " AND status = ?"
		args = append(args, f.Status)
	}
	if f.MinRisk > 0 {
		where += " AND risk_score >= ?"
		args = append(args, f.MinRisk)
	}
	if f.SinceSec > 0 {
		where += " AND started_at >= now() - toIntervalSecond(?)"
		args = append(args, f.SinceSec)
	}

	var total uint64
	if err := s.conn.QueryRow(ctx, "SELECT count() FROM traces FINAL WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count traces: %w", err)
	}

	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.conn.Query(ctx, `
		SELECT
			trace_id, agent_id, platform, workflow_id, workflow_name, status, latency_ms,
			total_tokens, cost_usd, risk_score, risk_severity,
			detection_count, span_count, started_at, completed_at
		FROM traces FINAL
		WHERE `+where+`
		ORDER BY started_at DESC
		LIMIT ? OFFSET ?`,
		pageArgs...,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("query traces: %w", err)
	}
	defer rows.Close()

	var traces []TraceRow
	for rows.Next() {
		var t TraceRow
		if err := rows.Scan(
			&t.TraceID, &t.AgentID, &t.Platform, &t.WorkflowID, &t.WorkflowName, &t.Status, &t.LatencyMs,
			&t.TotalTokens, &t.CostUSD, &t.RiskScore, &t.RiskSeverity,
			&t.DetectionCount, &t.SpanCount, &t.StartedAt, &t.CompletedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan trace: %w", err)
		}
		traces = append(traces, t)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate traces: %w", err)
	}
	return traces, total, nil
}

// QuerySpans returns all spans for a trace, scoped to a tenant.
func (s *ClickHouseStore) QuerySpans(ctx context.Context, traceID, orgID, projectID string) ([]SpanRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			trace_id, span_id, parent_span_id, type, name, status,
			latency_ms, model, prompt_tokens, completion_tokens, cost_usd,
			input_preview, output_preview,
			attributes, started_at
		FROM spans FINAL
		WHERE trace_id = ? AND org_id = ? AND project_id = ?
		ORDER BY started_at ASC
		LIMIT 5000`,
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
// IncidentFilter carries filters + pagination for the org/project-wide security
// incidents feed. Zero values mean "no filter".
type IncidentFilter struct {
	Limit       int
	Offset      int
	AgentID     string // scope the feed to a single agent (per-agent Trust view)
	Detector    string // "pii" | "secrets" | "injection"
	MinSeverity string // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" (>= comparison)
	SinceSec    int
	Source      string // "", "agent", "platform" — source-domain scoping
	Platform    string // narrow to a single platform id
}

// QueryIncidents lists detections across all of a project's traces (the Security
// Incidents feed), with filters + pagination, plus the total match count.
// Severity is an Enum8 (LOW=1..CRITICAL=4), so `severity >= ?` gives a floor.
func (s *ClickHouseStore) QueryIncidents(ctx context.Context, orgID, projectID string, f IncidentFilter) ([]DetectionRow, uint64, error) {
	where := "org_id = ? AND project_id = ?"
	args := []any{orgID, projectID}
	if f.AgentID != "" {
		where += " AND agent_id = ?"
		args = append(args, f.AgentID)
	}
	if f.Detector != "" {
		where += " AND detector = ?"
		args = append(args, f.Detector)
	}
	if f.MinSeverity != "" {
		where += " AND severity >= ?"
		args = append(args, f.MinSeverity)
	}
	if f.SinceSec > 0 {
		where += " AND detected_at >= now() - toIntervalSecond(?)"
		args = append(args, f.SinceSec)
	}
	if clause, subArgs := traceScopeSubquery(orgID, projectID, f.Source, f.Platform); clause != "" {
		where += clause
		args = append(args, subArgs...)
	}

	var total uint64
	if err := s.conn.QueryRow(ctx, "SELECT count() FROM detections FINAL WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count incidents: %w", err)
	}

	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.conn.Query(ctx, `
		SELECT
			trace_id, span_id, agent_id, detector, category, severity,
			confidence, description, is_beta, detected_at
		FROM detections FINAL
		WHERE `+where+`
		ORDER BY detected_at DESC
		LIMIT ? OFFSET ?`,
		pageArgs...,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("query incidents: %w", err)
	}
	defer rows.Close()
	var dets []DetectionRow
	for rows.Next() {
		var d DetectionRow
		if err := rows.Scan(
			&d.TraceID, &d.SpanID, &d.AgentID, &d.Detector, &d.Category, &d.Severity,
			&d.Confidence, &d.Description, &d.IsBeta, &d.DetectedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan incident: %w", err)
		}
		dets = append(dets, d)
	}
	return dets, total, rows.Err()
}

// IncidentSummary is the aggregate rollup shown above the incidents feed:
// totals plus severity, detector, and top-offending-agent distributions over the
// same filter window. It answers "what's the shape of my risk" before the reader
// scrolls the raw feed.
type IncidentSummary struct {
	Total      uint64           `json:"total"`
	BySeverity map[string]uint64 `json:"by_severity"`
	ByDetector map[string]uint64 `json:"by_detector"`
	TopAgents  []AgentCount     `json:"top_agents"`
}

// AgentCount is one row of the top-offending-agents breakdown.
type AgentCount struct {
	AgentID string `json:"agent_id"`
	Count   uint64 `json:"count"`
}

// QueryIncidentSummary computes the aggregate distributions for the Security
// dashboard's summary strip, honoring the same filters as QueryIncidents (minus
// pagination) so the rollup matches the feed the reader is looking at.
func (s *ClickHouseStore) QueryIncidentSummary(ctx context.Context, orgID, projectID string, f IncidentFilter) (*IncidentSummary, error) {
	where := "org_id = ? AND project_id = ?"
	args := []any{orgID, projectID}
	if f.AgentID != "" {
		where += " AND agent_id = ?"
		args = append(args, f.AgentID)
	}
	if f.Detector != "" {
		where += " AND detector = ?"
		args = append(args, f.Detector)
	}
	if f.MinSeverity != "" {
		where += " AND severity >= ?"
		args = append(args, f.MinSeverity)
	}
	if f.SinceSec > 0 {
		where += " AND detected_at >= now() - toIntervalSecond(?)"
		args = append(args, f.SinceSec)
	}
	if clause, subArgs := traceScopeSubquery(orgID, projectID, f.Source, f.Platform); clause != "" {
		where += clause
		args = append(args, subArgs...)
	}

	sum := &IncidentSummary{BySeverity: map[string]uint64{}, ByDetector: map[string]uint64{}, TopAgents: []AgentCount{}}

	// Severity distribution (Enum8 rendered as its name).
	sevRows, err := s.conn.Query(ctx, "SELECT toString(severity), count() FROM detections FINAL WHERE "+where+" GROUP BY severity", args...)
	if err != nil {
		return nil, fmt.Errorf("summary by severity: %w", err)
	}
	for sevRows.Next() {
		var name string
		var n uint64
		if err := sevRows.Scan(&name, &n); err != nil {
			sevRows.Close()
			return nil, fmt.Errorf("scan severity summary: %w", err)
		}
		sum.BySeverity[name] = n
		sum.Total += n
	}
	sevRows.Close()

	detRows, err := s.conn.Query(ctx, "SELECT detector, count() FROM detections FINAL WHERE "+where+" GROUP BY detector", args...)
	if err != nil {
		return nil, fmt.Errorf("summary by detector: %w", err)
	}
	for detRows.Next() {
		var name string
		var n uint64
		if err := detRows.Scan(&name, &n); err != nil {
			detRows.Close()
			return nil, fmt.Errorf("scan detector summary: %w", err)
		}
		sum.ByDetector[name] = n
	}
	detRows.Close()

	agRows, err := s.conn.Query(ctx, "SELECT agent_id, count() AS c FROM detections FINAL WHERE "+where+" AND agent_id != '' GROUP BY agent_id ORDER BY c DESC LIMIT 5", args...)
	if err != nil {
		return nil, fmt.Errorf("summary top agents: %w", err)
	}
	for agRows.Next() {
		var ac AgentCount
		if err := agRows.Scan(&ac.AgentID, &ac.Count); err != nil {
			agRows.Close()
			return nil, fmt.Errorf("scan agent summary: %w", err)
		}
		sum.TopAgents = append(sum.TopAgents, ac)
	}
	agRows.Close()

	return sum, agRows.Err()
}

func (s *ClickHouseStore) QueryDetections(ctx context.Context, traceID, orgID, projectID string) ([]DetectionRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			trace_id, span_id, agent_id, detector, category, severity,
			confidence, description, is_beta, detected_at
		FROM detections FINAL
		WHERE trace_id = ? AND org_id = ? AND project_id = ?
		ORDER BY detected_at ASC
		LIMIT 2000`,
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
			&d.TraceID, &d.SpanID, &d.AgentID, &d.Detector, &d.Category, &d.Severity,
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
	Platform       string    `json:"platform"`
	WorkflowID     string    `json:"workflow_id"`
	WorkflowName   string    `json:"workflow_name"`
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
	AgentID     string    `json:"agent_id"`
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

// QueryTraceByID returns the stored trace row (with the authoritative risk score
// and timing), or nil if not found. The detail view uses this so its risk/agent/
// timing match the list instead of being recomputed client-side.
func (s *ClickHouseStore) QueryTraceByID(ctx context.Context, traceID, orgID, projectID string) (*TraceRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT trace_id, agent_id, platform, workflow_id, workflow_name, status, latency_ms, total_tokens,
		       cost_usd, risk_score, risk_severity, detection_count, span_count,
		       started_at, completed_at
		FROM traces FINAL
		WHERE trace_id = ? AND org_id = ? AND project_id = ?
		LIMIT 1`,
		traceID, orgID, projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("query trace by id: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	var t TraceRow
	if err := rows.Scan(
		&t.TraceID, &t.AgentID, &t.Platform, &t.WorkflowID, &t.WorkflowName, &t.Status, &t.LatencyMs, &t.TotalTokens,
		&t.CostUSD, &t.RiskScore, &t.RiskSeverity, &t.DetectionCount, &t.SpanCount,
		&t.StartedAt, &t.CompletedAt,
	); err != nil {
		return nil, fmt.Errorf("scan trace: %w", err)
	}
	return &t, nil
}

// DeleteProjectData purges a project's rows from every ClickHouse table. Uses
// ALTER TABLE ... DELETE (async mutations); errors on individual tables are
// returned joined so the caller can log a partial purge. Always filters on both
// org_id and project_id for tenant safety.
func (s *ClickHouseStore) DeleteProjectData(ctx context.Context, orgID, projectID string) error {
	if s == nil || s.conn == nil {
		return nil
	}
	tables := []string{"traces", "spans", "detections", "cost_daily_mv", "logs"}
	var errs []error
	for _, t := range tables {
		// #nosec G201 — table name is from a fixed internal allowlist above.
		q := "ALTER TABLE " + t + " DELETE WHERE org_id = ? AND project_id = ?"
		if err := s.conn.Exec(ctx, q, orgID, projectID); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", t, err))
		}
	}
	return errors.Join(errs...)
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
	AvgRisk        float64   `json:"avg_risk"`
	LastSeenAt     time.Time `json:"last_seen_at"`
}

// QueryAgents returns aggregated agent stats for a project. windowSec > 0 bounds
// the aggregation to the trailing window; 0 means all-time.
func (s *ClickHouseStore) QueryAgents(ctx context.Context, orgID, projectID string, windowSec int) ([]AgentRow, error) {
	// platform = '' keeps Agents strictly SDK-instrumented agents; orchestrator
	// (platform) runs live in the Agent Platforms domain, never here.
	where := "org_id = ? AND project_id = ? AND platform = ''"
	args := []any{orgID, projectID}
	if windowSec > 0 {
		where += " AND started_at >= now() - toIntervalSecond(?)"
		args = append(args, windowSec)
	}
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
			avg(risk_score) AS avg_risk,
			max(started_at) AS last_seen_at
		FROM traces FINAL
		WHERE `+where+`
		GROUP BY agent_id
		ORDER BY trace_count DESC
		LIMIT 100`,
		args...,
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
			&a.TotalTokens, &a.TotalCost, &a.DetectionCount, &a.AvgRisk, &a.LastSeenAt,
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

// PlatformRow aggregates one agent-platform's orchestration activity for the
// Agent Platforms home. Keyed by the traces.platform column (never empty here).
type PlatformRow struct {
	Platform      string    `json:"platform"`
	RunCount      uint64    `json:"run_count"`
	ErrorCount    uint64    `json:"error_count"`
	WorkflowCount uint64    `json:"workflow_count"`
	AvgLatencyMs  float64   `json:"avg_latency_ms"`
	P95LatencyMs  float64   `json:"p95_latency_ms"`
	TotalTokens   uint64    `json:"total_tokens"`
	TotalCost     float64   `json:"total_cost"`
	LastSeenAt    time.Time `json:"last_seen_at"`
}

// QueryPlatforms returns per-platform run aggregates (Agent Platforms domain).
// Only platform (orchestrator) runs are considered — platform <> ''.
func (s *ClickHouseStore) QueryPlatforms(ctx context.Context, orgID, projectID string, windowSec int) ([]PlatformRow, error) {
	where := "org_id = ? AND project_id = ? AND platform <> ''"
	args := []any{orgID, projectID}
	if windowSec > 0 {
		where += " AND started_at >= now() - toIntervalSecond(?)"
		args = append(args, windowSec)
	}
	rows, err := s.conn.Query(ctx, `
		SELECT
			platform,
			count() AS run_count,
			countIf(status = 'error') AS error_count,
			uniqExact(workflow_id) AS workflow_count,
			avg(latency_ms) AS avg_latency_ms,
			quantile(0.95)(latency_ms) AS p95_latency_ms,
			sum(total_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost,
			max(started_at) AS last_seen_at
		FROM traces FINAL
		WHERE `+where+`
		GROUP BY platform
		ORDER BY run_count DESC
		LIMIT 100`,
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("query platforms: %w", err)
	}
	defer rows.Close()
	var out []PlatformRow
	for rows.Next() {
		var p PlatformRow
		if err := rows.Scan(
			&p.Platform, &p.RunCount, &p.ErrorCount, &p.WorkflowCount,
			&p.AvgLatencyMs, &p.P95LatencyMs, &p.TotalTokens, &p.TotalCost, &p.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("scan platform: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// WorkflowRow aggregates one workflow within a platform (Workflow Operations
// dashboard: the workflow list). Version is the latest observed workflow_version.
type WorkflowRow struct {
	WorkflowID   string    `json:"workflow_id"`
	WorkflowName string    `json:"workflow_name"`
	Version      string    `json:"version"`
	RunCount     uint64    `json:"run_count"`
	ErrorCount   uint64    `json:"error_count"`
	AvgLatencyMs float64   `json:"avg_latency_ms"`
	P95LatencyMs float64   `json:"p95_latency_ms"`
	TotalTokens  uint64    `json:"total_tokens"`
	TotalCost    float64   `json:"total_cost"`
	LastSeenAt   time.Time `json:"last_seen_at"`
}

// QueryWorkflows returns per-workflow aggregates for one platform.
func (s *ClickHouseStore) QueryWorkflows(ctx context.Context, orgID, projectID, platform string, windowSec int) ([]WorkflowRow, error) {
	where := "org_id = ? AND project_id = ? AND platform = ?"
	args := []any{orgID, projectID, platform}
	if windowSec > 0 {
		where += " AND started_at >= now() - toIntervalSecond(?)"
		args = append(args, windowSec)
	}
	rows, err := s.conn.Query(ctx, `
		SELECT
			workflow_id,
			any(workflow_name) AS workflow_name,
			argMax(workflow_version, started_at) AS version,
			count() AS run_count,
			countIf(status = 'error') AS error_count,
			avg(latency_ms) AS avg_latency_ms,
			quantile(0.95)(latency_ms) AS p95_latency_ms,
			sum(total_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost,
			max(started_at) AS last_seen_at
		FROM traces FINAL
		WHERE `+where+`
		GROUP BY workflow_id
		ORDER BY run_count DESC
		LIMIT 200`,
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("query workflows: %w", err)
	}
	defer rows.Close()
	var out []WorkflowRow
	for rows.Next() {
		var wf WorkflowRow
		if err := rows.Scan(
			&wf.WorkflowID, &wf.WorkflowName, &wf.Version, &wf.RunCount, &wf.ErrorCount,
			&wf.AvgLatencyMs, &wf.P95LatencyMs, &wf.TotalTokens, &wf.TotalCost, &wf.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("scan workflow: %w", err)
		}
		out = append(out, wf)
	}
	return out, rows.Err()
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

// QueryCosts returns cost breakdown by model for a project. agentID scopes to a
// single agent; source/platform scope to a domain (Agents vs Agent Platforms).
func (s *ClickHouseStore) QueryCosts(ctx context.Context, orgID, projectID, agentID, source, platform string) ([]CostRow, error) {
	// spans carry no agent_id/platform; scope via the traces roll-up when asked.
	where := "org_id = ? AND project_id = ? AND model != ''"
	args := []any{orgID, projectID}
	if agentID != "" {
		where += " AND trace_id IN (SELECT trace_id FROM traces FINAL WHERE org_id = ? AND project_id = ? AND agent_id = ?)"
		args = append(args, orgID, projectID, agentID)
	}
	if clause, subArgs := traceScopeSubquery(orgID, projectID, source, platform); clause != "" {
		where += clause
		args = append(args, subArgs...)
	}
	rows, err := s.conn.Query(ctx, `
		SELECT
			model,
			count() AS call_count,
			sum(prompt_tokens) AS total_prompt_tokens,
			sum(completion_tokens) AS total_completion_tokens,
			sum(cost_usd) AS total_cost,
			avg(cost_usd) AS avg_cost_per_call
		FROM spans FINAL
		WHERE `+where+`
		GROUP BY model
		ORDER BY total_cost DESC
		LIMIT 50`,
		args...,
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
// WorkflowCostRow is spend aggregated by workflow (BRD §6). workflow_id lives on
// the trace roll-up, so this aggregates the traces table (not spans).
type WorkflowCostRow struct {
	WorkflowID  string  `json:"workflow_id"`
	CallCount   uint64  `json:"call_count"`
	TotalTokens uint64  `json:"total_tokens"`
	TotalCost   float64 `json:"total_cost"`
}

// QueryCostByWorkflow returns spend grouped by workflow_id for a project. A
// non-empty platform narrows to that platform's workflows (Agent Platforms view).
func (s *ClickHouseStore) QueryCostByWorkflow(ctx context.Context, orgID, projectID, platform string) ([]WorkflowCostRow, error) {
	where := "org_id = ? AND project_id = ? AND workflow_id != ''"
	args := []any{orgID, projectID}
	if platform != "" {
		where += " AND platform = ?"
		args = append(args, platform)
	}
	rows, err := s.conn.Query(ctx, `
		SELECT
			workflow_id,
			count() AS call_count,
			sum(total_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost
		FROM traces FINAL
		WHERE `+where+`
		GROUP BY workflow_id
		ORDER BY total_cost DESC
		LIMIT 100`,
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("query cost by workflow: %w", err)
	}
	defer rows.Close()
	var out []WorkflowCostRow
	for rows.Next() {
		var c WorkflowCostRow
		if err := rows.Scan(&c.WorkflowID, &c.CallCount, &c.TotalTokens, &c.TotalCost); err != nil {
			return nil, fmt.Errorf("scan workflow cost: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *ClickHouseStore) QueryCostByProject(ctx context.Context, orgID string) ([]ProjectCostRow, error) {
	rows, err := s.conn.Query(ctx, `
		SELECT
			project_id,
			count() AS call_count,
			sum(prompt_tokens + completion_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost
		FROM spans FINAL
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

func (s *ClickHouseStore) QueryCostSummary(ctx context.Context, orgID, projectID, source, platform string) (*CostSummary, error) {
	where := "org_id = ? AND project_id = ? AND model != ''"
	args := []any{orgID, projectID}
	if clause, subArgs := traceScopeSubquery(orgID, projectID, source, platform); clause != "" {
		where += clause
		args = append(args, subArgs...)
	}
	var cs CostSummary
	err := s.conn.QueryRow(ctx, `
		SELECT
			sum(cost_usd) AS total_cost,
			count() AS total_calls,
			sum(prompt_tokens + completion_tokens) AS total_tokens,
			if(count() > 0, sum(cost_usd) / count(), 0) AS avg_cost_per_call
		FROM spans FINAL
		WHERE `+where+``,
		args...,
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
	P50LatencyMs float64   `json:"p50_latency_ms"`
	P95LatencyMs float64   `json:"p95_latency_ms"`
	P99LatencyMs float64   `json:"p99_latency_ms"`
	TotalTokens  uint64    `json:"total_tokens"`
	TotalCost    float64   `json:"total_cost"`
}

// MetricsFilter carries the window/interval plus optional slicing (agent/model)
// and a window OffsetSec used for period-over-period comparison (offset=window
// yields the immediately preceding period).
type MetricsFilter struct {
	WindowSec   int
	IntervalSec int
	OffsetSec   int
	AgentID     string
	Model       string
	Source      string // "", "agent", "platform" — source-domain scoping
	Platform    string // narrow to a single platform id
}

// QueryMetricsTimeseries returns trace metrics bucketed by intervalSec over the
// trailing windowSec, for the dashboard's Metrics view (latency, throughput,
// error rate, tokens, cost over time).
// SpanMetricGroup aggregates spans by a key (span name or MCP server) for the
// Tools & Retrieval + MCP-server monitoring views.
type SpanMetricGroup struct {
	Key        string  `json:"key"`
	Count      uint64  `json:"count"`
	ErrorCount uint64  `json:"error_count"`
	Flagged    uint64  `json:"flagged"` // spans with a security detection (violations/risk)
	AvgMs      float64 `json:"avg_ms"`
	P95Ms      float64 `json:"p95_ms"`
}

// SpanMetricsFilter selects + groups spans. Group "mcp_server" keys by the
// mcp.server.name attribute; anything else keys by span name.
type SpanMetricsFilter struct {
	Type     string
	Group    string
	SinceSec int
	Server   string // filter to one MCP server (attributes['mcp.server.name'])
	Source   string // "", "agent", "platform" — source-domain scoping
	Platform string // narrow to a single platform id
}

// QuerySpanMetrics groups spans (by name or MCP server) with latency/error/flag
// aggregates — powers the Tools & Retrieval view and the MCP Servers page.
func (s *ClickHouseStore) QuerySpanMetrics(ctx context.Context, orgID, projectID string, f SpanMetricsFilter) ([]SpanMetricGroup, error) {
	keyExpr := "name"
	if f.Group == "mcp_server" {
		keyExpr = "attributes['mcp.server.name']"
	}
	where := "org_id = ? AND project_id = ?"
	args := []any{orgID, projectID}
	if f.Type != "" {
		where += " AND type = ?"
		args = append(args, f.Type)
	}
	if f.Server != "" {
		where += " AND attributes['mcp.server.name'] = ?"
		args = append(args, f.Server)
	}
	if f.SinceSec > 0 {
		where += " AND started_at >= now() - toIntervalSecond(?)"
		args = append(args, f.SinceSec)
	}
	if clause, subArgs := traceScopeSubquery(orgID, projectID, f.Source, f.Platform); clause != "" {
		where += clause
		args = append(args, subArgs...)
	}

	rows, err := s.conn.Query(ctx, `
		SELECT `+keyExpr+` AS k, count() AS c, countIf(status = 'error') AS e,
		       avg(latency_ms) AS a, quantile(0.95)(latency_ms) AS p
		FROM spans FINAL WHERE `+where+`
		GROUP BY k ORDER BY c DESC LIMIT 200`, args...)
	if err != nil {
		return nil, fmt.Errorf("query span metrics: %w", err)
	}
	defer rows.Close()
	byKey := map[string]*SpanMetricGroup{}
	var out []SpanMetricGroup
	for rows.Next() {
		var g SpanMetricGroup
		var p float64
		if err := rows.Scan(&g.Key, &g.Count, &g.ErrorCount, &g.AvgMs, &p); err != nil {
			return nil, fmt.Errorf("scan span metric: %w", err)
		}
		g.P95Ms = p
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byKey[out[i].Key] = &out[i]
	}

	// Flagged = spans in each group that have a security detection (the
	// "permission violations / risk" signal). Join spans → detections by span_id.
	frows, err := s.conn.Query(ctx, `
		SELECT `+keyExpr+` AS k, count() AS f
		FROM spans FINAL
		WHERE `+where+` AND span_id IN (SELECT span_id FROM detections WHERE org_id = ? AND project_id = ?)
		GROUP BY k`, append(append([]any{}, args...), orgID, projectID)...)
	if err == nil {
		defer frows.Close()
		for frows.Next() {
			var k string
			var f uint64
			if err := frows.Scan(&k, &f); err == nil {
				if g, ok := byKey[k]; ok {
					g.Flagged = f
				}
			}
		}
	}
	return out, nil
}

func (s *ClickHouseStore) QueryMetricsTimeseries(ctx context.Context, orgID, projectID string, f MetricsFilter) ([]MetricPoint, error) {
	interval := f.IntervalSec
	if interval <= 0 {
		interval = 300
	}
	window := f.WindowSec
	if window <= 0 {
		window = 86400
	}
	offset := f.OffsetSec
	if offset < 0 {
		offset = 0
	}

	where := "org_id = ? AND project_id = ?"
	args := []any{interval, orgID, projectID}
	if f.AgentID != "" {
		where += " AND agent_id = ?"
		args = append(args, f.AgentID)
	}
	if f.Model != "" {
		where += " AND agent_id != '' AND trace_id IN (SELECT DISTINCT trace_id FROM spans FINAL WHERE org_id = ? AND project_id = ? AND model = ?)"
		args = append(args, orgID, projectID, f.Model)
	}
	where, args = sourceWhere(where, args, f.Source, f.Platform)
	// Trailing window shifted back by offset (offset=window → previous period).
	where += " AND started_at >= now() - toIntervalSecond(?) AND started_at < now() - toIntervalSecond(?)"
	args = append(args, window+offset, offset)

	rows, err := s.conn.Query(ctx, `
		SELECT
			toStartOfInterval(started_at, toIntervalSecond(?)) AS bucket,
			count() AS trace_count,
			countIf(status = 'error') AS error_count,
			avg(latency_ms) AS avg_latency,
			quantile(0.5)(latency_ms) AS p50_latency,
			quantile(0.95)(latency_ms) AS p95_latency,
			quantile(0.99)(latency_ms) AS p99_latency,
			sum(total_tokens) AS total_tokens,
			sum(cost_usd) AS total_cost
		FROM traces FINAL
		WHERE `+where+`
		GROUP BY bucket
		ORDER BY bucket ASC`,
		args...,
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
			&p.AvgLatencyMs, &p.P50LatencyMs, &p.P95LatencyMs, &p.P99LatencyMs,
			&p.TotalTokens, &p.TotalCost,
		); err != nil {
			return nil, fmt.Errorf("scan metric point: %w", err)
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate metrics: %w", err)
	}
	return zeroFillBuckets(points, window, interval, offset), nil
}

// zeroFillBuckets emits a point for every interval in the window, including
// empty ones (as zeros), so idle gaps render as zero instead of an interpolated
// straight line. Buckets align to interval multiples of the epoch, matching
// ClickHouse toStartOfInterval.
func zeroFillBuckets(points []MetricPoint, windowSec, intervalSec, offsetSec int) []MetricPoint {
	if intervalSec <= 0 {
		return points
	}
	step := int64(intervalSec)
	now := time.Now().Unix() - int64(offsetSec)
	end := (now / step) * step
	start := ((now - int64(windowSec)) / step) * step
	// Guard against an unreasonable bucket count (belt-and-suspenders; the
	// handler already bounds window/interval).
	if (end-start)/step > 20000 {
		return points
	}
	byBucket := make(map[int64]MetricPoint, len(points))
	for _, p := range points {
		byBucket[p.Bucket.Unix()] = p
	}
	out := make([]MetricPoint, 0, (end-start)/step+1)
	for t := start; t <= end; t += step {
		if p, ok := byBucket[t]; ok {
			out = append(out, p)
		} else {
			out = append(out, MetricPoint{Bucket: time.Unix(t, 0).UTC()})
		}
	}
	return out
}

// WindowCostUSD returns total spend in the trailing windowSec for a project —
// used to evaluate cost_threshold alerts.
func (s *ClickHouseStore) WindowCostUSD(ctx context.Context, orgID, projectID string, windowSec int) (float64, error) {
	if windowSec <= 0 {
		windowSec = 86400
	}
	var cost float64
	err := s.conn.QueryRow(ctx, `
		SELECT sum(cost_usd) FROM traces FINAL
		WHERE org_id = ? AND project_id = ? AND started_at >= now() - toIntervalSecond(?)`,
		orgID, projectID, windowSec,
	).Scan(&cost)
	if err != nil {
		return 0, fmt.Errorf("query window cost: %w", err)
	}
	return cost, nil
}

// MonthToDateCostUSD returns spend since the start of the current month. An
// empty projectID means org-wide (all projects). Used for budget consumption
// and forecasting.
func (s *ClickHouseStore) MonthToDateCostUSD(ctx context.Context, orgID, projectID string) (float64, error) {
	var cost float64
	var err error
	if projectID == "" {
		err = s.conn.QueryRow(ctx,
			`SELECT sum(cost_usd) FROM traces FINAL WHERE org_id = ? AND started_at >= toStartOfMonth(now())`,
			orgID,
		).Scan(&cost)
	} else {
		err = s.conn.QueryRow(ctx,
			`SELECT sum(cost_usd) FROM traces FINAL WHERE org_id = ? AND project_id = ? AND started_at >= toStartOfMonth(now())`,
			orgID, projectID,
		).Scan(&cost)
	}
	if err != nil {
		return 0, fmt.Errorf("query mtd cost: %w", err)
	}
	return cost, nil
}

// TrailingDailyBurnUSD returns the average daily spend over the trailing
// windowDays whole days, EXCLUDING the partial current day so a spike/lull today
// doesn't skew the run-rate. Used for a smoother month-end forecast than the
// naive spent/dayOfMonth pace (which over-reacts early in the month).
func (s *ClickHouseStore) TrailingDailyBurnUSD(ctx context.Context, orgID, projectID string, windowDays int) (float64, error) {
	if windowDays <= 0 {
		windowDays = 7
	}
	where := "org_id = ? AND started_at >= toStartOfDay(now()) - toIntervalDay(?) AND started_at < toStartOfDay(now())"
	args := []any{orgID, windowDays}
	if projectID != "" {
		where += " AND project_id = ?"
		args = append(args, projectID)
	}
	var total float64
	if err := s.conn.QueryRow(ctx, "SELECT sum(cost_usd) FROM traces FINAL WHERE "+where, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("query trailing burn: %w", err)
	}
	return total / float64(windowDays), nil
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
			AgentID:     result.AgentID,
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
//
// A single trace can be scored by more than one detection result (one per span
// processed asynchronously). Risk must accumulate, not last-write-wins: the
// score is raised to the max seen so far and the severity is re-derived from
// that max in SQL so the two never disagree. The passed-in severity thresholds
// mirror riskSeverityFromScore in the streaming consumer.
func (s *ClickHouseStore) UpdateTraceRisk(ctx context.Context, traceID, orgID, projectID string, riskScore int, severity string, detectionCount int) error {
	err := s.conn.Exec(ctx, `
		ALTER TABLE traces UPDATE
			risk_score = greatest(risk_score, ?),
			risk_severity = multiIf(
				greatest(risk_score, ?) >= 75, 'CRITICAL',
				greatest(risk_score, ?) >= 50, 'HIGH',
				greatest(risk_score, ?) >= 25, 'MEDIUM',
				greatest(risk_score, ?) > 0,  'LOW',
				'NONE'),
			detection_count = detection_count + ?
		WHERE trace_id = ? AND org_id = ? AND project_id = ?`,
		uint8(riskScore), uint8(riskScore), uint8(riskScore), uint8(riskScore), uint8(riskScore),
		uint16(detectionCount),
		traceID, orgID, projectID,
	)
	_ = severity // severity is now derived in SQL from the accumulated max
	if err != nil {
		s.logger.Error("update trace risk failed", zap.Error(err))
		return fmt.Errorf("update trace risk: %w", err)
	}
	return nil
}
