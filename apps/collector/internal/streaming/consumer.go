// SPDX-License-Identifier: FSL-1.1-ALv2
package streaming

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.uber.org/zap"
)

// maxProcessedKeys bounds the redelivery-dedup set. JetStream is at-least-once,
// so a result whose write succeeded but whose Ack was lost is redelivered and
// reprocessed — double-adding to traces.detection_count. We remember recently
// processed message identities and skip the write on an exact-duplicate
// redelivery. (Detection ROWS are already idempotent — the detections table is a
// ReplacingMergeTree — so only the count increment needs this guard.)
const maxProcessedKeys = 100_000

// DetectionResult is the message published by the detector service.
type DetectionResult struct {
	TraceID    string           `json:"trace_id"`
	SpanID     string           `json:"span_id"`
	AgentID    string           `json:"agent_id"`
	OrgID      string           `json:"org_id"`
	ProjectID  string           `json:"project_id"`
	RiskScore  int              `json:"risk_score"`
	Detections []DetectionEntry `json:"detections"`
}

type DetectionEntry struct {
	Detector    string  `json:"detector"`
	Category    string  `json:"category"`
	Severity    string  `json:"severity"`
	Confidence  float32 `json:"confidence"`
	Description string  `json:"description"`
	Beta        bool    `json:"beta"`
}

// DetectionConsumer consumes detection results from NATS and writes to storage.
type DetectionConsumer struct {
	nc        *nats.Conn
	js        jetstream.JetStream
	logger    *zap.Logger
	store     DetectionStore
	evaluator AlertEvaluator
	exporter  Exporter
	cancel    context.CancelFunc

	processedMu sync.Mutex
	processed   map[uint64]struct{} // recently-applied message identities (redelivery dedup)
}

// DetectionStore is the interface the consumer needs to persist detections.
type DetectionStore interface {
	InsertDetectionResult(ctx context.Context, result *DetectionResult) error
	UpdateTraceRisk(ctx context.Context, traceID, orgID, projectID string, riskScore int, severity string, detectionCount int) error
}

// AlertEvaluator evaluates a scored trace against configured alerts. It is
// optional; a nil evaluator disables alert evaluation.
type AlertEvaluator interface {
	Evaluate(ctx context.Context, orgID, projectID, traceID, severity string, riskScore int)
}

// SetAlertEvaluator attaches an alert evaluator invoked after each trace is scored.
func (c *DetectionConsumer) SetAlertEvaluator(e AlertEvaluator) {
	c.evaluator = e
}

// Exporter forwards detection results to an external sink (SIEM / Datadog /
// Splunk / generic webhook), making Splyntra a source and not just a sink.
// Optional; a nil exporter disables forwarding.
type Exporter interface {
	Export(ctx context.Context, result *DetectionResult)
}

// SetExporter attaches an outbound exporter invoked after each detection result
// is persisted.
func (c *DetectionConsumer) SetExporter(e Exporter) {
	c.exporter = e
}

func NewDetectionConsumer(natsURL string, logger *zap.Logger, store DetectionStore) (*DetectionConsumer, error) {
	nc, err := nats.Connect(natsURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(60),
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

	return &DetectionConsumer{
		nc:        nc,
		js:        js,
		logger:    logger,
		store:     store,
		processed: make(map[uint64]struct{}, maxProcessedKeys),
	}, nil
}

// Start begins consuming detection results. Call in a goroutine.
func (c *DetectionConsumer) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel

	cons, err := c.js.CreateOrUpdateConsumer(ctx, StreamName, jetstream.ConsumerConfig{
		Durable:       "collector-detection-consumer",
		FilterSubject: "splyntra.detections.result",
		AckPolicy:     jetstream.AckExplicitPolicy,
		AckWait:       30 * time.Second,
		MaxDeliver:    5,
	})
	if err != nil {
		return fmt.Errorf("create consumer: %w", err)
	}

	c.logger.Info("detection result consumer started")

	iter, err := cons.Messages(jetstream.PullMaxMessages(10))
	if err != nil {
		return fmt.Errorf("create message iterator: %w", err)
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				iter.Stop()
				return
			default:
			}

			msg, err := iter.Next()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				c.logger.Error("fetch message failed", zap.Error(err))
				time.Sleep(time.Second)
				continue
			}

			if err := c.processMessage(ctx, msg); err != nil {
				c.logger.Error("process detection result failed", zap.Error(err))
				_ = msg.Nak()
			} else {
				_ = msg.Ack()
			}
		}
	}()

	return nil
}

