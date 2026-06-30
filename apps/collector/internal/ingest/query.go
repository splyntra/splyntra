// SPDX-License-Identifier: AGPL-3.0-only
package ingest

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

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

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	traces, err := q.store.QueryTraces(r.Context(), tenantInfo.OrgID, effectiveProject(r, tenantInfo), limit)
	if err != nil {
		q.logger.Error("query traces failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{"traces": traces, "total": len(traces)})
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

	writeJSON(w, map[string]interface{}{
		"trace_id":   traceID,
		"spans":      spans,
		"detections": detections,
	})
}

// agentResponse is an agent stat row enriched with registry metadata.
type agentResponse struct {
	store.AgentRow
	Framework   string `json:"framework"`
	DisplayName string `json:"name"`
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

	agents, err := q.store.QueryAgents(r.Context(), tenantInfo.OrgID, project)
	if err != nil {
		q.logger.Error("query agents failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	meta := map[string]store.AgentMeta{}
	if q.pg != nil {
		if m, err := q.pg.AgentMetaByID(r.Context(), tenantInfo.OrgID, project); err == nil {
			meta = m
		}
	}

	out := make([]agentResponse, 0, len(agents))
	for _, a := range agents {
		ar := agentResponse{AgentRow: a, DisplayName: a.AgentID}
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

// ListCosts returns cost breakdown by model (and by project) for the org.
func (q *QueryHandler) ListCosts(w http.ResponseWriter, r *http.Request) {
	if q.store == nil {
		http.Error(w, `{"error":"storage not available"}`, http.StatusServiceUnavailable)
		return
	}

	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	project := effectiveProject(r, tenantInfo)

	costs, err := q.store.QueryCosts(r.Context(), tenantInfo.OrgID, project)
	if err != nil {
		q.logger.Error("query costs failed", zap.Error(err))
		http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}

	summary, err := q.store.QueryCostSummary(r.Context(), tenantInfo.OrgID, project)
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

	writeJSON(w, map[string]interface{}{
		"models":     costs,
		"summary":    summary,
		"by_project": byProject,
	})
}

// ListMetrics returns time-series trace metrics for the dashboard Metrics view.
// Query params: window (seconds, default 86400), interval (seconds, default 300).
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

	points, err := q.store.QueryMetricsTimeseries(r.Context(), tenantInfo.OrgID, effectiveProject(r, tenantInfo), window, interval)
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
	if body.Name == "" || body.Type == "" {
		http.Error(w, `{"error":"name and type are required"}`, http.StatusBadRequest)
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
