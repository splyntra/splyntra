// SPDX-License-Identifier: AGPL-3.0-only
// Package notify delivers fired-alert notifications to external channels.
// Delivery is best-effort and fully out-of-band: a failed webhook never blocks
// ingestion or risk scoring. Channels are configured per-alert; the URLs come
// from collector environment (one shared destination per channel type in the
// MVP — per-alert routing is a post-MVP enhancement).
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"go.uber.org/zap"
)

// Notifier sends alert notifications to configured channels.
type Notifier struct {
	client     *http.Client
	logger     *zap.Logger
	webhookURL string
	slackURL   string
}

// New builds a Notifier from environment configuration. ALERT_WEBHOOK_URL and
// ALERT_SLACK_WEBHOOK_URL are both optional; an unset channel is skipped.
func New(logger *zap.Logger) *Notifier {
	return &Notifier{
		client:     &http.Client{Timeout: 5 * time.Second},
		logger:     logger,
		webhookURL: os.Getenv("ALERT_WEBHOOK_URL"),
		slackURL:   os.Getenv("ALERT_SLACK_WEBHOOK_URL"),
	}
}

// Event is the payload describing a fired alert.
type Event struct {
	AlertName string `json:"alert_name"`
	TraceID   string `json:"trace_id"`
	RiskScore int    `json:"risk_score"`
	Severity  string `json:"severity"`
	ProjectID string `json:"project_id"`
}

// Fire dispatches an event to each requested channel. Errors are logged, not
// returned, so callers can fire-and-forget.
func (n *Notifier) Fire(ctx context.Context, channels []string, e Event) {
	if n == nil {
		return
	}
	for _, ch := range channels {
		switch ch {
		case "webhook":
			n.post(ctx, n.webhookURL, n.genericBody(e), "webhook")
		case "slack":
			n.post(ctx, n.slackURL, n.slackBody(e), "slack")
		case "email":
			// Email delivery requires an SMTP/provider integration that is out
			// of scope for the MVP; the event is still persisted to history.
			n.logger.Info("alert fired (email channel: recorded to history only)",
				zap.String("alert", e.AlertName), zap.String("trace_id", e.TraceID))
		default:
			n.logger.Debug("unknown alert channel", zap.String("channel", ch))
		}
	}
}

func (n *Notifier) genericBody(e Event) []byte {
	b, _ := json.Marshal(e)
	return b
}

func (n *Notifier) slackBody(e Event) []byte {
	text := fmt.Sprintf(":rotating_light: *%s* — trace `%s` scored *%d* (%s)",
		e.AlertName, e.TraceID, e.RiskScore, e.Severity)
	b, _ := json.Marshal(map[string]string{"text": text})
	return b
}

func (n *Notifier) post(ctx context.Context, url string, body []byte, channel string) {
	if url == "" {
		n.logger.Debug("alert channel not configured", zap.String("channel", channel))
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		n.logger.Warn("build alert request failed", zap.String("channel", channel), zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		n.logger.Warn("alert delivery failed", zap.String("channel", channel), zap.Error(err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		n.logger.Warn("alert delivery non-2xx", zap.String("channel", channel), zap.Int("status", resp.StatusCode))
	}
}
