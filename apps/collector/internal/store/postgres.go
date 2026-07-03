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

// ─── Agent profiles (Connect wizard config) ─────────────────────────────────

// AgentProfile is the persisted configuration of an explicitly-connected agent.
type AgentProfile struct {
	AgentID       string    `json:"agent_id"`
	Name          string    `json:"name"`
	Frameworks    []string  `json:"frameworks"`
	Providers     []string  `json:"providers"`
	VectorDBs     []string  `json:"vectordbs"`
	Databases     []string  `json:"databases"`
	GuardMode     string    `json:"guard_mode"`
	Detectors     []string  `json:"detectors"`
	AlertsEnabled bool      `json:"alerts_enabled"`
	APIKeyID      string    `json:"api_key_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// scanStr coerces a nil slice to a non-nil empty array so it stores as '{}'
// (the columns are NOT NULL DEFAULT '{}'), not SQL NULL.
func scanStr(a []string) pq.StringArray {
	if a == nil {
		return pq.StringArray{}
	}
	return pq.StringArray(a)
}

// CreateAgentProfile inserts (or replaces) an agent's config; apiKeyID/alertID
// link the minted ingest key + alert rule. Upsert on (org, project, agent_id).
func (s *PostgresStore) CreateAgentProfile(ctx context.Context, orgID, projectID string, p *AgentProfile, apiKeyID, alertID string) error {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return fmt.Errorf("metadata store unavailable")
	}
	var pid, keyID, alrtID any
	if uuidRe.MatchString(projectID) {
		pid = projectID
	}
	if uuidRe.MatchString(apiKeyID) {
		keyID = apiKeyID
	}
	if uuidRe.MatchString(alertID) {
		alrtID = alertID
	}
	guard := p.GuardMode
	if guard == "" {
		guard = "off"
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO agent_profiles (org_id, project_id, agent_id, name, frameworks, providers, vectordbs, databases, guard_mode, detectors, alerts_enabled, api_key_id, alert_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (org_id, project_id, agent_id) DO UPDATE SET
			name=EXCLUDED.name, frameworks=EXCLUDED.frameworks, providers=EXCLUDED.providers,
			vectordbs=EXCLUDED.vectordbs, databases=EXCLUDED.databases, guard_mode=EXCLUDED.guard_mode,
			detectors=EXCLUDED.detectors, alerts_enabled=EXCLUDED.alerts_enabled, updated_at=NOW()`,
		orgID, pid, p.AgentID, p.Name, scanStr(p.Frameworks), scanStr(p.Providers), scanStr(p.VectorDBs),
		scanStr(p.Databases), guard, scanStr(p.Detectors), p.AlertsEnabled, keyID, alrtID)
	if err != nil {
		return fmt.Errorf("create agent profile: %w", err)
	}
	return nil
}

