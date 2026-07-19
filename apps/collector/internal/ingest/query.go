// SPDX-License-Identifier: FSL-1.1-ALv2
package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"database/sql"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/extension"
	"github.com/splyntra/splyntra/apps/collector/internal/auth"
	"github.com/splyntra/splyntra/apps/collector/internal/store"
)

// QueryHandler serves trace/span query APIs for the dashboard.
type QueryHandler struct {
	logger *zap.Logger
	store  *store.ClickHouseStore
	pg     *store.PostgresStore
}

func NewQueryHandler(logger *zap.Logger, chStore *store.ClickHouseStore, pgStore *store.PostgresStore) *QueryHandler {
	return &QueryHandler{logger: logger, store: chStore, pg: pgStore}
}

// effectiveProject returns the project to scope a query to. A ?project_id query
// param overrides the API key's default project; tenant isolation is preserved
// because every store query also filters on org_id, so a caller can only ever
// reach projects within their own organization.
func effectiveProject(r *http.Request, t *auth.TenantInfo) string {
	if p := r.URL.Query().Get("project_id"); p != "" {
		return p
	}
	return t.ProjectID
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// ListTraces returns recent traces for the authenticated project.
func (q *QueryHandler) ListTraces(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}

	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)

	q2 := r.URL.Query()
	limit := 50
	if parsed, err := strconv.Atoi(q2.Get("limit")); err == nil && parsed > 0 && parsed <= 100 {
		limit = parsed
	}
	offset := 0
	if parsed, err := strconv.Atoi(q2.Get("offset")); err == nil && parsed > 0 {
		offset = parsed
	}
	since := 0
	if parsed, err := strconv.Atoi(q2.Get("since")); err == nil && parsed > 0 {
		since = parsed
	}
	source, platform := parseSource(q2)
	filter := store.TraceFilter{
		Limit:      limit,
		Offset:     offset,
		AgentID:    q2.Get("agent_id"),
		WorkflowID: q2.Get("workflow_id"),
		Status:     q2.Get("status"),
		MinRisk:    severityMinRisk(q2.Get("severity")),
		SinceSec:   since,
		Source:     source,
		Platform:   platform,
	}

	traces, total, err := q.store.QueryTraces(r.Context(), tenantInfo.OrgID, effectiveProject(r, tenantInfo), filter)
	if err != nil {
		q.logger.Error("query traces failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{"traces": traces, "total": total, "limit": limit, "offset": offset})
}

// ListLogs returns a page of structured agent logs (Layer 1 Observability), with
// severity/agent/trace/text/source filters + pagination. Tenant-scoped.
func (q *QueryHandler) ListLogs(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	t := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	qp := r.URL.Query()

	limit := 50
	if n, err := strconv.Atoi(qp.Get("limit")); err == nil && n > 0 && n <= 200 {
		limit = n
	}
	offset := 0
	if n, err := strconv.Atoi(qp.Get("offset")); err == nil && n > 0 {
		offset = n
	}
	since := 0
	if n, err := strconv.Atoi(qp.Get("since")); err == nil && n > 0 {
		since = n
	}
	sev := strings.ToUpper(qp.Get("severity"))
	if !validSeverityLevels[sev] {
		sev = ""
	}
	source, platform := parseSource(qp)
	logs, total, err := q.store.QueryLogs(r.Context(), t.OrgID, effectiveProject(r, t), store.LogFilter{
		Limit: limit, Offset: offset, AgentID: qp.Get("agent_id"), TraceID: qp.Get("trace_id"),
		MinSeverity: sev, Search: qp.Get("search"), SinceSec: since, Source: source, Platform: platform,
	})
	if err != nil {
		q.logger.Error("query logs failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"logs": logs, "total": total, "limit": limit, "offset": offset})
}

// validSeverityLevels bounds the ?severity= min-severity filter for logs.
var validSeverityLevels = map[string]bool{
	"TRACE": true, "DEBUG": true, "INFO": true, "WARN": true, "ERROR": true, "FATAL": true,
}

// parseSource extracts source-domain scoping from query params, shared across the
// fleet views (traces/metrics/incidents/costs). `source` is validated to "",
// "agent", or "platform"; `platform` narrows to a specific platform id (which,
// when present, implies the platform domain regardless of `source`).
func parseSource(qp url.Values) (source, platform string) {
	source = qp.Get("source")
	if source != "agent" && source != "platform" {
		source = ""
	}
	return source, qp.Get("platform")
}

// severityMinRisk maps a minimum-severity filter name to the risk_score floor
// used by trace queries. Unknown/empty → 0 (no filter). These floors MUST match
// the label thresholds in riskSeverityFromScore (streaming/consumer.go) /
// UpdateTraceRisk (store/clickhouse.go) — otherwise a ?severity=critical filter
// silently hides traces labelled CRITICAL. CRITICAL is >=75 there, not 90.
func severityMinRisk(sev string) int {
	switch strings.ToLower(sev) {
	case "low":
		return 1
	case "medium":
		return 25
	case "high":
		return 50
	case "critical":
		return 75
	default:
		return 0
	}
}

var validDetectors = map[string]bool{"pii": true, "secrets": true, "injection": true, "moderation": true, "tool_guard": true}
var validSeverities = map[string]bool{"LOW": true, "MEDIUM": true, "HIGH": true, "CRITICAL": true}

// ListSecurityIncidents returns the org/project-wide security detections feed
// (TRD §14 GET /v1/security/incidents), with detector/severity/time filters and
// pagination. Every query is tenant-scoped via effectiveProject + org_id.
func (q *QueryHandler) ListSecurityIncidents(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	qp := r.URL.Query()

	limit := 50
	if n, err := strconv.Atoi(qp.Get("limit")); err == nil && n > 0 && n <= 100 {
		limit = n
	}
	offset := 0
	if n, err := strconv.Atoi(qp.Get("offset")); err == nil && n > 0 {
		offset = n
	}
	since := 0
	if n, err := strconv.Atoi(qp.Get("since")); err == nil && n > 0 {
		since = n
	}
	detector := qp.Get("detector")
	if detector != "" && !validDetectors[detector] {
		detector = ""
	}
	severity := strings.ToUpper(qp.Get("severity"))
	if !validSeverities[severity] {
		severity = ""
	}

	source, platform := parseSource(qp)
	incidents, total, err := q.store.QueryIncidents(r.Context(), tenantInfo.OrgID, effectiveProject(r, tenantInfo), store.IncidentFilter{
		Limit: limit, Offset: offset, AgentID: qp.Get("agent_id"), Detector: detector, MinSeverity: severity, SinceSec: since,
		Source: source, Platform: platform,
	})
	if err != nil {
		q.logger.Error("query incidents failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"incidents": incidents, "total": total, "limit": limit, "offset": offset})
}

// SecuritySummary returns the aggregate rollup (severity / detector / top-agent
// distributions) for the security dashboard's summary strip, honoring the same
// detector/severity/time/source filters as the feed.
func (q *QueryHandler) SecuritySummary(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	qp := r.URL.Query()

	since := 0
	if n, err := strconv.Atoi(qp.Get("since")); err == nil && n > 0 {
		since = n
	}
	detector := qp.Get("detector")
	if detector != "" && !validDetectors[detector] {
		detector = ""
	}
	severity := strings.ToUpper(qp.Get("severity"))
	if !validSeverities[severity] {
		severity = ""
	}
	source, platform := parseSource(qp)
	summary, err := q.store.QueryIncidentSummary(r.Context(), tenantInfo.OrgID, effectiveProject(r, tenantInfo), store.IncidentFilter{
		AgentID: qp.Get("agent_id"), Detector: detector, MinSeverity: severity, SinceSec: since,
		Source: source, Platform: platform,
	})
	if err != nil {
		q.logger.Error("query incident summary failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, summary)
}

// GetTrace returns a full trace with spans and detections.
// Enforces tenant isolation by filtering on org_id and project_id.
func (q *QueryHandler) GetTrace(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}

	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)

	traceID := chi.URLParam(r, "traceID")
	if traceID == "" {
		http.Error(w, `{"error":"trace_id required"}`, http.StatusBadRequest)
		return
	}

	project := effectiveProject(r, tenantInfo)

	spans, err := q.store.QuerySpans(r.Context(), traceID, tenantInfo.OrgID, project)
	if err != nil {
		q.logger.Error("query spans failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	detections, err := q.store.QueryDetections(r.Context(), traceID, tenantInfo.OrgID, project)
	if err != nil {
		q.logger.Error("query detections failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	// The stored trace row carries the authoritative risk score, agent, status,
	// and timing — so the detail view matches the list instead of recomputing.
	trace, err := q.store.QueryTraceByID(r.Context(), traceID, tenantInfo.OrgID, project)
	if err != nil {
		q.logger.Error("query trace failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"trace_id":   traceID,
		"spans":      spans,
		"detections": detections,
	}
	if trace != nil {
		resp["trace"] = trace
	}
	writeJSON(w, resp)
}

// agentResponse is an agent stat row enriched with registry metadata.
type agentResponse struct {
	store.AgentRow
	Framework   string `json:"framework"`
	DisplayName string `json:"name"`
	Configured  bool   `json:"configured"` // has an explicit Connect-wizard profile
}

// ListAgents returns aggregated agent stats for the authenticated project,
// enriched with framework metadata from the Postgres registry.
func (q *QueryHandler) ListAgents(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}

	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	project := effectiveProject(r, tenantInfo)

	windowSec := 0 // all-time by default
	if v, err := strconv.Atoi(r.URL.Query().Get("window")); err == nil && v > 0 && v <= 90*86400 {
		windowSec = v
	}

	agents, err := q.store.QueryAgents(r.Context(), tenantInfo.OrgID, project, windowSec)
	if err != nil {
		q.logger.Error("query agents failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	meta := map[string]store.AgentMeta{}
	configured := map[string]bool{}
	if q.pg != nil {
		if m, err := q.pg.AgentMetaByID(r.Context(), tenantInfo.OrgID, project); err == nil {
			meta = m
		}
		if c, err := q.pg.ConfiguredAgents(r.Context(), tenantInfo.OrgID, project); err == nil {
			configured = c
		}
	}

	out := make([]agentResponse, 0, len(agents))
	for _, a := range agents {
		ar := agentResponse{AgentRow: a, DisplayName: a.AgentID, Configured: configured[a.AgentID]}
		if m, ok := meta[a.AgentID]; ok {
			ar.Framework = m.Framework
			if m.Name != "" {
				ar.DisplayName = m.Name
			}
		}
		out = append(out, ar)
	}

	writeJSON(w, map[string]interface{}{"agents": out, "total": len(out)})
}

// ListPlatforms returns per-platform orchestration aggregates for the Agent
// Platforms home. This is the platform-domain analog of ListAgents — it reads
// only platform (orchestrator) runs (traces.platform <> '').
func (q *QueryHandler) ListPlatforms(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	t := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	windowSec := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("window")); err == nil && v > 0 && v <= 90*86400 {
		windowSec = v
	}
	platforms, err := q.store.QueryPlatforms(r.Context(), t.OrgID, effectiveProject(r, t), windowSec)
	if err != nil {
		q.logger.Error("query platforms failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"platforms": platforms, "total": len(platforms)})
}

// GetPlatform returns one platform's Workflow Operations data: its run-level
// aggregate (Overview StatCards) plus the per-workflow list (the workflow table).
// The node analytics / failure analysis views read /v1/metrics/spans?platform=.
func (q *QueryHandler) GetPlatform(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	t := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	project := effectiveProject(r, t)
	platform := chi.URLParam(r, "platform")
	if platform == "" {
		http.Error(w, `{"error":"platform required"}`, http.StatusBadRequest)
		return
	}
	windowSec := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("window")); err == nil && v > 0 && v <= 90*86400 {
		windowSec = v
	}

	// Overview row: filter the platform aggregates to this platform.
	all, err := q.store.QueryPlatforms(r.Context(), t.OrgID, project, windowSec)
	if err != nil {
		q.logger.Error("query platforms failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	var overview *store.PlatformRow
	for i := range all {
		if all[i].Platform == platform {
			overview = &all[i]
			break
		}
	}

	workflows, err := q.store.QueryWorkflows(r.Context(), t.OrgID, project, platform, windowSec)
	if err != nil {
		q.logger.Error("query workflows failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{
		"platform":  platform,
		"overview":  overview,
		"workflows": workflows,
	})
}

// agentSlug turns a display name into a stable lowercase agent id.
func agentSlug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		return "agent"
	}
	return s
}

// agentProfileBody is the Connect-wizard payload.
type agentProfileBody struct {
	AgentID       string   `json:"agent_id"`
	Name          string   `json:"name"`
	Frameworks    []string `json:"frameworks"`
	Providers     []string `json:"providers"`
	VectorDBs     []string `json:"vectordbs"`
	Databases     []string `json:"databases"`
	GuardMode     string   `json:"guard_mode"`
	Detectors     []string `json:"detectors"`
	AlertsEnabled bool     `json:"alerts_enabled"`
}

// CreateAgent persists an agent profile from the Connect wizard, mints an ingest
// key for it, optionally creates a risk-alert rule, and returns the key ONCE.
func (q *QueryHandler) CreateAgent(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	if q.pg == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	var b agentProfileBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&b); err != nil || b.Name == "" {
		http.Error(w, `{"error":"name is required"}`, http.StatusBadRequest)
		return
	}
	project := effectiveProject(r, t)
	agentID := b.AgentID
	if agentID == "" {
		agentID = agentSlug(b.Name)
	}

	// Mint an ingest key bound to this agent.
	plaintext, key, err := q.pg.CreateAPIKey(r.Context(), t.OrgID, project, b.Name+" (agent)", []string{"ingest"})
	if err != nil {
		q.logger.Error("agent key mint failed", zap.Error(err))
		http.Error(w, `{"error":"key mint failed"}`, http.StatusInternalServerError)
		return
	}

	// Optional risk-alert rule for this agent.
	alertID := ""
	if b.AlertsEnabled {
		cfg, _ := json.Marshal(map[string]any{"agent_id": agentID, "min_severity": "HIGH"})
		if id, err := q.pg.CreateAlert(r.Context(), &store.Alert{
			OrgID: t.OrgID, ProjectID: project, Name: b.Name + " — risk", Type: "risk",
			Config: cfg, Channels: []string{"email"},
		}); err == nil {
			alertID = id
		}
	}

	prof := &store.AgentProfile{
		AgentID: agentID, Name: b.Name, Frameworks: b.Frameworks, Providers: b.Providers,
		VectorDBs: b.VectorDBs, Databases: b.Databases, GuardMode: b.GuardMode,
		Detectors: b.Detectors, AlertsEnabled: b.AlertsEnabled,
	}
	if err := q.pg.CreateAgentProfile(r.Context(), t.OrgID, project, prof, key.ID, alertID); err != nil {
		q.logger.Error("create agent profile failed", zap.Error(err))
		http.Error(w, `{"error":"create failed"}`, http.StatusInternalServerError)
		return
	}
	// Register in the discovery table so it appears immediately.
	framework := ""
	if len(b.Frameworks) > 0 {
		framework = b.Frameworks[0]
	}
	q.pg.UpsertAgent(r.Context(), t.OrgID, project, agentID, framework)

	prof.APIKeyID = key.ID
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]interface{}{"agent_id": agentID, "api_key": plaintext, "profile": prof})
}

// GetAgentProfile returns an agent's stored Connect-wizard config.
func (q *QueryHandler) GetAgentProfile(w http.ResponseWriter, r *http.Request) {
	t := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if q.pg == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	p, err := q.pg.GetAgentProfile(r.Context(), t.OrgID, effectiveProject(r, t), chi.URLParam(r, "agentID"))
	if err != nil {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	writeJSON(w, p)
}

// UpdateAgentProfile edits an agent's config (key + alert are preserved).
func (q *QueryHandler) UpdateAgentProfile(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	var b agentProfileBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&b); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	agentID := chi.URLParam(r, "agentID")
	prof := &store.AgentProfile{
		AgentID: agentID, Name: b.Name, Frameworks: b.Frameworks, Providers: b.Providers,
		VectorDBs: b.VectorDBs, Databases: b.Databases, GuardMode: b.GuardMode,
		Detectors: b.Detectors, AlertsEnabled: b.AlertsEnabled,
	}
	// Upsert with empty key/alert ids — on conflict those columns are preserved.
	if err := q.pg.CreateAgentProfile(r.Context(), t.OrgID, effectiveProject(r, t), prof, "", ""); err != nil {
		http.Error(w, `{"error":"update failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"status": "ok"})
}

// DeleteAgentProfile removes an agent's config (its traces/data remain).
func (q *QueryHandler) DeleteAgentProfile(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	if err := q.pg.DeleteAgentProfile(r.Context(), t.OrgID, effectiveProject(r, t), chi.URLParam(r, "agentID")); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListCosts returns cost breakdown by model (and by project) for the org.
func (q *QueryHandler) ListCosts(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}

	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	project := effectiveProject(r, tenantInfo)
	source, platform := parseSource(r.URL.Query())

	costs, err := q.store.QueryCosts(r.Context(), tenantInfo.OrgID, project, r.URL.Query().Get("agent_id"), source, platform)
	if err != nil {
		q.logger.Error("query costs failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	summary, err := q.store.QueryCostSummary(r.Context(), tenantInfo.OrgID, project, source, platform)
	if err != nil {
		q.logger.Error("query cost summary failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	byProject, err := q.store.QueryCostByProject(r.Context(), tenantInfo.OrgID)
	if err != nil {
		q.logger.Error("query cost by project failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	byWorkflow, err := q.store.QueryCostByWorkflow(r.Context(), tenantInfo.OrgID, project, platform)
	if err != nil {
		q.logger.Error("query cost by workflow failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{
		"models":      costs,
		"summary":     summary,
		"by_project":  byProject,
		"by_workflow": byWorkflow,
	})
}

// ListMetrics returns time-series trace metrics for the dashboard Metrics view.
// Query params: window (seconds, default 86400), interval (seconds, default 300).
var validSpanTypes = map[string]bool{
	"agent": true, "llm_call": true, "tool_call": true, "step": true,
	"retrieval": true, "db": true, "vector_search": true,
}

// ListSpanMetrics groups spans by name or MCP server for the Tools & Retrieval
// and MCP Servers views (count / errors / flagged / latency).
func (q *QueryHandler) ListSpanMetrics(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	t := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	qp := r.URL.Query()
	typ := qp.Get("type")
	if typ != "" && !validSpanTypes[typ] {
		typ = ""
	}
	group := qp.Get("group")
	if group != "mcp_server" {
		group = "name"
	}
	since := 0
	if n, err := strconv.Atoi(qp.Get("since")); err == nil && n > 0 {
		since = n
	}
	source, platform := parseSource(qp)
	groups, err := q.store.QuerySpanMetrics(r.Context(), t.OrgID, effectiveProject(r, t), store.SpanMetricsFilter{
		Type: typ, Group: group, SinceSec: since, Server: qp.Get("server"), Source: source, Platform: platform,
	})
	if err != nil {
		q.logger.Error("query span metrics failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"groups": groups})
}

func (q *QueryHandler) ListMetrics(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)

	window := 86400
	if v := r.URL.Query().Get("window"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 30*86400 {
			window = n
		}
	}
	interval := 300
	if v := r.URL.Query().Get("interval"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 60 && n <= 86400 {
			interval = n
		}
	}
	// Bound the bucket count so a small interval over a large window can't force
	// a huge aggregation/response — raise the interval to keep points <= 5000.
	const maxBuckets = 5000
	if window/interval > maxBuckets {
		interval = (window + maxBuckets - 1) / maxBuckets
	}
	// offset shifts the window back for period-over-period comparison; capped to
	// 90d so it stays within retention.
	offset := 0
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && n > 0 && n <= 90*86400 {
		offset = n
	}

	source, platform := parseSource(r.URL.Query())
	filter := store.MetricsFilter{
		WindowSec:   window,
		IntervalSec: interval,
		OffsetSec:   offset,
		AgentID:     r.URL.Query().Get("agent_id"),
		Model:       r.URL.Query().Get("model"),
		Source:      source,
		Platform:    platform,
	}
	points, err := q.store.QueryMetricsTimeseries(r.Context(), tenantInfo.OrgID, effectiveProject(r, tenantInfo), filter)
	if err != nil {
		q.logger.Error("query metrics failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"points": points, "window": window, "interval": interval})
}

// ─── Projects ─────────────────────────────────────────────────────────────

// ListProjects returns the projects in the authenticated org.
func (q *QueryHandler) ListProjects(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if q.pg == nil {
		writeJSON(w, map[string]interface{}{"projects": []store.Project{}, "total": 0})
		return
	}
	projects, err := q.pg.ListProjects(r.Context(), tenantInfo.OrgID)
	if err != nil {
		q.logger.Error("list projects failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"projects": projects, "total": len(projects)})
}

// ─── Alerts ───────────────────────────────────────────────────────────────

// ListAlerts returns alert configs (and recent fired history) for the org.
func (q *QueryHandler) ListAlerts(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if q.pg == nil {
		writeJSON(w, map[string]interface{}{"alerts": []store.Alert{}, "events": []store.AlertEvent{}})
		return
	}
	project := effectiveProject(r, tenantInfo)
	alerts, err := q.pg.ListAlerts(r.Context(), tenantInfo.OrgID, project)
	if err != nil {
		q.logger.Error("list alerts failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	events, err := q.pg.ListAlertEvents(r.Context(), tenantInfo.OrgID, project, 50)
	if err != nil {
		q.logger.Error("list alert events failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"alerts": alerts, "events": events})
}

// CreateAlert creates an alert config for the org.
var validAlertTypes = map[string]bool{"risk_threshold": true, "cost_threshold": true, "spend_anomaly": true}
var validAlertChannels = map[string]bool{"email": true, "slack": true, "webhook": true}

// validAlertURL accepts an empty string (meaning: use the global fallback) or a
// well-formed http(s) URL. The private-IP/SSRF policy is enforced at delivery
// time by the notifier (which is env-configurable), not here.
func validAlertURL(raw string) bool {
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func validateChannels(chs []string) (string, bool) {
	if len(chs) == 0 {
		return "at least one channel is required", false
	}
	for _, c := range chs {
		if !validAlertChannels[c] {
			return "unknown channel: " + c, false
		}
	}
	return "", true
}

// alertConfigFields is the validated subset of an alert's config JSON.
type alertConfigFields struct {
	Threshold       *float64 `json:"threshold"`
	WindowDays      *int     `json:"window_days"`
	Factor          *float64 `json:"factor"`
	WebhookURL      string   `json:"webhook_url"`
	SlackWebhookURL string   `json:"slack_webhook_url"`
}

func parseAlertConfig(raw json.RawMessage) (alertConfigFields, bool) {
	var c alertConfigFields
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &c); err != nil {
			return c, false
		}
	}
	return c, true
}

// validateAlertConfig enforces threshold bounds for the alert type and URL
// formats. requireThreshold is true on create (threshold is mandatory).
func validateAlertConfig(raw json.RawMessage, alertType string, requireThreshold bool) (string, bool) {
	c, ok := parseAlertConfig(raw)
	if !ok {
		return "invalid config json", false
	}
	if alertType == "spend_anomaly" {
		// Uses window_days + factor, not a threshold.
		if c.WindowDays != nil && *c.WindowDays < 1 {
			return "window_days must be >= 1", false
		}
		if c.Factor != nil && *c.Factor <= 1 {
			return "factor must be greater than 1", false
		}
		if !validAlertURL(c.WebhookURL) || !validAlertURL(c.SlackWebhookURL) {
			return "webhook/slack url must be a valid http(s) URL", false
		}
		return "", true
	}
	if c.Threshold == nil {
		if requireThreshold {
			return "config.threshold is required", false
		}
	} else {
		switch alertType {
		case "risk_threshold":
			if *c.Threshold < 1 || *c.Threshold > 100 {
				return "risk threshold must be between 1 and 100", false
			}
		default: // cost_threshold or unknown-on-update
			if *c.Threshold <= 0 {
				return "threshold must be greater than 0", false
			}
		}
	}
	if !validAlertURL(c.WebhookURL) {
		return "webhook_url must be a valid http(s) URL", false
	}
	if !validAlertURL(c.SlackWebhookURL) {
		return "slack_webhook_url must be a valid http(s) URL", false
	}
	return "", true
}

func (q *QueryHandler) CreateAlert(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if q.pg == nil {
		http.Error(w, `{"error":"metadata store not available"}`, http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Name      string          `json:"name"`
		Type      string          `json:"type"`
		ProjectID string          `json:"project_id"`
		Config    json.RawMessage `json:"config"`
		Channels  []string        `json:"channels"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		http.Error(w, `{"error":"name is required"}`, http.StatusBadRequest)
		return
	}
	if !validAlertTypes[body.Type] {
		http.Error(w, `{"error":"type must be risk_threshold or cost_threshold"}`, http.StatusBadRequest)
		return
	}
	if msg, ok := validateChannels(body.Channels); !ok {
		http.Error(w, `{"error":"`+jsonEscape(msg)+`"}`, http.StatusBadRequest)
		return
	}
	if msg, ok := validateAlertConfig(body.Config, body.Type, true); !ok {
		http.Error(w, `{"error":"`+jsonEscape(msg)+`"}`, http.StatusBadRequest)
		return
	}
	id, err := q.pg.CreateAlert(r.Context(), &store.Alert{
		OrgID:     tenantInfo.OrgID,
		ProjectID: body.ProjectID,
		Name:      body.Name,
		Type:      body.Type,
		Config:    body.Config,
		Channels:  body.Channels,
	})
	if err != nil {
		q.logger.Error("create alert failed", zap.Error(err))
		http.Error(w, `{"error":"create failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]interface{}{"id": id})
}

// DeleteAlert removes an alert config scoped to the org.
func (q *QueryHandler) DeleteAlert(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if q.pg == nil {
		http.Error(w, `{"error":"metadata store not available"}`, http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "alertID")
	if id == "" {
		http.Error(w, `{"error":"alert_id required"}`, http.StatusBadRequest)
		return
	}
	if err := q.pg.DeleteAlert(r.Context(), tenantInfo.OrgID, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		q.logger.Error("delete alert failed", zap.Error(err))
		http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UpdateAlert applies a partial update to an alert (name, config, channels, or
// active state), scoped to the org. Powers both editing a rule and pausing it.
func (q *QueryHandler) UpdateAlert(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if q.pg == nil {
		http.Error(w, `{"error":"metadata store not available"}`, http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "alertID")
	if id == "" {
		http.Error(w, `{"error":"alert_id required"}`, http.StatusBadRequest)
		return
	}
	var body struct {
		Name     *string         `json:"name"`
		Type     string          `json:"type"` // used only to bound config validation; not persisted
		Config   json.RawMessage `json:"config"`
		Channels *[]string       `json:"channels"`
		IsActive *bool           `json:"is_active"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	var name *string
	if body.Name != nil {
		trimmed := strings.TrimSpace(*body.Name)
		if trimmed == "" {
			http.Error(w, `{"error":"name cannot be empty"}`, http.StatusBadRequest)
			return
		}
		name = &trimmed
	}
	if body.Channels != nil {
		if msg, ok := validateChannels(*body.Channels); !ok {
			http.Error(w, `{"error":"`+jsonEscape(msg)+`"}`, http.StatusBadRequest)
			return
		}
	}
	if len(body.Config) > 0 {
		if msg, ok := validateAlertConfig(body.Config, body.Type, false); !ok {
			http.Error(w, `{"error":"`+jsonEscape(msg)+`"}`, http.StatusBadRequest)
			return
		}
	}

	err := q.pg.UpdateAlert(r.Context(), tenantInfo.OrgID, id, store.AlertUpdate{
		Name:     name,
		Config:   body.Config,
		Channels: body.Channels,
		IsActive: body.IsActive,
	})
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		q.logger.Error("update alert failed", zap.Error(err))
		http.Error(w, `{"error":"update failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Provisioning: projects + API keys ──────────────────────────────────────

// requireAdmin extracts the tenant and enforces the "admin" key scope, which
// gates provisioning (project + API-key management). Returns false (after
// writing the response) when not permitted or the metadata store is absent.
func (q *QueryHandler) requireAdmin(w http.ResponseWriter, r *http.Request) (*auth.TenantInfo, bool) {
	t, _ := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if t == nil || !t.HasScope("admin") {
		http.Error(w, `{"error":"admin scope required"}`, http.StatusForbidden)
		return nil, false
	}
	if q.pg == nil {
		http.Error(w, `{"error":"metadata store not available"}`, http.StatusServiceUnavailable)
		return nil, false
	}
	return t, true
}

// CreateProject provisions a project in the authenticated org.
func (q *QueryHandler) CreateProject(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		Environment string `json:"environment"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	if body.Name == "" && body.Slug == "" {
		http.Error(w, `{"error":"name or slug required"}`, http.StatusBadRequest)
		return
	}
	// Plan/usage enforcement (allow-all in OSS; the commercial build enforces the
	// plan's project limit). Returns 402 Payment Required when the cap is hit.
	if ok, reason := extension.Quota().Allow(r.Context(), t.OrgID, "project.create"); !ok {
		http.Error(w, `{"error":"`+jsonEscape(reason)+`"}`, http.StatusPaymentRequired)
		return
	}
	p, err := q.pg.CreateProject(r.Context(), t.OrgID, body.Name, body.Slug, body.Environment)
	if err != nil {
		q.logger.Error("create project failed", zap.Error(err))
		http.Error(w, `{"error":"create failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, p)
}

// UpdateProject renames and/or archives a project (admin scope). Both fields are
// optional so the same endpoint powers a rename, an archive, and an unarchive.
func (q *QueryHandler) UpdateProject(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "projectID")
	if id == "" {
		http.Error(w, `{"error":"project_id required"}`, http.StatusBadRequest)
		return
	}
	var body struct {
		Name     *string `json:"name"`
		Archived *bool   `json:"archived"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		if name == "" {
			http.Error(w, `{"error":"name cannot be empty"}`, http.StatusBadRequest)
			return
		}
		if err := q.pg.RenameProject(r.Context(), t.OrgID, id, name); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
				return
			}
			q.logger.Error("rename project failed", zap.Error(err))
			http.Error(w, `{"error":"update failed"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.Archived != nil {
		if err := q.pg.SetProjectArchived(r.Context(), t.OrgID, id, *body.Archived); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
				return
			}
			q.logger.Error("archive project failed", zap.Error(err))
			http.Error(w, `{"error":"update failed"}`, http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteProject hard-deletes a project and purges its trace data. Postgres FK
// cascades clear agents/alerts/keys; ClickHouse rows are purged best-effort
// (async mutations) — a partial purge is logged, not surfaced as an error, since
// the project is already gone from Postgres and thus unreachable.
func (q *QueryHandler) DeleteProject(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "projectID")
	if id == "" {
		http.Error(w, `{"error":"project_id required"}`, http.StatusBadRequest)
		return
	}
	if err := q.pg.DeleteProject(r.Context(), t.OrgID, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		q.logger.Error("delete project failed", zap.Error(err))
		http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
		return
	}
	if q.store != nil {
		if err := q.store.DeleteProjectData(r.Context(), t.OrgID, id); err != nil {
			q.logger.Warn("clickhouse project purge partial", zap.String("project", id), zap.Error(err))
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListKeys returns API-key metadata for the org (never the secret).
func (q *QueryHandler) ListKeys(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	keys, err := q.pg.ListAPIKeys(r.Context(), t.OrgID)
	if err != nil {
		q.logger.Error("list keys failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"keys": keys})
}

// CreateKey issues a new API key and returns the plaintext exactly once.
func (q *QueryHandler) CreateKey(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		Name      string   `json:"name"`
		ProjectID string   `json:"project_id"`
		Scopes    []string `json:"scopes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	plaintext, key, err := q.pg.CreateAPIKey(r.Context(), t.OrgID, body.ProjectID, body.Name, body.Scopes)
	if err != nil {
		q.logger.Error("create key failed", zap.Error(err))
		http.Error(w, `{"error":"create failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	// `key` is the plaintext — shown once and never retrievable again.
	writeJSON(w, map[string]interface{}{"key": plaintext, "meta": key})
}

// RevokeKey deactivates an API key scoped to the org.
func (q *QueryHandler) RevokeKey(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "keyID")
	if err := q.pg.RevokeAPIKey(r.Context(), t.OrgID, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"revoke failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RotateKey replaces a key's secret in place and returns the new plaintext once.
func (q *QueryHandler) RotateKey(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "keyID")
	plaintext, err := q.pg.RotateAPIKey(r.Context(), t.OrgID, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"rotate failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"key": plaintext})
}

// ─── Pricing admin (model_prices) ───────────────────────────────────────────

// ListPricing returns the model price table plus any models seen at ingest that
// are unpriced (cost recorded as $0) so operators can fix understated spend.
func (q *QueryHandler) ListPricing(w http.ResponseWriter, r *http.Request) {
	if _, ok := q.requireAdmin(w, r); !ok {
		return
	}
	prices, err := q.pg.ListModelPrices(r.Context())
	if err != nil {
		q.logger.Error("list pricing failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"prices": prices, "unpriced": store.UnpricedModels()})
}

// UpsertPricing inserts/updates a model's price and hot-reloads the collector's
// in-memory table so it takes effect immediately (admin scope).
func (q *QueryHandler) UpsertPricing(w http.ResponseWriter, r *http.Request) {
	if _, ok := q.requireAdmin(w, r); !ok {
		return
	}
	var body struct {
		Model           string  `json:"model"`
		PromptPer1K     float64 `json:"prompt_per_1k"`
		CompletionPer1K float64 `json:"completion_per_1k"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	body.Model = strings.TrimSpace(body.Model)
	if body.Model == "" {
		http.Error(w, `{"error":"model is required"}`, http.StatusBadRequest)
		return
	}
	if body.PromptPer1K < 0 || body.CompletionPer1K < 0 {
		http.Error(w, `{"error":"prices must be >= 0"}`, http.StatusBadRequest)
		return
	}
	if err := q.pg.UpsertModelPrice(r.Context(), body.Model, body.PromptPer1K, body.CompletionPer1K); err != nil {
		q.logger.Error("upsert pricing failed", zap.Error(err))
		http.Error(w, `{"error":"update failed"}`, http.StatusInternalServerError)
		return
	}
	q.reloadPrices(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

// DeletePricing removes a model from the price table (admin scope).
func (q *QueryHandler) DeletePricing(w http.ResponseWriter, r *http.Request) {
	if _, ok := q.requireAdmin(w, r); !ok {
		return
	}
	model := chi.URLParam(r, "model")
	if err := q.pg.DeleteModelPrice(r.Context(), model); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		q.logger.Error("delete pricing failed", zap.Error(err))
		http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
		return
	}
	q.reloadPrices(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

// reloadPrices refreshes the collector's in-memory price table from Postgres.
func (q *QueryHandler) reloadPrices(ctx context.Context) {
	if q.pg == nil {
		return
	}
	if prices, err := q.pg.LoadModelPrices(ctx); err == nil {
		store.SetModelPrices(prices)
	}
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

type budgetView struct {
	store.Budget
	SpentUSD    float64 `json:"spent_usd"`
	ForecastUSD float64 `json:"forecast_usd"`
	PctUsed     float64 `json:"pct_used"`
}

// ListBudgets returns each budget with month-to-date spend, a linear month-end
// forecast, and percent consumed.
func (q *QueryHandler) ListBudgets(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	if q.pg == nil {
		writeJSON(w, map[string]interface{}{"budgets": []budgetView{}})
		return
	}
	budgets, err := q.pg.ListBudgets(r.Context(), tenantInfo.OrgID)
	if err != nil {
		q.logger.Error("list budgets failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	now := time.Now().UTC()
	day := now.Day()
	daysInMonth := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	daysRemaining := daysInMonth - day // whole days left after today

	views := make([]budgetView, 0, len(budgets))
	for _, b := range budgets {
		var spent, burn float64
		if q.store != nil {
			spent, _ = q.store.MonthToDateCostUSD(r.Context(), tenantInfo.OrgID, b.ProjectID)
			// Trailing-7d average daily burn → smoother than the naive
			// spent/dayOfMonth pace (which over-reacts in the first days of a month).
			burn, _ = q.store.TrailingDailyBurnUSD(r.Context(), tenantInfo.OrgID, b.ProjectID, 7)
		}
		// Forecast = spend so far + projected spend for the remaining days at the
		// trailing burn rate. Fall back to the linear pace if there's no burn history.
		forecast := spent + burn*float64(daysRemaining)
		if burn <= 0 && day > 0 {
			forecast = spent / float64(day) * float64(daysInMonth)
		}
		pct := 0.0
		if b.MonthlyLimitUSD > 0 {
			pct = spent / b.MonthlyLimitUSD * 100
		}
		views = append(views, budgetView{Budget: b, SpentUSD: spent, ForecastUSD: forecast, PctUsed: pct})
	}
	writeJSON(w, map[string]interface{}{"budgets": views})
}

// UpsertBudget sets a project's (or org-wide) monthly budget (admin scope).
func (q *QueryHandler) UpsertBudget(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		ProjectID       string  `json:"project_id"`
		MonthlyLimitUSD float64 `json:"monthly_limit_usd"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	if body.MonthlyLimitUSD <= 0 {
		http.Error(w, `{"error":"monthly_limit_usd must be > 0"}`, http.StatusBadRequest)
		return
	}
	var projectID *string
	if body.ProjectID != "" {
		projectID = &body.ProjectID
	}
	if err := q.pg.UpsertBudget(r.Context(), t.OrgID, projectID, body.MonthlyLimitUSD); err != nil {
		q.logger.Error("upsert budget failed", zap.Error(err))
		http.Error(w, `{"error":"update failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteBudget removes a budget (admin scope).
func (q *QueryHandler) DeleteBudget(w http.ResponseWriter, r *http.Request) {
	t, ok := q.requireAdmin(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "budgetID")
	if err := q.pg.DeleteBudget(r.Context(), t.OrgID, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		q.logger.Error("delete budget failed", zap.Error(err))
		http.Error(w, `{"error":"delete failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
