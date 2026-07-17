// SPDX-License-Identifier: FSL-1.1-ALv2
package alerts

import (
	"context"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/internal/notify"
	"github.com/splyntra/splyntra/apps/collector/internal/store"
)

// fakeStore implements alertStore for evaluation-logic tests (no database).
type fakeStore struct {
	risk       []store.RiskAlert
	cost       []store.CostAlert
	anomaly    []store.SpendAnomalyAlert
	firedSince bool
	recorded   []string // alertIDs for which an event was recorded
}

func (f *fakeStore) ActiveRiskAlerts(_ context.Context, _, _ string) ([]store.RiskAlert, error) {
	return f.risk, nil
}
func (f *fakeStore) AllActiveCostAlerts(_ context.Context) ([]store.CostAlert, error) {
	return f.cost, nil
}
func (f *fakeStore) AllActiveSpendAnomalyAlerts(_ context.Context) ([]store.SpendAnomalyAlert, error) {
	return f.anomaly, nil
}
func (f *fakeStore) AlertFiredSince(_ context.Context, _ string, _ time.Time) (bool, error) {
	return f.firedSince, nil
}
func (f *fakeStore) RecordAlertEvent(_ context.Context, _, _, alertID, _, _, _ string, _ int) error {
	f.recorded = append(f.recorded, alertID)
	return nil
}

type fakeCost float64

func (f fakeCost) WindowCostUSD(_ context.Context, _, _ string, _ int) (float64, error) {
	return float64(f), nil
}

// fakeSeries returns `today` for a 1-day window and `total` for anything longer,
// so spend-anomaly evaluation sees a distinct today vs. trailing total.
type fakeSeries struct{ today, total float64 }

func (f fakeSeries) WindowCostUSD(_ context.Context, _, _ string, windowSec int) (float64, error) {
	if windowSec <= 86400 {
		return f.today, nil
	}
	return f.total, nil
}

func TestEvaluateSpendAnomaly(t *testing.T) {
	ctx := context.Background()
	// window 7d, factor 3. total(8d)=170, today=100 → prior=70, mean=10, 3× = 30; 100>30 → fire.
	fs := &fakeStore{anomaly: []store.SpendAnomalyAlert{{ID: "s1", WindowDays: 7, Factor: 3}}}
	newEngine(fs, fakeSeries{today: 100, total: 170}).EvaluateSpendAnomalies(ctx)
	if len(fs.recorded) != 1 {
		t.Fatalf("spend within factor of mean should fire, got %d", len(fs.recorded))
	}
	// today=12 → 12 < 30 → no fire.
	quiet := &fakeStore{anomaly: []store.SpendAnomalyAlert{{ID: "s1", WindowDays: 7, Factor: 3}}}
	newEngine(quiet, fakeSeries{today: 12, total: 82}).EvaluateSpendAnomalies(ctx)
	if len(quiet.recorded) != 0 {
		t.Fatalf("normal spend must not fire, got %d", len(quiet.recorded))
	}
	// dedup: already fired today → skip.
	deduped := &fakeStore{anomaly: []store.SpendAnomalyAlert{{ID: "s1", WindowDays: 7, Factor: 3}}, firedSince: true}
	newEngine(deduped, fakeSeries{today: 100, total: 170}).EvaluateSpendAnomalies(ctx)
	if len(deduped.recorded) != 0 {
		t.Fatal("must not re-fire the same day")
	}
}

func newEngine(s alertStore, c CostSource) *Engine {
	// Channels are nil in tests, so the notifier is a no-op (no goroutines).
	return &Engine{pg: s, costs: c, notifier: notify.New(zap.NewNop()), logger: zap.NewNop()}
}

func TestEvaluateRiskThreshold(t *testing.T) {
	fs := &fakeStore{risk: []store.RiskAlert{{ID: "a1", Name: "n", Threshold: 70}}}
	e := newEngine(fs, nil)
	ctx := context.Background()

	e.Evaluate(ctx, "org", "proj", "trace-below", "MEDIUM", 65)
	if len(fs.recorded) != 0 {
		t.Fatalf("must not fire below threshold, got %v", fs.recorded)
	}
	e.Evaluate(ctx, "org", "proj", "trace-at", "HIGH", 70) // equal → fires (>=)
	e.Evaluate(ctx, "org", "proj", "trace-above", "HIGH", 95)
	if len(fs.recorded) != 2 {
		t.Fatalf("must fire at and above threshold, got %d events", len(fs.recorded))
	}
}

func TestEvaluateIgnoresZeroScore(t *testing.T) {
	fs := &fakeStore{risk: []store.RiskAlert{{ID: "a1", Threshold: 1}}}
	newEngine(fs, nil).Evaluate(context.Background(), "org", "proj", "t", "LOW", 0)
	if len(fs.recorded) != 0 {
		t.Fatal("score 0 should never fire")
	}
}

func TestEvaluateCostThresholdAndDedup(t *testing.T) {
	ctx := context.Background()

	// Over budget but already fired within the window → skip.
	deduped := &fakeStore{cost: []store.CostAlert{{ID: "c1", Threshold: 10, WindowSec: 3600}}, firedSince: true}
	newEngine(deduped, fakeCost(50)).EvaluateCostAlerts(ctx)
	if len(deduped.recorded) != 0 {
		t.Fatal("must not re-fire within the same window")
	}

	// Over budget, not yet fired → fire once.
	fresh := &fakeStore{cost: []store.CostAlert{{ID: "c1", Threshold: 10, WindowSec: 3600}}}
	newEngine(fresh, fakeCost(50)).EvaluateCostAlerts(ctx)
	if len(fresh.recorded) != 1 {
		t.Fatalf("must fire when over budget, got %d", len(fresh.recorded))
	}

	// Under budget → no fire.
	under := &fakeStore{cost: []store.CostAlert{{ID: "c1", Threshold: 100, WindowSec: 3600}}}
	newEngine(under, fakeCost(50)).EvaluateCostAlerts(ctx)
	if len(under.recorded) != 0 {
		t.Fatal("must not fire under budget")
	}
}
