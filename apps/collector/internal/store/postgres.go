// SPDX-License-Identifier: AGPL-3.0-only
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/lib/pq"
	"go.uber.org/zap"
)

// PostgresStore holds the relational metadata: projects, agents, and alerts.
// ClickHouse holds the high-volume trace/span/detection data; this store holds
// the low-volume configuration and registry rows the dashboard manages.
type PostgresStore struct {
	db     *sql.DB
	logger *zap.Logger
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// NewPostgresStore opens a pooled connection to Postgres. A nil store (with nil
// error) is returned when no DSN is configured so the collector can run in a
// degraded, storage-optional mode — callers must nil-check.
func NewPostgresStore(dsn string, logger *zap.Logger) (*PostgresStore, error) {
	if dsn == "" {
		return nil, nil
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	logger.Info("Postgres metadata store connected")
	return &PostgresStore{db: db, logger: logger}, nil
}

// Close releases the connection pool.
func (s *PostgresStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// Ping checks connectivity.
func (s *PostgresStore) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

// ─── Agents ───────────────────────────────────────────────────────────────

// UpsertAgent records (or refreshes) an agent the collector has seen on the
// ingest path. It is best-effort: failures are logged and swallowed so a
// metadata hiccup never blocks trace ingestion. org/project must be UUIDs.
func (s *PostgresStore) UpsertAgent(ctx context.Context, orgID, projectID, agentID, framework string) {
	if s == nil || s.db == nil {
		return
	}
	if !uuidRe.MatchString(orgID) || !uuidRe.MatchString(projectID) || agentID == "" {
		return
	}
	var fw any
	if framework != "" {
		fw = framework
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO agents (org_id, project_id, agent_id, name, framework)
		VALUES ($1, $2, $3, $3, $4)
		ON CONFLICT (org_id, project_id, agent_id) DO UPDATE
		SET last_seen_at = NOW(),
		    framework = COALESCE(EXCLUDED.framework, agents.framework)
	`, orgID, projectID, agentID, fw)
	if err != nil {
		s.logger.Debug("upsert agent failed", zap.Error(err), zap.String("agent_id", agentID))
	}
}

// AgentMeta is the registry metadata for an agent (framework, first seen).
type AgentMeta struct {
	AgentID     string    `json:"agent_id"`
	Name        string    `json:"name"`
	Framework   string    `json:"framework"`
	FirstSeenAt time.Time `json:"first_seen_at"`
}

// AgentMetaByID returns framework/first-seen metadata for the project's agents,
// keyed by agent_id, for enriching the ClickHouse-derived agent stats.
func (s *PostgresStore) AgentMetaByID(ctx context.Context, orgID, projectID string) (map[string]AgentMeta, error) {
	out := map[string]AgentMeta{}
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return out, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT agent_id, name, COALESCE(framework, ''), first_seen_at
		FROM agents WHERE org_id = $1 AND project_id = $2
	`, orgID, projectID)
	if err != nil {
		return out, fmt.Errorf("query agent meta: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var m AgentMeta
		if err := rows.Scan(&m.AgentID, &m.Name, &m.Framework, &m.FirstSeenAt); err != nil {
			return out, fmt.Errorf("scan agent meta: %w", err)
		}
		out[m.AgentID] = m
	}
	return out, rows.Err()
}

// ─── Projects ─────────────────────────────────────────────────────────────

// Project is a project row scoped to an organization.
type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Environment string    `json:"environment"`
	CreatedAt   time.Time `json:"created_at"`
}

// ListProjects returns all projects for an organization.
func (s *PostgresStore) ListProjects(ctx context.Context, orgID string) ([]Project, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return []Project{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, name, slug, environment, created_at
		FROM projects WHERE org_id = $1 ORDER BY created_at ASC
	`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.Environment, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateProject inserts a project scoped to an org and returns the new row.
// The slug is derived from the name when not supplied; environment defaults to
// "development". Honors the (org_id, slug, environment) uniqueness constraint.
func (s *PostgresStore) CreateProject(ctx context.Context, orgID, name, slug, environment string) (Project, error) {
	if s == nil || s.db == nil {
		return Project{}, fmt.Errorf("metadata store unavailable")
	}
	if !uuidRe.MatchString(orgID) {
		return Project{}, fmt.Errorf("invalid org id")
	}
	if slug == "" {
		slug = slugify(name)
	}
	if slug == "" {
		return Project{}, fmt.Errorf("name or slug required")
	}
	if environment == "" {
		environment = "development"
	}
	p := Project{Name: name, Slug: slug, Environment: environment}
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO projects (org_id, name, slug, environment)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, created_at
	`, orgID, name, slug, environment).Scan(&p.ID, &p.CreatedAt)
	if err != nil {
		return Project{}, fmt.Errorf("create project: %w", err)
	}
	return p, nil
}

// ─── API keys ─────────────────────────────────────────────────────────────

// APIKey is the non-secret metadata for an issued key (the plaintext is shown
// once at creation and never stored — only its SHA-256 hash is persisted).
type APIKey struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	ProjectID  string     `json:"project_id"`
	Prefix     string     `json:"key_prefix"`
	Scopes     []string   `json:"scopes"`
	IsActive   bool       `json:"is_active"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// newKeyMaterial mints a key: the plaintext (returned once), its display prefix
// (first 12 chars), and its SHA-256 hash (the only thing stored).
func newKeyMaterial() (plaintext, prefix, keyHash string, err error) {
	b := make([]byte, 24)
	if _, err = rand.Read(b); err != nil {
		return "", "", "", fmt.Errorf("generate key: %w", err)
	}
	plaintext = "splyntra_" + hex.EncodeToString(b)
	prefix = plaintext[:12]
	sum := sha256.Sum256([]byte(plaintext))
	return plaintext, prefix, hex.EncodeToString(sum[:]), nil
}

// ListAPIKeys returns key metadata for an org (never the secret).
func (s *PostgresStore) ListAPIKeys(ctx context.Context, orgID string) ([]APIKey, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return []APIKey{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, name, COALESCE(project_id::text,''), key_prefix, scopes, is_active, last_used_at, created_at
		FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC
	`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list api keys: %w", err)
	}
	defer rows.Close()
	var out []APIKey
	for rows.Next() {
		var k APIKey
		var scopes pq.StringArray
		if err := rows.Scan(&k.ID, &k.Name, &k.ProjectID, &k.Prefix, &scopes, &k.IsActive, &k.LastUsedAt, &k.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan api key: %w", err)
		}
		k.Scopes = scopes
		out = append(out, k)
	}
	return out, rows.Err()
}

// CreateAPIKey issues a new key for the org/project and returns the plaintext
// ONCE alongside its stored metadata. scopes defaults to {"ingest","read"}.
func (s *PostgresStore) CreateAPIKey(ctx context.Context, orgID, projectID, name string, scopes []string) (string, APIKey, error) {
	if s == nil || s.db == nil {
		return "", APIKey{}, fmt.Errorf("metadata store unavailable")
	}
	if !uuidRe.MatchString(orgID) {
		return "", APIKey{}, fmt.Errorf("invalid org id")
	}
	if len(scopes) == 0 {
		scopes = []string{"ingest", "read"}
	}
	if name == "" {
		name = "API Key"
	}
	plaintext, prefix, keyHash, err := newKeyMaterial()
	if err != nil {
		return "", APIKey{}, err
	}
	var pid any
	if uuidRe.MatchString(projectID) {
		pid = projectID
	}
	k := APIKey{Name: name, ProjectID: projectID, Prefix: prefix, Scopes: scopes, IsActive: true}
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO api_keys (org_id, project_id, name, key_hash, key_prefix, scopes)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id::text, created_at
	`, orgID, pid, name, keyHash, prefix, pq.StringArray(scopes)).Scan(&k.ID, &k.CreatedAt)
	if err != nil {
		return "", APIKey{}, fmt.Errorf("create api key: %w", err)
	}
	return plaintext, k, nil
}

// RevokeAPIKey deactivates a key, scoped to the org for tenant isolation.
func (s *PostgresStore) RevokeAPIKey(ctx context.Context, orgID, keyID string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND org_id = $2`, keyID, orgID)
	if err != nil {
		return fmt.Errorf("revoke api key: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// RotateAPIKey replaces a key's secret in place (same id/name/project/scopes)
// and returns the new plaintext once. Reactivates the key.
func (s *PostgresStore) RotateAPIKey(ctx context.Context, orgID, keyID string) (string, error) {
	if s == nil || s.db == nil {
		return "", fmt.Errorf("metadata store unavailable")
	}
	plaintext, prefix, keyHash, err := newKeyMaterial()
	if err != nil {
		return "", err
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE api_keys SET key_hash = $1, key_prefix = $2, is_active = TRUE, last_used_at = NULL
		WHERE id = $3 AND org_id = $4
	`, keyHash, prefix, keyID, orgID)
	if err != nil {
		return "", fmt.Errorf("rotate api key: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", sql.ErrNoRows
	}
	return plaintext, nil
}

// slugify produces a URL-safe slug from a display name.
func slugify(name string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// ─── Alerts ───────────────────────────────────────────────────────────────

// Alert is an alert configuration row.
type Alert struct {
	ID        string          `json:"id"`
	OrgID     string          `json:"org_id"`
	ProjectID string          `json:"project_id"`
	Name      string          `json:"name"`
	Type      string          `json:"type"`
	Config    json.RawMessage `json:"config"`
	Channels  []string        `json:"channels"`
	IsActive  bool            `json:"is_active"`
	CreatedAt time.Time       `json:"created_at"`
}

// ListAlerts returns alert configs for an org (optionally a single project).
func (s *PostgresStore) ListAlerts(ctx context.Context, orgID, projectID string) ([]Alert, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return []Alert{}, nil
	}
	q := `SELECT id::text, org_id::text, COALESCE(project_id::text,''), name, type, config, channels, is_active, created_at
	      FROM alerts WHERE org_id = $1`
	args := []any{orgID}
	if uuidRe.MatchString(projectID) {
		q += ` AND (project_id = $2 OR project_id IS NULL)`
		args = append(args, projectID)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list alerts: %w", err)
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		var a Alert
		var channels pq.StringArray
		if err := rows.Scan(&a.ID, &a.OrgID, &a.ProjectID, &a.Name, &a.Type, &a.Config, &channels, &a.IsActive, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan alert: %w", err)
		}
		a.Channels = channels
		out = append(out, a)
	}
	return out, rows.Err()
}

// CreateAlert inserts a new alert config and returns its generated id.
func (s *PostgresStore) CreateAlert(ctx context.Context, a *Alert) (string, error) {
	if s == nil || s.db == nil {
		return "", fmt.Errorf("metadata store unavailable")
	}
	var projectID any
	if uuidRe.MatchString(a.ProjectID) {
		projectID = a.ProjectID
	}
	channels := a.Channels
	if len(channels) == 0 {
		channels = []string{"email"}
	}
	cfg := a.Config
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	var id string
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO alerts (org_id, project_id, name, type, config, channels, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, TRUE)
		RETURNING id::text
	`, a.OrgID, projectID, a.Name, a.Type, []byte(cfg), pq.StringArray(channels)).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create alert: %w", err)
	}
	return id, nil
}

// DeleteAlert removes an alert config, scoped to the org for tenant isolation.
func (s *PostgresStore) DeleteAlert(ctx context.Context, orgID, alertID string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM alerts WHERE id = $1 AND org_id = $2`, alertID, orgID)
	if err != nil {
		return fmt.Errorf("delete alert: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// RiskAlert is a risk_threshold alert reduced to what evaluation needs.
type RiskAlert struct {
	ID        string
	OrgID     string
	ProjectID string
	Name      string
	Threshold int
	Channels  []string
}

// ActiveRiskAlerts returns active risk_threshold alerts applicable to a project
// (project-specific or org-wide). Used by the detection consumer to evaluate
// each scored trace.
func (s *PostgresStore) ActiveRiskAlerts(ctx context.Context, orgID, projectID string) ([]RiskAlert, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, COALESCE(project_id::text,''), name,
		       COALESCE((config->>'threshold')::int, 50), channels
		FROM alerts
		WHERE org_id = $1 AND is_active = TRUE AND type = 'risk_threshold'
		  AND (project_id IS NULL OR project_id = $2)
	`, orgID, nullableUUID(projectID))
	if err != nil {
		return nil, fmt.Errorf("active risk alerts: %w", err)
	}
	defer rows.Close()
	var out []RiskAlert
	for rows.Next() {
		var a RiskAlert
		var channels pq.StringArray
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.Name, &a.Threshold, &channels); err != nil {
			return nil, fmt.Errorf("scan risk alert: %w", err)
		}
		a.OrgID = orgID
		a.Channels = channels
		out = append(out, a)
	}
	return out, rows.Err()
}

