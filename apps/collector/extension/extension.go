// SPDX-License-Identifier: AGPL-3.0-only
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
