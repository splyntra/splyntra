// SPDX-License-Identifier: AGPL-3.0-only
package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"
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
}

func NewAPIKeyAuthenticator(dsn string) *APIKeyAuthenticator {
	a := &APIKeyAuthenticator{}
	if dsn != "" {
		db, err := sql.Open("postgres", dsn)
		if err == nil {
			db.SetMaxOpenConns(10)
			db.SetMaxIdleConns(5)
			db.SetConnMaxLifetime(5 * time.Minute)
			// Test connection
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := db.PingContext(ctx); err == nil {
				a.db = db
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

		tenant, ok := a.resolve(key)
		if !ok {
			http.Error(w, `{"error":"invalid api key"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), TenantContextKey, tenant)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
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
		if time.Since(entry.ts) < 5*time.Minute {
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
		return nil, false
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
		return nil, false
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

func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

type cacheEntry struct {
	tenant *TenantInfo
	ts     time.Time
}