// CostAlert is an active cost_threshold alert reduced to what evaluation needs.
type CostAlert struct {
	ID        string
	OrgID     string
	ProjectID string
	Name      string
	Threshold float64
	WindowSec int
	Channels  []string
}

// AllActiveCostAlerts returns every active cost_threshold alert across tenants,
// for the periodic spend evaluator. config: {"threshold": <usd>, "window_sec": <s>}.
func (s *PostgresStore) AllActiveCostAlerts(ctx context.Context) ([]CostAlert, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, org_id::text, COALESCE(project_id::text,''), name,
		       COALESCE((config->>'threshold')::float8, 0),
		       COALESCE((config->>'window_sec')::int, 86400), channels
		FROM alerts
		WHERE is_active = TRUE AND type = 'cost_threshold'`)
	if err != nil {
		return nil, fmt.Errorf("all cost alerts: %w", err)
	}
	defer rows.Close()
	var out []CostAlert
	for rows.Next() {
		var a CostAlert
		var channels pq.StringArray
		if err := rows.Scan(&a.ID, &a.OrgID, &a.ProjectID, &a.Name, &a.Threshold, &a.WindowSec, &channels); err != nil {
			return nil, fmt.Errorf("scan cost alert: %w", err)
		}
		a.Channels = channels
		out = append(out, a)
	}
	return out, rows.Err()
}

// AlertFiredSince reports whether an alert has a recorded event since `since`
// (used to avoid re-firing a cost alert every evaluation tick within a window).
func (s *PostgresStore) AlertFiredSince(ctx context.Context, alertID string, since time.Time) (bool, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(alertID) {
		return false, nil
	}
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM alert_events WHERE alert_id = $1 AND fired_at >= $2`, alertID, since).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("alert fired since: %w", err)
	}
	return n > 0, nil
}

