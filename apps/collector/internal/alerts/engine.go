// SPDX-License-Identifier: AGPL-3.0-only
// Package alerts evaluates scored traces against configured alert rules and
// records/dispatches any that fire. It is invoked from the detection consumer
// once a trace's risk score is known.
package alerts

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/internal/notify"
	"github.com/splyntra/splyntra/apps/collector/internal/store"
)

// CostSource supplies trailing-window spend for cost-threshold evaluation
// (satisfied by *store.ClickHouseStore).
type CostSource interface {
	WindowCostUSD(ctx context.Context, orgID, projectID string, windowSec int) (float64, error)
}

// Engine evaluates risk_threshold (per-trace) and cost_threshold (periodic)
// alerts.
type Engine struct {
	pg       *store.PostgresStore
	costs    CostSource
	notifier *notify.Notifier
	logger   *zap.Logger
}

// New builds an alert engine. A nil pg store yields a no-op engine.
func New(pg *store.PostgresStore, costs CostSource, notifier *notify.Notifier, logger *zap.Logger) *Engine {
	return &Engine{pg: pg, costs: costs, notifier: notifier, logger: logger}
}

// EvaluateCostAlerts checks every active cost_threshold alert against trailing
// spend and fires those over budget (at most once per window). Run periodically.
func (e *Engine) EvaluateCostAlerts(ctx context.Context) {
	if e == nil || e.pg == nil || e.costs == nil {
		return
	}
	alerts, err := e.pg.AllActiveCostAlerts(ctx)
	if err != nil {
		e.logger.Warn("load cost alerts failed", zap.Error(err))
		return
	}
	for _, a := range alerts {
		windowSec := a.WindowSec
		if windowSec <= 0 {
			windowSec = 86400
		}
		// Don't re-fire within the same window.
		if fired, _ := e.pg.AlertFiredSince(ctx, a.ID, time.Now().Add(-time.Duration(windowSec)*time.Second)); fired {
			continue
		}
		spend, err := e.costs.WindowCostUSD(ctx, a.OrgID, a.ProjectID, windowSec)
		if err != nil || spend < a.Threshold {
			continue
		}
		score := int(spend) // surface spend as the event's numeric value
		_ = e.pg.RecordAlertEvent(ctx, a.OrgID, a.ProjectID, a.ID, a.Name, "cost", "HIGH", score)
		e.notifier.Fire(ctx, a.Channels, notify.Event{
			AlertName: a.Name, TraceID: "cost", RiskScore: score, Severity: "HIGH", ProjectID: a.ProjectID,
		})
		e.logger.Info("cost alert fired",
			zap.String("alert", a.Name), zap.Float64("spend", spend), zap.Float64("threshold", a.Threshold))
	}
}

// Evaluate checks a scored trace against active risk_threshold alerts for its
// project and fires any whose threshold is met. Best-effort: errors are logged.
func (e *Engine) Evaluate(ctx context.Context, orgID, projectID, traceID, severity string, riskScore int) {
	if e == nil || e.pg == nil || riskScore <= 0 {
		return
	}
	rules, err := e.pg.ActiveRiskAlerts(ctx, orgID, projectID)
	if err != nil {
		e.logger.Warn("load risk alerts failed", zap.Error(err))
		return
	}
	for _, rule := range rules {
		if riskScore < rule.Threshold {
			continue
		}
		if err := e.pg.RecordAlertEvent(ctx, orgID, projectID, rule.ID, rule.Name, traceID, severity, riskScore); err != nil {
			e.logger.Warn("record alert event failed", zap.Error(err), zap.String("alert", rule.Name))
		}
		e.notifier.Fire(ctx, rule.Channels, notify.Event{
			AlertName: rule.Name,
			TraceID:   traceID,
			RiskScore: riskScore,
			Severity:  severity,
			ProjectID: projectID,
		})
		e.logger.Info("alert fired",
			zap.String("alert", rule.Name),
			zap.String("trace_id", traceID),
			zap.Int("risk_score", riskScore),
			zap.Int("threshold", rule.Threshold),
		)
	}
}
