// SPDX-License-Identifier: FSL-1.1-ALv2
// Package notify delivers fired-alert notifications to external channels.
// Delivery is best-effort and fully out-of-band: dispatch runs on detached
// background goroutines (bounded), so a slow or hung webhook never blocks
// ingestion, risk scoring, or the cost evaluator.
//
// Channel routing:
//   - webhook: per-alert URL from config.webhook_url, falls back to ALERT_WEBHOOK_URL.
//   - slack:   per-alert URL from config.slack_webhook_url, falls back to ALERT_SLACK_WEBHOOK_URL.
//   - email:   SMTP via SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS; recipient is
//     config.email_to or the account email.
//
// Outbound webhook/Slack URLs are validated against SSRF (scheme + private/
// loopback/link-local/metadata IPs are rejected) unless an operator opts in with
// ALERT_ALLOW_PRIVATE_WEBHOOKS=true (for trusted single-tenant self-host).
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
)

// maxConcurrentDeliveries bounds in-flight notification goroutines so a burst of
// fired alerts (or slow endpoints) can't spawn unbounded work.
const maxConcurrentDeliveries = 64

// deliveryTimeout caps the total time for one event's dispatch across channels.
const deliveryTimeout = 15 * time.Second

// Notifier sends alert notifications to configured channels.
type Notifier struct {
	client       *http.Client
	logger       *zap.Logger
	appURL       string // base URL used in email links
	webhookURL   string // global fallback
	slackURL     string // global fallback
	smtpHost     string
	smtpPort     string
	smtpUser     string
	smtpPass     string
	smtpFrom     string
	allowPrivate bool          // permit webhooks to private/loopback hosts (self-host opt-in)
	sem          chan struct{} // bounds concurrent deliveries
}

