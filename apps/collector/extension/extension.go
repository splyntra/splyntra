// SPDX-License-Identifier: FSL-1.1-ALv2
// Package extension is the open/closed seam of the collector. It defines the
// registry and the contract that out-of-tree (commercial) modules implement to
// mount additional routes onto the authenticated /v1 API — without the open
// core ever importing them.
//
// The dependency only points one way: the open core defines this package and a
// module implements its Module interface, registering itself (typically from an
// init() blank-imported by a separate binary). The open OSS binary registers
// nothing, so those routes simply do not exist in it.
//
// A module receives only this package's public types in Deps — never an
// internal/* type — so it can live in a different module/repository.
package extension

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// Tenant is the public projection of the authenticated request's tenant, adapted
// by the core from its internal auth context. Modules read it via Deps.Tenant.
type Tenant struct {
	OrgID     string
	ProjectID string
	Env       string
	KeyID     string
}

// Deps are the capabilities the open core hands a module at mount time. It
// deliberately exposes DSNs and small capability functions rather than internal
// store handles, so a module stays import-decoupled from the core's internals
// and can own its own connections to the tables it is responsible for.
type Deps struct {
	Logger *zap.Logger
	// PostgresDSN lets a module open its own pool for the tables it owns.
	PostgresDSN string
	// Tenant extracts the authenticated tenant from a request (the /v1 group's
	// auth middleware has already run before any module route is reached).
	Tenant func(*http.Request) Tenant
	// WindowCostUSD reports an org/project's spend over the trailing window
	// (seconds), sourced from the core's analytics store. May be nil when the
	// core has no analytics store configured; callers must nil-check.
	WindowCostUSD func(ctx context.Context, orgID, projectID string, windowSec int) (float64, error)
}

// Module is implemented by a pluggable feature. Routes mounts its handlers onto
// the already-authenticated /v1 router; it is called once at startup.
type Module interface {
	Name() string
	Routes(r chi.Router, d Deps)
}

var registry []Module

// Register adds a module to the registry. Call from an init() so that merely
// importing the module package (typically a blank import in a binary's main)
// is enough to activate it.
func Register(m Module) { registry = append(registry, m) }

// Modules returns the registered modules in registration order.
func Modules() []Module { return registry }

// QuotaGuard authorizes a tenant action against plan limits. The open core calls
// it at low-frequency control points (e.g. project creation); the commercial
// build registers a guard backed by org plans + usage. The OSS default allows
// everything (single-tenant, no plans). Keep it off hot paths — it may hit a DB.
type QuotaGuard interface {
	// Allow reports whether orgID may perform action (e.g. "project.create").
	// The returned reason is surfaced to the caller when denied.
	Allow(ctx context.Context, orgID, action string) (bool, string)
}

type allowAllGuard struct{}

func (allowAllGuard) Allow(context.Context, string, string) (bool, string) { return true, "" }

var guard QuotaGuard = allowAllGuard{}

// RegisterQuotaGuard installs the plan/usage enforcement guard (commercial).
func RegisterQuotaGuard(g QuotaGuard) { guard = g }

// Quota returns the active guard (allow-all in OSS).
func Quota() QuotaGuard { return guard }

// ── Token validation seam (agent identity federation) ───────────────────────
// The open core authenticates by hashed API key. A commercial module can
// register an alternative validator to authenticate agents by a federated OIDC
// token, a JIT credential, etc. The core tries it ONLY after the api_keys hash
// lookup misses, so it never slows the common path. Like QuotaGuard this is a
// register-a-provider seam (no routes), so it cannot collide with module routes.
//
// The validator returns a PUBLIC ValidatedIdentity (never an internal auth type),
// which the core maps onto its own tenant context.

// ValidatedIdentity is the tenant a TokenValidator resolves a token to.
type ValidatedIdentity struct {
	OrgID     string
	ProjectID string
	Env       string
	KeyID     string
	Scopes    []string
}

// TokenValidator authenticates a bearer token the core could not resolve as an
// API key. ok=false means "not my token, keep falling through" (NOT an auth
// error); the core then rejects the request as usual.
type TokenValidator interface {
	Validate(ctx context.Context, token string) (*ValidatedIdentity, bool)
}

type denyValidator struct{}

func (denyValidator) Validate(context.Context, string) (*ValidatedIdentity, bool) {
	return nil, false
}

var tokenValidator TokenValidator = denyValidator{}

// RegisterTokenValidator installs a federated/JIT token validator (commercial).
func RegisterTokenValidator(v TokenValidator) { tokenValidator = v }

// Validator returns the active token validator (deny-all/fall-through in OSS).
func Validator() TokenValidator { return tokenValidator }

// ── Audit-ledger seam (tamper-evident activity log) ─────────────────────────
// The tamper-evident ledger is owned by the commercial governance module (the
// hash-chain + serialized append live there). This register-a-provider seam lets
// ANY module — or a future open-core caller — record an audit entry without
// importing the governance package or reimplementing the chain, keeping each
// pillar decoupled (identity writes credential/agent events without depending on
// governance). Like QuotaGuard/TokenValidator it registers a provider (no routes),
// so it cannot collide with module routes. The OSS default is a no-op.

// LedgerAppender records a tamper-evident audit entry. metadata is optional JSON.
type LedgerAppender interface {
	Append(ctx context.Context, orgID, projectID, actor, action, resource, traceID string, metadata json.RawMessage) error
}

type noopAppender struct{}

func (noopAppender) Append(context.Context, string, string, string, string, string, string, json.RawMessage) error {
	return nil
}

var ledger LedgerAppender = noopAppender{}

// RegisterLedger installs the tamper-evident audit ledger (commercial governance).
func RegisterLedger(a LedgerAppender) {
	if a != nil {
		ledger = a
	}
}

// Ledger returns the active audit ledger (no-op in OSS). Never nil.
func Ledger() LedgerAppender { return ledger }
