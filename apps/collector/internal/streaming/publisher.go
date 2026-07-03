// SPDX-License-Identifier: AGPL-3.0-only
package streaming

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.uber.org/zap"
)

const (
	StreamName    = "SPLYNTRA"
	SubjectTraces = "splyntra.traces"
	SubjectSpans  = "splyntra.spans"
	SubjectDetect = "splyntra.detect"
)

// Publisher publishes trace/span data to NATS JetStream.
type Publisher struct {
	nc     *nats.Conn
	js     jetstream.JetStream
	logger *zap.Logger
}

// TraceEvent is the message published for a complete trace.
type TraceEvent struct {
	TraceID     string      `json:"trace_id"`
	OrgID       string      `json:"org_id"`
	ProjectID   string      `json:"project_id"`
	Environment string      `json:"environment"`
	AgentID     string      `json:"agent_id"`
	Platform    string      `json:"platform,omitempty"`         // '' = agent; else platform id (dify/n8n/…)
	WorkflowID  string      `json:"workflow_id,omitempty"`
	WorkflowName    string  `json:"workflow_name,omitempty"`
	WorkflowVersion string  `json:"workflow_version,omitempty"`
	Spans       []SpanEvent `json:"spans"`
	IngestedAt  time.Time   `json:"ingested_at"`
}

// SpanEvent is the message for a single span.
type SpanEvent struct {
	TraceID          string            `json:"trace_id"`
	SpanID           string            `json:"span_id"`
	ParentSpanID     string            `json:"parent_span_id,omitempty"`
	OrgID            string            `json:"org_id"`
	ProjectID        string            `json:"project_id"`
	AgentID          string            `json:"agent_id,omitempty"` // denormalized from the trace for per-agent detection keying
	Type             string            `json:"type"` // agent, llm_call, tool_call, step
	Name             string            `json:"name"`
	Status           string            `json:"status"`
	LatencyMs        uint32            `json:"latency_ms"`
	Model            string            `json:"model,omitempty"`
	PromptTokens     uint32            `json:"prompt_tokens,omitempty"`
	CompletionTokens uint32            `json:"completion_tokens,omitempty"`
	CostUSD          float64           `json:"cost_usd,omitempty"`
	Attributes       map[string]string `json:"attributes,omitempty"`
	StartedAt        time.Time         `json:"started_at"`
	// Raw input/output for detection (will be redacted before storage)
	RawInput  string `json:"raw_input,omitempty"`
	RawOutput string `json:"raw_output,omitempty"`
}

func NewPublisher(natsURL string, logger *zap.Logger) (*Publisher, error) {
	nc, err := nats.Connect(natsURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(10),
		nats.ReconnectWait(2*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("nats connect: %w", err)
	}

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("jetstream new: %w", err)
	}

	// Ensure the stream exists
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:      StreamName,
		Subjects:  []string{"splyntra.>"},
		Storage:   jetstream.FileStorage,
		Retention: jetstream.LimitsPolicy,
		MaxAge:    24 * time.Hour,
		Replicas:  1,
	})
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("create stream: %w", err)
	}

	logger.Info("NATS JetStream publisher connected", zap.String("stream", StreamName))

	return &Publisher{nc: nc, js: js, logger: logger}, nil
}

// PublishTrace publishes a full trace event (for storage).
func (p *Publisher) PublishTrace(ctx context.Context, evt *TraceEvent) error {
	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal trace: %w", err)
	}

	_, err = p.js.Publish(ctx, SubjectTraces, data)
	if err != nil {
		p.logger.Error("publish trace failed", zap.Error(err), zap.String("trace_id", evt.TraceID))
		return fmt.Errorf("publish trace: %w", err)
	}

	return nil
}

// PublishSpan publishes a single span event (for storage + detection fan-out).
func (p *Publisher) PublishSpan(ctx context.Context, evt *SpanEvent) error {
	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal span: %w", err)
	}

	_, err = p.js.Publish(ctx, SubjectSpans, data)
	if err != nil {
		p.logger.Error("publish span failed", zap.Error(err), zap.String("span_id", evt.SpanID))
		return fmt.Errorf("publish span: %w", err)
	}

	return nil
}

// PublishForDetection publishes content to the detection subject for the detector sidecar.
func (p *Publisher) PublishForDetection(ctx context.Context, evt *SpanEvent) error {
	// Only publish if there's content to analyze
	if evt.RawInput == "" && evt.RawOutput == "" {
		return nil
	}

	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal detect: %w", err)
	}

	_, err = p.js.Publish(ctx, SubjectDetect, data)
	if err != nil {
		p.logger.Error("publish detect failed", zap.Error(err), zap.String("span_id", evt.SpanID))
		return fmt.Errorf("publish detect: %w", err)
	}

	return nil
}

// Close shuts down the NATS connection.
func (p *Publisher) Close() {
	if p.nc != nil {
		_ = p.nc.Drain()
	}
}
