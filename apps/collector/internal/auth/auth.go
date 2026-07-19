// SPDX-License-Identifier: FSL-1.1-ALv2
package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"

	"github.com/splyntra/splyntra/apps/collector/extension"
)

type contextKey string

const TenantContextKey contextKey = "tenant"

// TenantInfo is injected into context after successful auth.
type TenantInfo struct {
	OrgID     string
	ProjectID string
	Env       string
	KeyID     string
	Scopes    []string
}

// HasScope reports whether the key carries a given scope (e.g. "admin" for
// provisioning). An empty scope set is treated as no special privileges.
func (t *TenantInfo) HasScope(scope string) bool {
	for _, s := range t.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// APIKeyAuthenticator validates API keys and resolves tenant context.
type APIKeyAuthenticator struct {
	db    *sql.DB
	cache sync.Map
	// serviceToken, when set (COLLECTOR_SERVICE_TOKEN), lets a trusted first-party
	// caller (the dashboard BFF) declare the tenant via X-Splyntra-Org-Id /
	// X-Splyntra-Project-Id headers instead of an API key. This is how the
	// multi-tenant Cloud edition scopes each request to the logged-in user's org
	// (api_keys store only hashes, so the BFF can't replay a per-org key). It is
	// a server-to-server secret and must never be exposed to the browser.
	serviceToken string
}

func NewAPIKeyAuthenticator(dsn string) *APIKeyAuthenticator {
	a := &APIKeyAuthenticator{serviceToken: os.Getenv("COLLECTOR_SERVICE_TOKEN")}
	if dsn != "" {
		db, err := sql.Open("postgres", dsn)
		if err == nil {
			db.SetMaxOpenConns(10)
			db.SetMaxIdleConns(5)
			db.SetConnMaxLifetime(5 * time.Minute)
			// Keep the handle regardless of the startup ping. sql.Open does not
			// dial; database/sql reconnects lazily on first use. Nulling the
			// handle on a transient boot-time ping failure would permanently
			// route every API key to the deny-all validator (401 for all
			// ingestion) until the collector is restarted — a momentary DB blip
			// must not become a hard outage. Ping only to surface a warning.
			a.db = db
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := db.PingContext(ctx); err != nil {
				log.Printf("auth: postgres not reachable at startup (%v); will retry lazily", err)
			}
		}
	}
	return a
}

// Close closes the database connection.
func (a *APIKeyAuthenticator) Close() error {
	if a.db != nil {
		return a.db.Close()
	}
	return nil
}

// Middleware authenticates requests via Bearer token or x-api-key header.
func (a *APIKeyAuthenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := extractAPIKey(r)
		if key == "" {
			http.Error(w, `{"error":"missing api key"}`, http.StatusUnauthorized)
			return
		}

		// Trusted first-party service token: the caller (dashboard BFF) declares
		// the tenant via headers. Gated on a non-empty configured secret and a
		// constant-time match, so it never activates by accident.
		if a.serviceToken != "" && subtle.ConstantTimeCompare([]byte(key), []byte(a.serviceToken)) == 1 {
			tenant, ok := tenantFromHeaders(r)
			if !ok {
				http.Error(w, `{"error":"service token requires a valid X-Splyntra-Org-Id"}`, http.StatusBadRequest)
				return
			}
			ctx := context.WithValue(r.Context(), TenantContextKey, tenant)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		tenant, ok := a.resolve(key)
		if !ok {
			http.Error(w, `{"error":"invalid api key"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), TenantContextKey, tenant)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

var authUUIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// keyCacheTTL bounds how long a key-resolution result is cached. Kept short so a
// revoked/rotated key stops working quickly (revocation flips api_keys.is_active,
// which the next uncached lookup respects).
const keyCacheTTL = 60 * time.Second

// tenantFromHeaders builds tenant context from the trusted service-token path's
// headers. org_id is required and must be a UUID; project/env are optional.
func tenantFromHeaders(r *http.Request) (*TenantInfo, bool) {
	orgID := r.Header.Get("X-Splyntra-Org-Id")
	if !authUUIDRe.MatchString(orgID) {
		return nil, false
	}
	projectID := r.Header.Get("X-Splyntra-Project-Id")
	if projectID != "" && !authUUIDRe.MatchString(projectID) {
		return nil, false
	}
	env := r.Header.Get("X-Splyntra-Env")
	if env == "" {
		env = "production"
	}
	return &TenantInfo{
		OrgID:     orgID,
		ProjectID: projectID,
		Env:       env,
		KeyID:     "svc",
		// The BFF enforces the session role before forwarding; the collector
		// grants the trusted channel full scopes within the declared org.
		Scopes: []string{"ingest", "read", "admin"},
	}, true
}

func extractAPIKey(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); auth != "" {
		if strings.HasPrefix(auth, "Bearer ") {
			return strings.TrimPrefix(auth, "Bearer ")
		}
	}
	if key := r.Header.Get("X-API-Key"); key != "" {
		return key
	}
	return ""
}

func (a *APIKeyAuthenticator) resolve(key string) (*TenantInfo, bool) {
	// Check cache first
	if cached, ok := a.cache.Load(key); ok {
		entry := cached.(*cacheEntry)
		if time.Since(entry.ts) < keyCacheTTL {
			return entry.tenant, true
		}
		a.cache.Delete(key)
	}

	// Dev key fallback when ENV=development. Uses the seeded org/project UUIDs
	// (see migrations/postgres/001_init.sql) so projects, agent registry, and
	// alerts resolve consistently against Postgres in local development.
	if os.Getenv("ENV") == "development" {
		if subtle.ConstantTimeCompare([]byte(key), []byte("splyntra_dev_key")) == 1 {
			t := &TenantInfo{
				OrgID:     "00000000-0000-0000-0000-000000000001",
				ProjectID: "00000000-0000-0000-0000-000000000002",
				Env:       "development",
				KeyID:     "key_dev",
				Scopes:    []string{"ingest", "read", "admin"},
			}
			a.cache.Store(key, &cacheEntry{tenant: t, ts: time.Now()})
			return t, true
		}
	}

	// Query PostgreSQL
	if a.db == nil {
		return a.resolveViaValidator(key)
	}

	keyHash := hashKey(key)
	var t TenantInfo
	var env sql.NullString
	var scopes pq.StringArray

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err := a.db.QueryRowContext(ctx, `
		SELECT k.id, k.org_id, COALESCE(k.project_id::text, ''), COALESCE(p.environment, 'development'), k.scopes
		FROM api_keys k
		LEFT JOIN projects p ON p.id = k.project_id
		WHERE k.key_hash = $1
		  AND k.is_active = TRUE
		  AND (k.expires_at IS NULL OR k.expires_at > NOW())
	`, keyHash).Scan(&t.KeyID, &t.OrgID, &t.ProjectID, &env, &scopes)

	if err != nil {
		// Not an API key — try a registered federated/JIT token validator
		// (commercial identity module). OSS falls through to a deny.
		return a.resolveViaValidator(key)
	}
	t.Scopes = scopes

	if env.Valid {
		t.Env = env.String
	} else {
		t.Env = "development"
	}

	// Update last_used_at in background
	go func() {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer bgCancel()
		_, _ = a.db.ExecContext(bgCtx, `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, t.KeyID)
	}()

	a.cache.Store(key, &cacheEntry{tenant: &t, ts: time.Now()})
	return &t, true
}

// resolveViaValidator asks the registered token validator (a commercial identity
// module — OIDC/JWT, JIT credentials) to authenticate a token the core could not
// resolve as an API key. OSS registers no validator, so this denies. Positive
// results are cached like API keys.
func (a *APIKeyAuthenticator) resolveViaValidator(key string) (*TenantInfo, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	vi, ok := extension.Validator().Validate(ctx, key)
	if !ok || vi == nil {
		return nil, false
	}
	t := &TenantInfo{
		OrgID:     vi.OrgID,
		ProjectID: vi.ProjectID,
		Env:       vi.Env,
		KeyID:     vi.KeyID,
		Scopes:    vi.Scopes,
	}
	if t.Env == "" {
		t.Env = "production"
	}
	a.cache.Store(key, &cacheEntry{tenant: t, ts: time.Now()})
	return t, true
}

func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

type cacheEntry struct {
	tenant *TenantInfo
	ts     time.Time
}