func (s *PostgresStore) GetAgentProfile(ctx context.Context, orgID, projectID, agentID string) (*AgentProfile, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return nil, sql.ErrNoRows
	}
	var p AgentProfile
	var fw, pr, vs, db, det pq.StringArray
	var keyID sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT agent_id, name, frameworks, providers, vectordbs, databases, guard_mode, detectors, alerts_enabled, COALESCE(api_key_id::text,''), created_at
		FROM agent_profiles WHERE org_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND agent_id=$3`,
		orgID, nullableUUID(projectID), agentID).
		Scan(&p.AgentID, &p.Name, &fw, &pr, &vs, &db, &p.GuardMode, &det, &p.AlertsEnabled, &keyID, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	p.Frameworks, p.Providers, p.VectorDBs, p.Databases, p.Detectors = fw, pr, vs, db, det
	p.APIKeyID = keyID.String
	return &p, nil
}

func (s *PostgresStore) DeleteAgentProfile(ctx context.Context, orgID, projectID, agentID string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM agent_profiles WHERE org_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND agent_id=$3`,
		orgID, nullableUUID(projectID), agentID)
	if err != nil {
		return fmt.Errorf("delete agent profile: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ConfiguredAgents returns the set of agent_ids that have a profile (for the list "configured" badge).
func (s *PostgresStore) ConfiguredAgents(ctx context.Context, orgID, projectID string) (map[string]bool, error) {
	out := map[string]bool{}
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return out, nil
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT agent_id FROM agent_profiles WHERE org_id=$1 AND project_id IS NOT DISTINCT FROM $2`,
		orgID, nullableUUID(projectID))
	if err != nil {
		return out, fmt.Errorf("configured agents: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return out, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// ─── Projects ─────────────────────────────────────────────────────────────

// Project is a project row scoped to an organization.
type Project struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	Environment string     `json:"environment"`
	CreatedAt   time.Time  `json:"created_at"`
	ArchivedAt  *time.Time `json:"archived_at"`
}

// ListProjects returns all projects for an organization (including archived,
// so the UI can show and unarchive them).
func (s *PostgresStore) ListProjects(ctx context.Context, orgID string) ([]Project, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return []Project{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, name, slug, environment, created_at, archived_at
		FROM projects WHERE org_id = $1
		ORDER BY archived_at IS NOT NULL, created_at ASC
	`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.Environment, &p.CreatedAt, &p.ArchivedAt); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// RenameProject updates a project's display name (the slug is immutable so
// existing key/data references stay valid). Scoped to the org.
func (s *PostgresStore) RenameProject(ctx context.Context, orgID, projectID, name string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	if !uuidRe.MatchString(projectID) || !uuidRe.MatchString(orgID) {
		return sql.ErrNoRows
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE projects SET name = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
		name, projectID, orgID)
	if err != nil {
		return fmt.Errorf("rename project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SetProjectArchived archives (or restores) a project. Archiving is reversible
// and preserves all data. Scoped to the org.
func (s *PostgresStore) SetProjectArchived(ctx context.Context, orgID, projectID string, archived bool) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	if !uuidRe.MatchString(projectID) || !uuidRe.MatchString(orgID) {
		return sql.ErrNoRows
	}
	var res sql.Result
	var err error
	if archived {
		res, err = s.db.ExecContext(ctx,
			`UPDATE projects SET archived_at = NOW(), updated_at = NOW() WHERE id = $1 AND org_id = $2`,
			projectID, orgID)
	} else {
		res, err = s.db.ExecContext(ctx,
			`UPDATE projects SET archived_at = NULL, updated_at = NOW() WHERE id = $1 AND org_id = $2`,
			projectID, orgID)
	}
	if err != nil {
		return fmt.Errorf("archive project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteProject hard-deletes a project row (Postgres FK cascades remove its
// agents, alerts, keys→null, etc.). ClickHouse trace data is purged separately
// by the caller. Scoped to the org.
func (s *PostgresStore) DeleteProject(ctx context.Context, orgID, projectID string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	if !uuidRe.MatchString(projectID) || !uuidRe.MatchString(orgID) {
		return sql.ErrNoRows
	}
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM projects WHERE id = $1 AND org_id = $2`, projectID, orgID)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
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
	if !uuidRe.MatchString(alertID) {
		return sql.ErrNoRows
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

// AlertUpdate carries the mutable fields of an alert. Nil fields are left
// unchanged, so the same call powers a full edit and a single-field toggle
// (e.g. pausing via IsActive only).
type AlertUpdate struct {
	Name     *string
	Config   json.RawMessage // nil = unchanged
	Channels *[]string
	IsActive *bool
}

// UpdateAlert applies a partial update to an alert, scoped to the org. Returns
// sql.ErrNoRows if no alert with that id exists for the org.
func (s *PostgresStore) UpdateAlert(ctx context.Context, orgID, alertID string, u AlertUpdate) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	if !uuidRe.MatchString(alertID) || !uuidRe.MatchString(orgID) {
		return sql.ErrNoRows
	}
	sets := []string{}
	args := []any{}
	i := 1
	if u.Name != nil {
		sets = append(sets, fmt.Sprintf("name = $%d", i))
		args = append(args, *u.Name)
		i++
	}
	if u.Config != nil {
		sets = append(sets, fmt.Sprintf("config = $%d", i))
		args = append(args, []byte(u.Config))
		i++
	}
	if u.Channels != nil {
		sets = append(sets, fmt.Sprintf("channels = $%d", i))
		args = append(args, pq.StringArray(*u.Channels))
		i++
	}
	if u.IsActive != nil {
		sets = append(sets, fmt.Sprintf("is_active = $%d", i))
		args = append(args, *u.IsActive)
		i++
	}
	if len(sets) == 0 {
		return nil // nothing to change
	}
	q := fmt.Sprintf("UPDATE alerts SET %s WHERE id = $%d AND org_id = $%d",
		strings.Join(sets, ", "), i, i+1)
	args = append(args, alertID, orgID)
	res, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("update alert: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// RiskAlert is a risk_threshold alert reduced to what evaluation needs.
type RiskAlert struct {
	ID              string
	OrgID           string
	ProjectID       string
	Name            string
	Threshold       int
	Channels        []string
	WebhookURL      string
	SlackWebhookURL string
	EmailTo         string
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
		       COALESCE((config->>'threshold')::int, 50), channels,
		       COALESCE(config->>'webhook_url',''),
		       COALESCE(config->>'slack_webhook_url',''),
		       COALESCE(config->>'email_to','')
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
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.Name, &a.Threshold, &channels, &a.WebhookURL, &a.SlackWebhookURL, &a.EmailTo); err != nil {
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
	ID              string
	OrgID           string
	ProjectID       string
	Name            string
	Threshold       float64
	WindowSec       int
	Channels        []string
	WebhookURL      string
	SlackWebhookURL string
	EmailTo         string
}

// AllActiveCostAlerts returns every active cost_threshold alert across tenants,
// for the periodic spend evaluator. config: {"threshold": <usd>, "window_sec": <s>}.
// SpendAnomalyAlert is an active spend_anomaly alert (config: window_days, factor).
type SpendAnomalyAlert struct {
	ID              string
	OrgID           string
	ProjectID       string
	Name            string
	WindowDays      int
	Factor          float64
	Channels        []string
	WebhookURL      string
	SlackWebhookURL string
	EmailTo         string
}

// AllActiveSpendAnomalyAlerts returns active spend_anomaly alerts across tenants,
// for the periodic anomaly evaluator. config: {"window_days":<n>,"factor":<x>}.
func (s *PostgresStore) AllActiveSpendAnomalyAlerts(ctx context.Context) ([]SpendAnomalyAlert, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, org_id::text, COALESCE(project_id::text,''), name,
		       COALESCE((config->>'window_days')::int, 7),
		       COALESCE((config->>'factor')::float8, 3), channels,
		       COALESCE(config->>'webhook_url',''),
		       COALESCE(config->>'slack_webhook_url',''),
		       COALESCE(config->>'email_to','')
		FROM alerts
		WHERE is_active = TRUE AND type = 'spend_anomaly'`)
	if err != nil {
		return nil, fmt.Errorf("all spend anomaly alerts: %w", err)
	}
	defer rows.Close()
	var out []SpendAnomalyAlert
	for rows.Next() {
		var a SpendAnomalyAlert
		var channels pq.StringArray
		if err := rows.Scan(&a.ID, &a.OrgID, &a.ProjectID, &a.Name, &a.WindowDays, &a.Factor, &channels, &a.WebhookURL, &a.SlackWebhookURL, &a.EmailTo); err != nil {
			return nil, fmt.Errorf("scan spend anomaly alert: %w", err)
		}
		a.Channels = channels
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *PostgresStore) AllActiveCostAlerts(ctx context.Context) ([]CostAlert, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, org_id::text, COALESCE(project_id::text,''), name,
		       COALESCE((config->>'threshold')::float8, 0),
		       COALESCE((config->>'window_sec')::int, 86400), channels,
		       COALESCE(config->>'webhook_url',''),
		       COALESCE(config->>'slack_webhook_url',''),
		       COALESCE(config->>'email_to','')
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
		if err := rows.Scan(&a.ID, &a.OrgID, &a.ProjectID, &a.Name, &a.Threshold, &a.WindowSec, &channels, &a.WebhookURL, &a.SlackWebhookURL, &a.EmailTo); err != nil {
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

// ─── Model prices (externalized, hot-reloadable) ────────────────────────────

// ModelPriceRow is a price-table row for the admin API.
type ModelPriceRow struct {
	Model           string    `json:"model"`
	PromptPer1K     float64   `json:"prompt_per_1k"`
	CompletionPer1K float64   `json:"completion_per_1k"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// LoadModelPrices loads the full price table for the collector's in-memory cache.
func (s *PostgresStore) LoadModelPrices(ctx context.Context) (map[string]ModelPrice, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT model, prompt_per_1k, completion_per_1k FROM model_prices`)
	if err != nil {
		return nil, fmt.Errorf("load model prices: %w", err)
	}
	defer rows.Close()
	out := map[string]ModelPrice{}
	for rows.Next() {
		var m string
		var p, c float64
		if err := rows.Scan(&m, &p, &c); err != nil {
			return nil, fmt.Errorf("scan model price: %w", err)
		}
		out[m] = ModelPrice{PromptPer1K: p, CompletionPer1K: c}
	}
	return out, rows.Err()
}

// ListModelPrices returns the price table for display in the admin UI.
func (s *PostgresStore) ListModelPrices(ctx context.Context) ([]ModelPriceRow, error) {
	if s == nil || s.db == nil {
		return []ModelPriceRow{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT model, prompt_per_1k, completion_per_1k, updated_at FROM model_prices ORDER BY model ASC`)
	if err != nil {
		return nil, fmt.Errorf("list model prices: %w", err)
	}
	defer rows.Close()
	out := []ModelPriceRow{}
	for rows.Next() {
		var r ModelPriceRow
		if err := rows.Scan(&r.Model, &r.PromptPer1K, &r.CompletionPer1K, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan model price row: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpsertModelPrice inserts or updates a model's pricing.
func (s *PostgresStore) UpsertModelPrice(ctx context.Context, model string, promptPer1K, completionPer1K float64) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO model_prices (model, prompt_per_1k, completion_per_1k, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (model) DO UPDATE
		SET prompt_per_1k = EXCLUDED.prompt_per_1k,
		    completion_per_1k = EXCLUDED.completion_per_1k,
		    updated_at = NOW()`,
		model, promptPer1K, completionPer1K)
	if err != nil {
		return fmt.Errorf("upsert model price: %w", err)
	}
	return nil
}

// DeleteModelPrice removes a model from the price table.
func (s *PostgresStore) DeleteModelPrice(ctx context.Context, model string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM model_prices WHERE model = $1`, model)
	if err != nil {
		return fmt.Errorf("delete model price: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

// Budget is a per-project (or org-wide) monthly spend budget.
type Budget struct {
	ID              string  `json:"id"`
	ProjectID       string  `json:"project_id"`
	MonthlyLimitUSD float64 `json:"monthly_limit_usd"`
}

// ListBudgets returns all budgets for an org.
func (s *PostgresStore) ListBudgets(ctx context.Context, orgID string) ([]Budget, error) {
	if s == nil || s.db == nil || !uuidRe.MatchString(orgID) {
		return []Budget{}, nil
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id::text, COALESCE(project_id::text, ''), monthly_limit_usd FROM budgets WHERE org_id = $1`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list budgets: %w", err)
	}
	defer rows.Close()
	out := []Budget{}
	for rows.Next() {
		var b Budget
		if err := rows.Scan(&b.ID, &b.ProjectID, &b.MonthlyLimitUSD); err != nil {
			return nil, fmt.Errorf("scan budget: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// UpsertBudget sets the monthly budget for a project (nil projectID = org-wide).
func (s *PostgresStore) UpsertBudget(ctx context.Context, orgID string, projectID *string, limitUSD float64) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	var res sql.Result
	var err error
	if projectID == nil {
		res, err = s.db.ExecContext(ctx,
			`UPDATE budgets SET monthly_limit_usd = $1, updated_at = NOW() WHERE org_id = $2 AND project_id IS NULL`,
			limitUSD, orgID)
	} else {
		res, err = s.db.ExecContext(ctx,
			`UPDATE budgets SET monthly_limit_usd = $1, updated_at = NOW() WHERE org_id = $2 AND project_id = $3`,
			limitUSD, orgID, *projectID)
	}
	if err != nil {
		return fmt.Errorf("update budget: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return nil
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO budgets (org_id, project_id, monthly_limit_usd) VALUES ($1, $2, $3)`,
		orgID, projectID, limitUSD)
	if err != nil {
		return fmt.Errorf("insert budget: %w", err)
	}
	return nil
}

// DeleteBudget removes a budget, scoped to the org.
func (s *PostgresStore) DeleteBudget(ctx context.Context, orgID, id string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("metadata store unavailable")
	}
	if !uuidRe.MatchString(id) {
		return sql.ErrNoRows
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM budgets WHERE id = $1 AND org_id = $2`, id, orgID)
	if err != nil {
		return fmt.Errorf("delete budget: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