func (c *DetectionConsumer) processMessage(ctx context.Context, msg jetstream.Msg) error {
	var result DetectionResult
	if err := json.Unmarshal(msg.Data(), &result); err != nil {
		// Bad message - terminate (dead letter)
		_ = msg.Term()
		return fmt.Errorf("unmarshal detection result: %w", err)
	}

	if result.TraceID == "" {
		_ = msg.Term()
		return fmt.Errorf("empty trace_id in detection result")
	}

	// Redelivery dedup: skip an exact-duplicate message we already applied, so a
	// lost Ack doesn't double-count detections. Keyed on the raw payload, so a
	// legitimately different result for the same span (e.g. re-detection) is NOT
	// skipped.
	key := fnv64(msg.Data())
	if c.alreadyProcessed(key) {
		c.logger.Debug("skipping duplicate detection result (redelivery)",
			zap.String("trace_id", result.TraceID), zap.String("span_id", result.SpanID))
		return nil // ack — already applied
	}

	// Write individual detections
	if err := c.store.InsertDetectionResult(ctx, &result); err != nil {
		return fmt.Errorf("insert detections: %w", err)
	}

	// Compute risk severity from score
	severity := riskSeverityFromScore(result.RiskScore)

	// Update trace with risk info
	if err := c.store.UpdateTraceRisk(ctx, result.TraceID, result.OrgID, result.ProjectID,
		result.RiskScore, severity, len(result.Detections)); err != nil {
		return fmt.Errorf("update trace risk: %w", err)
	}

	// Mark applied only after a successful write, so a mid-write failure is
	// retried rather than skipped.
	c.markProcessed(key)

	// Evaluate configured alerts against the freshly-scored trace.
	if c.evaluator != nil {
		c.evaluator.Evaluate(ctx, result.OrgID, result.ProjectID, result.TraceID, severity, result.RiskScore)
	}

	// Forward the detection result to an external SIEM/webhook, if configured.
	if c.exporter != nil {
		c.exporter.Export(ctx, &result)
	}

	c.logger.Info("detection result processed",
		zap.String("trace_id", result.TraceID),
		zap.Int("detections", len(result.Detections)),
		zap.Int("risk_score", result.RiskScore),
	)

	return nil
}

func fnv64(b []byte) uint64 {
	h := fnv.New64a()
	_, _ = h.Write(b)
	return h.Sum64()
}

func (c *DetectionConsumer) alreadyProcessed(key uint64) bool {
	c.processedMu.Lock()
	defer c.processedMu.Unlock()
	_, ok := c.processed[key]
	return ok
}

func (c *DetectionConsumer) markProcessed(key uint64) {
	c.processedMu.Lock()
	defer c.processedMu.Unlock()
	// Bound memory: the set only needs to cover the redelivery window (seconds),
	// so on overflow drop it wholesale rather than tracking insertion order.
	if len(c.processed) >= maxProcessedKeys {
		c.processed = make(map[uint64]struct{}, maxProcessedKeys)
	}
	c.processed[key] = struct{}{}
}

func riskSeverityFromScore(score int) string {
	switch {
	case score >= 75:
		return "CRITICAL"
	case score >= 50:
		return "HIGH"
	case score >= 25:
		return "MEDIUM"
	case score > 0:
		return "LOW"
	default:
		return "NONE"
	}
}

// Close stops the consumer and closes the NATS connection.
func (c *DetectionConsumer) Close() {
	if c.cancel != nil {
		c.cancel()
	}
	if c.nc != nil {
		_ = c.nc.Drain()
	}
}
