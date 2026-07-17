// SPDX-License-Identifier: FSL-1.1-ALv2
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

// alertStore is the slice of the metadata store the engine needs. Kept as an
// interface so the evaluation logic is unit-testable without a live database.
// *store.PostgresStore satisfies it.
type alertStore interface {
	AllActiveCostAlerts(ctx context.Context) ([]store.CostAlert, error)
	AllActiveSpendAnomalyAlerts(ctx context.Context) ([]store.SpendAnomalyAlert, error)
	AlertFiredSince(ctx context.Context, alertID string, since time.Time) (bool, error)
	ActiveRiskAlerts(ctx context.Context, orgID, projectID string) ([]store.RiskAlert, error)
	RecordAlertEvent(ctx context.Context, orgID, projectID, alertID, alertName, traceID, severity string, riskScore int) error
}

// Engine evaluates risk_threshold (per-trace) and cost_threshold (periodic)
// alerts.
type Engine struct {
	pg       alertStore
	costs    CostSource
	notifier *notify.Notifier
	logger   *zap.Logger
}

// New builds an alert engine. A nil pg store yields a no-op engine.
func New(pg *store.PostgresStore, costs CostSource, notifier *notify.Notifier, logger *zap.Logger) *Engine {
	e := &Engine{costs: costs, notifier: notifier, logger: logger}
	// Assign only when non-nil so a nil *PostgresStore doesn't become a
	// non-nil (typed-nil) interface that defeats the e.pg == nil guards.
	if pg != nil {
		e.pg = pg
	}
	return e
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
		e.notifier.FireWithConfig(ctx, a.Channels, notify.Event{
			AlertName: a.Name, TraceID: "cost", RiskScore: score, Severity: "HIGH", ProjectID: a.ProjectID,
		}, notify.ChannelConfig{
			WebhookURL:      a.WebhookURL,
			SlackWebhookURL: a.SlackWebhookURL,
			EmailTo:         a.EmailTo,
		})
		e.logger.Info("cost alert fired",
			zap.String("alert", a.Name), zap.Float64("spend", spend), zap.Float64("threshold", a.Threshold))
	}
}

// EvaluateSpendAnomalies fires spend_anomaly alerts when today's spend exceeds
// the trailing N-day daily mean by a configurable factor. Baseline is derived
// from the existing WindowCostUSD (today's 24h vs. the prior N days' mean), so no
// new query is needed. At most one fire per day per alert.
func (e *Engine) EvaluateSpendAnomalies(ctx context.Context) {
	if e == nil || e.pg == nil || e.costs == nil {
		return
	}
	alerts, err := e.pg.AllActiveSpendAnomalyAlerts(ctx)
	if err != nil {
		e.logger.Warn("load spend anomaly alerts failed", zap.Error(err))
		return
	}
	const day = 86400
	for _, a := range alerts {
		windowDays := a.WindowDays
		if windowDays <= 0 {
			windowDays = 7
		}
		factor := a.Factor
		if factor <= 1 {
			factor = 3
		}
		// Once per day.
		if fired, _ := e.pg.AlertFiredSince(ctx, a.ID, time.Now().Add(-time.Duration(day)*time.Second)); fired {
			continue
		}
		today, err := e.costs.WindowCostUSD(ctx, a.OrgID, a.ProjectID, day)
		if err != nil {
			continue
		}
		total, err := e.costs.WindowCostUSD(ctx, a.OrgID, a.ProjectID, day*(windowDays+1))
		if err != nil {
			continue
		}
		prior := total - today
		if prior <= 0 {
			continue // no baseline history yet
		}
		mean := prior / float64(windowDays)
		if mean <= 0 || today <= mean*factor {
			continue
		}
		score := int(today)
		_ = e.pg.RecordAlertEvent(ctx, a.OrgID, a.ProjectID, a.ID, a.Name, "cost", "HIGH", score)
		e.notifier.FireWithConfig(ctx, a.Channels, notify.Event{
			AlertName: a.Name, TraceID: "cost", RiskScore: score, Severity: "HIGH", ProjectID: a.ProjectID,
		}, notify.ChannelConfig{
			WebhookURL:      a.WebhookURL,
			SlackWebhookURL: a.SlackWebhookURL,
			EmailTo:         a.EmailTo,
		})
		e.logger.Info("spend anomaly alert fired",
			zap.String("alert", a.Name), zap.Float64("today", today),
			zap.Float64("daily_mean", mean), zap.Float64("factor", factor))
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
		e.notifier.FireWithConfig(ctx, rule.Channels, notify.Event{
			AlertName: rule.Name,
			TraceID:   traceID,
			RiskScore: riskScore,
			Severity:  severity,
			ProjectID: projectID,
		}, notify.ChannelConfig{
			WebhookURL:      rule.WebhookURL,
			SlackWebhookURL: rule.SlackWebhookURL,
			EmailTo:         rule.EmailTo,
		})
		e.logger.Info("alert fired",
			zap.String("alert", rule.Name),
			zap.String("trace_id", traceID),
			zap.Int("risk_score", riskScore),
			zap.Int("threshold", rule.Threshold),
		)
	}
}
