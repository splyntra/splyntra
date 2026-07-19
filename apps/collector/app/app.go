// SPDX-License-Identifier: FSL-1.1-ALv2
// Package app holds the collector's composition root: it wires dependencies,
// builds the HTTP router with the core (open-source) routes, mounts any
// registered extension modules, and runs the server with graceful shutdown.
//
// It lives outside cmd/ so that both the open binary (cmd/collector) and a
// commercial binary in another repository (which blank-imports its modules and
// then calls app.Run) share one composition root with no forked main().
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/extension"
	"github.com/splyntra/splyntra/apps/collector/internal/alerts"
	"github.com/splyntra/splyntra/apps/collector/internal/auth"
	"github.com/splyntra/splyntra/apps/collector/internal/export"
	"github.com/splyntra/splyntra/apps/collector/internal/guard"
	"github.com/splyntra/splyntra/apps/collector/internal/ingest"
	"github.com/splyntra/splyntra/apps/collector/internal/notify"
	"github.com/splyntra/splyntra/apps/collector/internal/store"
	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
	"github.com/splyntra/splyntra/apps/collector/internal/tenant"
)

const version = "1.0.0"

// Run starts the collector and blocks until a shutdown signal is received.
// Extension modules registered via extension.Register before Run is called are
// mounted onto the authenticated /v1 group.
func Run() {
	logger, err := zap.NewProduction()
	if err != nil {
		panic("failed to initialize logger: " + err.Error())
	}
	defer func() { _ = logger.Sync() }()

	cfg := loadConfig()

	// Initialize dependencies
	apiKeyAuth := auth.NewAPIKeyAuthenticator(cfg.PostgresDSN)
	defer apiKeyAuth.Close()
	tenantResolver := tenant.NewResolver(cfg.PostgresDSN)

	// NATS Publisher
	publisher, err := streaming.NewPublisher(cfg.NatsURL, logger)
	if err != nil {
		logger.Warn("NATS not available, running without streaming", zap.Error(err))
	} else {
		defer publisher.Close()
	}

	// ClickHouse Store
	chStore, err := store.NewClickHouseStore(cfg.ClickHouseDSN, logger)
	if err != nil {
		logger.Warn("ClickHouse not available, running without storage", zap.Error(err))
	} else {
		defer chStore.Close()
	}

	// Postgres metadata store (projects, agents, alerts)
	pgStore, err := store.NewPostgresStore(cfg.PostgresDSN, logger)
	if err != nil {
		logger.Warn("Postgres metadata store not available", zap.Error(err))
	} else if pgStore != nil {
		defer pgStore.Close()
	}

	// Load the model price table from Postgres and refresh it periodically, so
	// pricing edits (via the admin API) take effect without a collector redeploy.
	// An empty/failed load keeps the built-in defaults.
	if pgStore != nil {
		loadPrices := func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if prices, err := pgStore.LoadModelPrices(ctx); err != nil {
				logger.Warn("load model prices failed; keeping last-known/built-in table", zap.Error(err))
			} else {
				store.SetModelPrices(prices)
			}
		}
		loadPrices()
		priceTicker := time.NewTicker(10 * time.Minute)
		defer priceTicker.Stop()
		go func() {
			for range priceTicker.C {
				loadPrices()
			}
		}()
	}

	// Alert engine: evaluates scored traces (risk) + periodic spend (cost).
	alertEngine := alerts.New(pgStore, chStore, notify.New(logger), logger)

	// Periodic cost_threshold evaluation.
	if pgStore != nil && chStore != nil {
		costTicker := time.NewTicker(5 * time.Minute)
		defer costTicker.Stop()
		go func() {
			for range costTicker.C {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				alertEngine.EvaluateCostAlerts(ctx)
				alertEngine.EvaluateSpendAnomalies(ctx)
				cancel()
			}
		}()
	}

	// Detection result consumer (reads results from detector service)
	if publisher != nil && chStore != nil {
		detConsumer, err := streaming.NewDetectionConsumer(cfg.NatsURL, logger, chStore)
		if err != nil {
			logger.Warn("detection consumer not available", zap.Error(err))
		} else {
			detConsumer.SetAlertEvaluator(alertEngine)
			// Optional outbound export to a SIEM / Datadog / Splunk / webhook.
			if fw := export.NewWebhook(cfg.ExportURL, cfg.ExportToken, logger); fw != nil {
				detConsumer.SetExporter(fw)
				logger.Info("detection export enabled", zap.String("url", cfg.ExportURL))
			}
			defer detConsumer.Close()
			if err := detConsumer.Start(context.Background()); err != nil {
				logger.Error("detection consumer start failed", zap.Error(err))
			}
		}
	}

	handler := ingest.NewHandler(logger, tenantResolver, publisher, chStore, pgStore)
	queryHandler := ingest.NewQueryHandler(logger, chStore, pgStore)
	guardHandler := guard.NewHandler(logger)

	// Router
	r := chi.NewRouter()

	// Standard middleware stack
	r.Use(middleware.RequestID)
	r.Use(trustedRealIP(cfg.TrustedProxyCIDRs))
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders)
	r.Use(corsMiddleware(cfg.CORSOrigins))
	r.Use(structuredLogger(logger))
	r.Use(httprate.LimitByIP(cfg.RateLimitRPS, time.Second))

	// Health - lightweight liveness probe (k8s /healthz)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"version": version,
		})
	})

	// Readiness - checks dependencies (k8s /readyz)
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) {
		status := map[string]string{"status": "ok", "version": version}
		code := http.StatusOK

		if chStore != nil {
			if err := chStore.Ping(r.Context()); err != nil {
				status["clickhouse"] = "unavailable"
				code = http.StatusServiceUnavailable
			} else {
				status["clickhouse"] = "ok"
			}
		} else {
			status["clickhouse"] = "not_configured"
		}

		if publisher != nil {
			status["nats"] = "ok"
		} else {
			status["nats"] = "not_configured"
		}

		if code != http.StatusOK {
			status["status"] = "degraded"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(status)
	})

	// Handle CORS preflight for all routes
	r.Options("/*", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	// Build the capability set handed to extension modules. The tenant adapter
	// projects the internal auth context onto the public extension.Tenant; the
	// cost capability is nil when no analytics store is configured.
	deps := extension.Deps{
		Logger:      logger,
		PostgresDSN: cfg.PostgresDSN,
		Tenant: func(req *http.Request) extension.Tenant {
			t, _ := req.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
			if t == nil {
				return extension.Tenant{}
			}
			return extension.Tenant{OrgID: t.OrgID, ProjectID: t.ProjectID, Env: t.Env, KeyID: t.KeyID}
		},
	}
	if chStore != nil {
		deps.WindowCostUSD = chStore.WindowCostUSD
	}

	// OTLP-compatible ingestion endpoints + core query API.
	r.Route("/v1", func(r chi.Router) {
		r.Use(apiKeyAuth.Middleware)
		// OTLP traces endpoint
		r.Post("/traces", handler.ReceiveTraces)
		// OTLP structured logs ingest (Layer 1 Observability)
		r.Post("/logs", handler.ReceiveLogs)
		// Legacy event endpoint (for backwards compat)
		r.Post("/events", handler.ReceiveEvents)
		// Out-of-process integration webhooks
		r.Post("/integrations/dify", handler.ReceiveDify)
		r.Post("/integrations/n8n", handler.ReceiveN8N)
		r.Post("/integrations/flowise", handler.ReceiveFlowise)
		r.Post("/integrations/bedrock", handler.ReceiveBedrock)
		r.Post("/integrations/vertex", handler.ReceiveVertex)
		r.Post("/integrations/openclaw", handler.ReceiveOpenClaw)
		r.Post("/integrations/langflow", handler.ReceiveLangflow)
		// Inline content guardrail (SDK pre-flight): fast Go engine, open-core.
		// NOTE: /v1/authorize and /v1/ledger are intentionally NOT registered here
		// — they are governance (policy + audit) endpoints owned by the commercial
		// governance extension module (splyntra-cloud ee/governance). Registering
		// them in the core would collide with that module and is a cloud feature.
		r.Post("/guard", guardHandler.Guard)
		// Query endpoints (dashboard uses these)
		r.Get("/traces", queryHandler.ListTraces)
		r.Get("/traces/{traceID}", queryHandler.GetTrace)
		r.Get("/logs", queryHandler.ListLogs)
		r.Get("/agents", queryHandler.ListAgents)
		// Agent profiles (Connect wizard): create mints an ingest key + returns it once.
		r.Post("/agents", queryHandler.CreateAgent)
		r.Get("/agents/{agentID}/profile", queryHandler.GetAgentProfile)
		r.Patch("/agents/{agentID}/profile", queryHandler.UpdateAgentProfile)
		r.Delete("/agents/{agentID}/profile", queryHandler.DeleteAgentProfile)
		// Agent Platforms (orchestrators): platform-scoped run/workflow aggregates.
		r.Get("/platforms", queryHandler.ListPlatforms)
		r.Get("/platforms/{platform}", queryHandler.GetPlatform)
		r.Get("/costs", queryHandler.ListCosts)
		r.Get("/metrics", queryHandler.ListMetrics)
		r.Get("/metrics/spans", queryHandler.ListSpanMetrics)
		r.Get("/security/incidents", queryHandler.ListSecurityIncidents)
		r.Get("/security/summary", queryHandler.SecuritySummary)
		r.Get("/projects", queryHandler.ListProjects)
		// Provisioning (requires an "admin"-scoped key): projects + API keys
		r.Post("/projects", queryHandler.CreateProject)
		r.Patch("/projects/{projectID}", queryHandler.UpdateProject)
		r.Delete("/projects/{projectID}", queryHandler.DeleteProject)
		r.Get("/keys", queryHandler.ListKeys)
		r.Post("/keys", queryHandler.CreateKey)
		r.Delete("/keys/{keyID}", queryHandler.RevokeKey)
		r.Post("/keys/{keyID}/rotate", queryHandler.RotateKey)
		// Alert configuration + history
		r.Get("/alerts", queryHandler.ListAlerts)
		r.Post("/alerts", queryHandler.CreateAlert)
		r.Patch("/alerts/{alertID}", queryHandler.UpdateAlert)
		r.Delete("/alerts/{alertID}", queryHandler.DeleteAlert)
		// Cost: model price table (admin) + budgets
		r.Get("/pricing", queryHandler.ListPricing)
		r.Put("/pricing", queryHandler.UpsertPricing)
		r.Delete("/pricing/{model}", queryHandler.DeletePricing)
		r.Get("/budgets", queryHandler.ListBudgets)
		r.Put("/budgets", queryHandler.UpsertBudget)
		r.Delete("/budgets/{budgetID}", queryHandler.DeleteBudget)

		// Extension modules (e.g. governance) mount their own routes here. The
		// OSS binary registers none, so those endpoints do not exist in it.
		for _, m := range extension.Modules() {
			m.Routes(r, deps)
			logger.Info("extension module mounted", zap.String("module", m.Name()))
		}
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           r,
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}

	// Graceful shutdown
	go func() {
		logger.Info("collector starting",
			zap.Int("port", cfg.Port),
			zap.String("version", version),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutdown signal received, draining connections...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	logger.Info("collector stopped")
}

// ─── Config ─────────────────────────────────────────────────────────────────

type Config struct {
	Port          int
	PostgresDSN   string
	NatsURL       string
	ClickHouseDSN string
	ValkeyAddr    string
	RateLimitRPS  int
	CORSOrigins   []string
	ExportURL     string // outbound SIEM/webhook sink for detections (empty = off)
	ExportToken   string // optional bearer token for the export sink
	// Proxy CIDRs whose X-Forwarded-For/X-Real-IP headers are trusted. Defaults to
	// loopback + private ranges (defaultTrustedProxies) so the common "proxy on a
	// private network" topology (Docker/ingress) keeps correct per-client IPs,
	// while a request arriving directly from a PUBLIC peer still can't spoof its
	// IP (its socket peer isn't in a trusted range → headers ignored). Set
	// explicitly to restrict further (e.g. a single ingress CIDR) or to "none" to
	// trust no proxy at all.
	TrustedProxyCIDRs []*net.IPNet
}

// defaultTrustedProxies covers loopback + RFC1918 + IPv6 loopback/ULA/link-local
// — the networks a fronting reverse proxy normally sits on.
const defaultTrustedProxies = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7,fe80::/10"

func loadConfig() Config {
	origins := envStr("CORS_ORIGINS", "http://localhost:3000")
	return Config{
		Port:              envInt("PORT", 4318),
		PostgresDSN:       envStr("POSTGRES_DSN", "postgres://splyntra:splyntra@localhost:5432/splyntra?sslmode=disable"),
		NatsURL:           envStr("NATS_URL", "nats://localhost:4222"),
		ClickHouseDSN:     envStr("CLICKHOUSE_DSN", "clickhouse://localhost:9000/splyntra"),
		ValkeyAddr:        envStr("VALKEY_ADDR", "localhost:6379"),
		RateLimitRPS:      envInt("RATE_LIMIT_RPS", 1000),
		CORSOrigins:       strings.Split(origins, ","),
		ExportURL:         envStr("SPLYNTRA_EXPORT_URL", ""),
		ExportToken:       envStr("SPLYNTRA_EXPORT_TOKEN", ""),
		TrustedProxyCIDRs: parseCIDRs(envStr("TRUSTED_PROXY_CIDRS", defaultTrustedProxies)),
	}
}

// parseCIDRs parses a comma-separated list of CIDRs (or bare IPs) into networks,
// silently dropping malformed entries.
func parseCIDRs(csv string) []*net.IPNet {
	var out []*net.IPNet
	for _, part := range strings.Split(csv, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !strings.Contains(part, "/") {
			if strings.Contains(part, ":") {
				part += "/128"
			} else {
				part += "/32"
			}
		}
		if _, n, err := net.ParseCIDR(part); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// trustedRealIP overrides RemoteAddr from X-Real-IP/X-Forwarded-For ONLY when the
// direct peer is a trusted proxy. Without this gate, chi's middleware.RealIP
// trusts those headers unconditionally, letting a client spoof X-Forwarded-For to
// forge its IP and bypass the per-IP rate limiter (and the audit `remote` field).
func trustedRealIP(trusted []*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if peerInCIDRs(r.RemoteAddr, trusted) {
				if ip := headerClientIP(r); ip != "" {
					r.RemoteAddr = ip
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func peerInCIDRs(remoteAddr string, cidrs []*net.IPNet) bool {
	if len(cidrs) == 0 {
		return false
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, c := range cidrs {
		if c.Contains(ip) {
			return true
		}
	}
	return false
}

func headerClientIP(r *http.Request) string {
	if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
		return xr
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0]) // left-most = original client
	}
	return ""
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		var i int
		if n, _ := fmt.Sscanf(v, "%d", &i); n == 1 && i > 0 {
			return i
		}
		return fallback
	}
	return fallback
}

// ─── Middleware ──────────────────────────────────────────────────────────────

// securityHeaders adds OWASP-recommended HTTP security headers.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// corsMiddleware returns a handler that sets CORS headers based on allowed origins.
func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowed := false
			for _, o := range allowedOrigins {
				if o == "*" || o == origin {
					allowed = true
					break
				}
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID, X-API-Key")
				w.Header().Set("Access-Control-Max-Age", "86400")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// structuredLogger logs each request with method, path, status, and latency.
func structuredLogger(logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			logger.Info("request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", ww.Status()),
				zap.Int("bytes", ww.BytesWritten()),
				zap.Duration("latency", time.Since(start)),
				zap.String("request_id", middleware.GetReqID(r.Context())),
				zap.String("remote", r.RemoteAddr),
			)
		})
	}
}