// AlertEvent is a fired-alert history record.
type AlertEvent struct {
	ID        string    `json:"id"`
	AlertID   string    `json:"alert_id"`
	AlertName string    `json:"alert_name"`
	TraceID   string    `json:"trace_id"`
	RiskScore int       `json:"risk_score"`
	Severity  string    `json:"severity"`
	FiredAt   time.Time `json:"fired_at"`
}

// RecordAlertEvent appends to the alert history.
func (s *PostgresStore) RecordAlertEvent(ctx context.Context, orgID, projectID, alertID, alertName, traceID, severity string, riskScore int) error {
	if s == nil || s.db == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO alert_events (org_id, project_id, alert_id, alert_name, trace_id, risk_score, severity)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, orgID, nullableUUID(projectID), alertID, alertName, traceID, riskScore, severity)
	if err != nil {
		return fmt.Errorf("record alert event: %w", err)
	}
	return nil
}

// ListAlertEvents returns recent fired-alert history for an org/project.
func (s *PostgresStore) ListAlertEvents(ctx context.Context, orgID, projectID string, limit int) ([]AlertEvent, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return []AlertEvent{}, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT id::text, alert_id::text, alert_name, trace_id, risk_score, severity, fired_at
	      FROM alert_events WHERE org_id = $1`
	args := []any{orgID}
	if uuidRe.MatchString(projectID) {
		q += ` AND project_id = $2`
		args = append(args, projectID)
	}
	q += fmt.Sprintf(` ORDER BY fired_at DESC LIMIT %d`, limit)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list alert events: %w", err)
	}
	defer rows.Close()
	var out []AlertEvent
	for rows.Next() {
		var e AlertEvent
		if err := rows.Scan(&e.ID, &e.AlertID, &e.AlertName, &e.TraceID, &e.RiskScore, &e.Severity, &e.FiredAt); err != nil {
			return nil, fmt.Errorf("scan alert event: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func nullableUUID(s string) any {
	if uuidRe.MatchString(s) {
		return s
	}
	return nil
}
