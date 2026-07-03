// SPDX-License-Identifier: AGPL-3.0-only
// Package export forwards detection results to an external sink — a SIEM,
// Datadog, Splunk HEC, or a generic webhook — so Splyntra is a data *source*,
// not only a sink. Enabled by SPLYNTRA_EXPORT_URL; a no-op otherwise.
package export

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
	"go.uber.org/zap"
)

// Webhook POSTs each detection result as JSON to a configured URL. Forwarding is
// best-effort and fire-and-forget: a slow or failing sink never blocks or breaks
// the detection pipeline.
type Webhook struct {
	url    string
	token  string
	client *http.Client
	logger *zap.Logger
}

// NewWebhook returns a streaming.Exporter. If url is empty it returns nil, so the
// caller can skip SetExporter and keep the no-op default.
func NewWebhook(url, token string, logger *zap.Logger) *Webhook {
	if url == "" {
		return nil
	}
	return &Webhook{
		url:    url,
		token:  token,
		client: &http.Client{Timeout: 5 * time.Second},
		logger: logger,
	}
}

// Export implements streaming.Exporter. It copies the result and forwards it on a
// background goroutine so the consumer is never blocked by the sink.
func (w *Webhook) Export(ctx context.Context, result *streaming.DetectionResult) {
	if result == nil || len(result.Detections) == 0 {
		return
	}
	// Copy: the caller's pointer references a stack value reused after we return.
	payload := *result
	go w.send(&payload)
}

func (w *Webhook) send(result *streaming.DetectionResult) {
	body, err := json.Marshal(map[string]any{
		"source":     "splyntra",
		"type":       "detections",
		"trace_id":   result.TraceID,
		"agent_id":   result.AgentID,
		"org_id":     result.OrgID,
		"project_id": result.ProjectID,
		"risk_score": result.RiskScore,
		"detections": result.Detections,
	})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if w.token != "" {
		req.Header.Set("Authorization", "Bearer "+w.token)
	}

	resp, err := w.client.Do(req)
	if err != nil {
		w.logger.Warn("detection export failed", zap.Error(err), zap.String("trace_id", result.TraceID))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		w.logger.Warn("detection export non-2xx", zap.Int("status", resp.StatusCode), zap.String("trace_id", result.TraceID))
	}
}