// New builds a Notifier from environment configuration.
func New(logger *zap.Logger) *Notifier {
	smtpFrom := os.Getenv("SMTP_FROM")
	if smtpFrom == "" {
		smtpFrom = os.Getenv("SMTP_USER")
	}
	appURL := firstNonEmpty(os.Getenv("APP_URL"), os.Getenv("NEXT_PUBLIC_APP_URL"), "http://localhost:3000")
	allowPrivate := strings.EqualFold(os.Getenv("ALERT_ALLOW_PRIVATE_WEBHOOKS"), "true")

	client := &http.Client{Timeout: 5 * time.Second}
	if !allowPrivate {
		// Pin SSRF validation to the ACTUAL dial address. Checking the URL once in
		// post() and letting http.Client re-resolve at dial time is a TOCTOU hole
		// (DNS rebinding: answer public on the first lookup, 169.254.169.254 on
		// the second). guardedDialContext resolves, rejects any blocked IP, then
		// dials the vetted IP directly so no unchecked re-resolution can occur.
		client.Transport = &http.Transport{DialContext: guardedDialContext}
	}

	return &Notifier{
		client:       client,
		logger:       logger,
		appURL:       strings.TrimRight(appURL, "/"),
		webhookURL:   os.Getenv("ALERT_WEBHOOK_URL"),
		slackURL:     os.Getenv("ALERT_SLACK_WEBHOOK_URL"),
		smtpHost:     os.Getenv("SMTP_HOST"),
		smtpPort:     os.Getenv("SMTP_PORT"),
		smtpUser:     os.Getenv("SMTP_USER"),
		smtpPass:     os.Getenv("SMTP_PASS"),
		smtpFrom:     smtpFrom,
		allowPrivate: allowPrivate,
		sem:          make(chan struct{}, maxConcurrentDeliveries),
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

// ChannelConfig carries per-alert channel destinations (from the alert config
// JSON). Empty fields fall back to global env configuration.
type ChannelConfig struct {
	WebhookURL      string `json:"webhook_url"`
	SlackWebhookURL string `json:"slack_webhook_url"`
	EmailTo         string `json:"email_to"`
}

// Fire dispatches an event to each requested channel (global config only).
func (n *Notifier) Fire(ctx context.Context, channels []string, e Event) {
	n.FireWithConfig(ctx, channels, e, ChannelConfig{})
}

// FireWithConfig dispatches an event out-of-band: it detaches from the caller's
// context (so a canceled request/message context can't kill delivery) and runs
// on a bounded background goroutine. It returns immediately.
func (n *Notifier) FireWithConfig(_ context.Context, channels []string, e Event, cfg ChannelConfig) {
	if n == nil || len(channels) == 0 {
		return
	}
	select {
	case n.sem <- struct{}{}:
	default:
		n.logger.Warn("alert delivery queue full — dropping notification",
			zap.String("alert", e.AlertName), zap.String("trace_id", e.TraceID))
		return
	}
	go func() {
		defer func() { <-n.sem }()
		ctx, cancel := context.WithTimeout(context.Background(), deliveryTimeout)
		defer cancel()
		n.dispatch(ctx, channels, e, cfg)
	}()
}

// dispatch delivers to each channel synchronously. Exported behaviour goes
// through FireWithConfig; this is separated for testability.
func (n *Notifier) dispatch(ctx context.Context, channels []string, e Event, cfg ChannelConfig) {
	for _, ch := range channels {
		switch ch {
		case "webhook":
			n.post(ctx, firstNonEmpty(cfg.WebhookURL, n.webhookURL), n.genericBody(e), "webhook")
		case "slack":
			n.post(ctx, firstNonEmpty(cfg.SlackWebhookURL, n.slackURL), n.slackBody(e), "slack")
		case "email":
			n.sendEmail(cfg.EmailTo, e)
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

func (n *Notifier) sendEmail(to string, e Event) {
	if to == "" {
		n.logger.Debug("alert email: no recipient configured")
		return
	}
	if n.smtpHost == "" || n.smtpPort == "" {
		n.logger.Info("alert fired (email channel: SMTP not configured, event recorded only)",
			zap.String("alert", e.AlertName), zap.String("trace_id", e.TraceID))
		return
	}

	// Validate recipients: reject anything that isn't a well-formed address, so a
	// config value containing CR/LF can't inject extra SMTP headers/recipients.
	var recipients []string
	for _, raw := range strings.Split(to, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		addr, err := mail.ParseAddress(raw)
		if err != nil {
			n.logger.Warn("alert email: skipping invalid recipient", zap.String("to", raw), zap.Error(err))
			continue
		}
		// Use the bare address, not the raw "Name <addr>" form, so SMTP RCPT TO
		// gets a valid mailbox even when a display name is configured.
		recipients = append(recipients, addr.Address)
	}
	if len(recipients) == 0 {
		n.logger.Warn("alert email: no valid recipients", zap.String("alert", e.AlertName))
		return
	}

	// Strip CR/LF from any header-bound field (alert name flows into Subject) so
	// a crafted alert name can't inject headers either.
	subject := stripCRLF(fmt.Sprintf("[Splyntra] Alert: %s — %s (score %d)", e.AlertName, e.Severity, e.RiskScore))
	body := fmt.Sprintf(
		"Alert: %s\nSeverity: %s\nRisk Score: %d\nTrace ID: %s\nProject: %s\n\nView trace: %s/traces/%s",
		e.AlertName, e.Severity, e.RiskScore, e.TraceID, e.ProjectID, n.appURL, e.TraceID,
	)
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s",
		n.smtpFrom, strings.Join(recipients, ", "), subject, body)

	addr := n.smtpHost + ":" + n.smtpPort
	var auth smtp.Auth
	if n.smtpUser != "" {
		auth = smtp.PlainAuth("", n.smtpUser, n.smtpPass, n.smtpHost)
	}
	if err := smtp.SendMail(addr, auth, n.smtpFrom, recipients, []byte(msg)); err != nil {
		n.logger.Warn("alert email delivery failed",
			zap.String("alert", e.AlertName), zap.String("to", to), zap.Error(err))
		return
	}
	n.logger.Info("alert email sent", zap.String("alert", e.AlertName), zap.String("to", to))
}

func (n *Notifier) post(ctx context.Context, rawURL string, body []byte, channel string) {
	if rawURL == "" {
		n.logger.Debug("alert channel not configured", zap.String("channel", channel))
		return
	}
	if !n.allowPrivate && !safeURL(rawURL) {
		n.logger.Warn("alert delivery blocked: destination failed SSRF check (set ALERT_ALLOW_PRIVATE_WEBHOOKS=true to permit private hosts)",
			zap.String("channel", channel), zap.String("url", rawURL))
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
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

// ValidateURL reports whether a webhook/Slack URL is acceptable as a delivery
// destination — used both at alert-create time (fail fast) and at send time.
func ValidateURL(raw string) bool { return safeURL(raw) }

// safeURL guards against SSRF: only http(s), and the host must not resolve to a
// loopback, private, link-local, or unspecified address (blocks 127.0.0.1,
// 10/8, 192.168/16, 169.254.169.254 cloud metadata, ::1, etc.).
func safeURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := u.Hostname()
	if host == "" {
		return false
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return false
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return false
		}
	}
	return true
}

// isBlockedIP reports whether an address must be refused as an SSRF risk
// (loopback, private, link-local incl. 169.254.169.254 cloud metadata, or
// unspecified).
func isBlockedIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

// guardedDialContext resolves the target host, refuses if ANY resolved address
// is blocked (so a host answering both a public and a private IP can't slip
// through), then dials the vetted IPs directly — pinning the checked address so
// http.Client performs no second, unchecked DNS resolution (TOCTOU-proof).
func guardedDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("no addresses for host %q", host)
	}
	for _, ipa := range ips {
		if isBlockedIP(ipa.IP) {
			return nil, fmt.Errorf("blocked address %s for host %q (SSRF)", ipa.IP, host)
		}
	}
	var dialer net.Dialer
	var lastErr error
	for _, ipa := range ips {
		conn, derr := dialer.DialContext(ctx, network, net.JoinHostPort(ipa.IP.String(), port))
		if derr == nil {
			return conn, nil
		}
		lastErr = derr
	}
	return nil, lastErr
}

// stripCRLF removes carriage returns and newlines so a value can be safely
// interpolated into an email header without injecting additional headers.
func stripCRLF(s string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(s)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
