// SPDX-License-Identifier: AGPL-3.0-only
package ingest

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"

	"github.com/splyntra/splyntra/apps/collector/internal/auth"
	"github.com/splyntra/splyntra/apps/collector/internal/redact"
	"github.com/splyntra/splyntra/apps/collector/internal/store"
	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
	"github.com/splyntra/splyntra/apps/collector/internal/tenant"
	"github.com/splyntra/splyntra/apps/collector/internal/validate"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

const maxBodySize = 4 * 1024 * 1024 // 4MB

// Handler processes incoming OTLP trace data.
type Handler struct {
	logger         *zap.Logger
	tenantResolver *tenant.Resolver
	publisher      *streaming.Publisher
	store          *store.ClickHouseStore
	pg             *store.PostgresStore
	redactor       *redact.Redactor
}

func NewHandler(logger *zap.Logger, resolver *tenant.Resolver, publisher *streaming.Publisher, chStore *store.ClickHouseStore, pgStore *store.PostgresStore) *Handler {
	return &Handler{
		logger:         logger,
		tenantResolver: resolver,
		publisher:      publisher,
		store:          chStore,
		pg:             pgStore,
		redactor:       redact.NewRedactor(),
	}
}

// frameworkByTrace carries the framework label discovered per trace during
// conversion so the ingest path can register agent metadata.
type frameworkByTrace map[string]string

// ReceiveTraces handles OTLP /v1/traces (protobuf or JSON).
func (h *Handler) ReceiveTraces(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)

	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var req coltracepb.ExportTraceServiceRequest

	contentType := r.Header.Get("Content-Type")
	switch contentType {
	case "application/x-protobuf", "application/protobuf":
		if err := proto.Unmarshal(body, &req); err != nil {
			http.Error(w, `{"error":"invalid protobuf"}`, http.StatusBadRequest)
			return
		}
	default:
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}
	}

	// Convert OTLP spans to internal events and process
	traceEvents, frameworks := h.otlpToTraceEvents(&req, tenantInfo)

	// Validate before any storage/streaming; reject the batch on first error.
	for _, te := range traceEvents {
		if err := validate.ValidateTrace(te); err != nil {
			h.logger.Warn("trace validation failed", zap.Error(err))
			http.Error(w, `{"error":"`+jsonEscape(err.Error())+`"}`, http.StatusBadRequest)
			return
		}
	}

	spanCount := h.persistTraces(r.Context(), traceEvents, frameworks)

	h.logger.Info("traces received",
		zap.String("org", tenantInfo.OrgID),
		zap.String("project", tenantInfo.ProjectID),
		zap.Int("traces", len(traceEvents)),
		zap.Int("spans", spanCount),
	)

	// OTLP response
	resp := &coltracepb.ExportTraceServiceResponse{}
	respBytes, _ := proto.Marshal(resp)
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
	w.Write(respBytes)
}

// persistTraces publishes traces for detection, writes them to ClickHouse, and
// registers agent metadata. Shared by the OTLP and legacy-event paths. Returns
// the total span count processed.
func (h *Handler) persistTraces(ctx context.Context, traceEvents []*streaming.TraceEvent, frameworks frameworkByTrace) int {
	spanCount := 0
	for _, traceEvt := range traceEvents {
		spanCount += len(traceEvt.Spans)

		// 1. Publish to NATS for async processing (detection)
		if h.publisher != nil {
			if err := h.publisher.PublishTrace(ctx, traceEvt); err != nil {
				h.logger.Error("publish trace failed", zap.Error(err))
			}
			for i := range traceEvt.Spans {
				_ = h.publisher.PublishForDetection(ctx, &traceEvt.Spans[i])
			}
		}

		// 2. Write to ClickHouse
		if h.store != nil {
			if err := h.store.InsertTrace(ctx, traceEvt); err != nil {
				h.logger.Error("store trace failed", zap.Error(err))
			}
			for i := range traceEvt.Spans {
				if err := h.store.InsertSpan(ctx, &traceEvt.Spans[i]); err != nil {
					h.logger.Error("store span failed", zap.Error(err))
				}
			}
		}

		// 3. Register agent metadata (best-effort, never blocks ingest)
		if h.pg != nil && traceEvt.AgentID != "" && traceEvt.AgentID != "unknown" {
			h.pg.UpsertAgent(ctx, traceEvt.OrgID, traceEvt.ProjectID, traceEvt.AgentID, frameworks[traceEvt.TraceID])
		}
	}
	return spanCount
}

func jsonEscape(s string) string {
	b, _ := json.Marshal(s)
	// json.Marshal wraps the string in quotes; strip them.
	return string(b[1 : len(b)-1])
}

// otlpToTraceEvents converts OTLP resource spans into internal trace events.
// It also returns the framework discovered per trace (from resource attributes)
// for agent registration. Tenant metadata is enriched onto every span.
func (h *Handler) otlpToTraceEvents(req *coltracepb.ExportTraceServiceRequest, tenant *auth.TenantInfo) ([]*streaming.TraceEvent, frameworkByTrace) {
	// Group spans by trace_id
	traceMap := make(map[string]*streaming.TraceEvent)
	frameworks := make(frameworkByTrace)

	// Tenant attributes attached to every stored span.
	tenantAttrs := h.tenantResolver.Enrich(tenant.OrgID, tenant.ProjectID, tenant.Env)

	for _, rs := range req.ResourceSpans {
		// Extract agent info from resource attributes
		agentID := "unknown"
		framework := ""
		if rs.Resource != nil {
			for _, attr := range rs.Resource.Attributes {
				switch attr.Key {
				case "service.name", "splyntra.agent.name":
					agentID = attr.Value.GetStringValue()
				case "splyntra.framework":
					framework = attr.Value.GetStringValue()
				}
			}
		}

		for _, ss := range rs.ScopeSpans {
			for _, span := range ss.Spans {
				traceID := hex.EncodeToString(span.TraceId)
				spanID := hex.EncodeToString(span.SpanId)
				parentSpanID := ""
				if len(span.ParentSpanId) > 0 {
					parentSpanID = hex.EncodeToString(span.ParentSpanId)
				}

				// Determine span type from attributes
				spanType := "step"
				var rawInput, rawOutput string
				model := ""
				var promptTokens, completionTokens uint32

				for _, attr := range span.Attributes {
					switch attr.Key {
					case "splyntra.span.type":
						spanType = attr.Value.GetStringValue()
					case "gen_ai.request.model":
						model = attr.Value.GetStringValue()
						if spanType == "step" {
							spanType = "llm_call"
						}
					case "gen_ai.usage.prompt_tokens":
						promptTokens = uint32(attr.Value.GetIntValue())
					case "gen_ai.usage.completion_tokens":
						completionTokens = uint32(attr.Value.GetIntValue())
					case "splyntra.input":
						rawInput = attr.Value.GetStringValue()
					case "splyntra.output":
						rawOutput = attr.Value.GetStringValue()
					}
				}

				// Apply early redaction
				if rawInput != "" {
					rawInput, _ = h.redactor.RedactString(rawInput)
				}
				if rawOutput != "" {
					rawOutput, _ = h.redactor.RedactString(rawOutput)
				}

				latencyMs := uint32((span.EndTimeUnixNano - span.StartTimeUnixNano) / 1_000_000)

				spanEvt := streaming.SpanEvent{
					TraceID:          traceID,
					SpanID:           spanID,
					ParentSpanID:     parentSpanID,
					OrgID:            tenant.OrgID,
					ProjectID:        tenant.ProjectID,
					Type:             spanType,
					Name:             span.Name,
					Status:           otlpStatus(span.Status),
					LatencyMs:        latencyMs,
					Model:            model,
					PromptTokens:     promptTokens,
					CompletionTokens: completionTokens,
					Attributes:       mergeAttrs(otlpAttrsToMap(span.Attributes), tenantAttrs),
					StartedAt:        time.Unix(0, int64(span.StartTimeUnixNano)),
					RawInput:         rawInput,
					RawOutput:        rawOutput,
				}

				// Group into trace
				te, ok := traceMap[traceID]
				if !ok {
					te = &streaming.TraceEvent{
						TraceID:     traceID,
						OrgID:       tenant.OrgID,
						ProjectID:   tenant.ProjectID,
						Environment: tenant.Env,
						AgentID:     agentID,
						IngestedAt:  time.Now().UTC(),
					}
					traceMap[traceID] = te
					frameworks[traceID] = framework
				}
				te.Spans = append(te.Spans, spanEvt)
			}
		}
	}

	// Extract workflow from span attributes
	result := make([]*streaming.TraceEvent, 0, len(traceMap))
	for _, te := range traceMap {
		for _, sp := range te.Spans {
			if wf, ok := sp.Attributes["splyntra.workflow"]; ok && wf != "" {
				te.WorkflowID = wf
				break
			}
		}
		result = append(result, te)
	}
	return result, frameworks
}

// mergeAttrs overlays tenant attributes onto span attributes, allocating a map
// if the span had none. Tenant keys win so stored spans always carry the
// resolved org/project/env.
func mergeAttrs(attrs, tenantAttrs map[string]string) map[string]string {
	if attrs == nil {
		attrs = make(map[string]string, len(tenantAttrs))
	}
	for k, v := range tenantAttrs {
		attrs[k] = v
	}
	return attrs
}

func otlpStatus(s interface{}) string {
	if s == nil {
		return "ok"
	}
	if status, ok := s.(*tracepb.Status); ok && status != nil {
		switch status.Code {
		case tracepb.Status_STATUS_CODE_ERROR:
			return "error"
		case tracepb.Status_STATUS_CODE_OK:
			return "ok"
		default:
			return "unset"
		}
	}
	return "ok"
}

func otlpAttrsToMap(attrs []*commonpb.KeyValue) map[string]string {
	if len(attrs) == 0 {
		return nil
	}
	m := make(map[string]string, len(attrs))
	for _, attr := range attrs {
		v := attr.Value
		switch val := v.Value.(type) {
		case *commonpb.AnyValue_StringValue:
			m[attr.Key] = val.StringValue
		case *commonpb.AnyValue_IntValue:
			m[attr.Key] = fmt.Sprintf("%d", val.IntValue)
		case *commonpb.AnyValue_DoubleValue:
			m[attr.Key] = fmt.Sprintf("%g", val.DoubleValue)
		case *commonpb.AnyValue_BoolValue:
			m[attr.Key] = fmt.Sprintf("%t", val.BoolValue)
		default:
			m[attr.Key] = fmt.Sprintf("%v", v.GetStringValue())
		}
	}
	return m
}

// legacyTrace is the JSON event shape accepted by /v1/events for clients that
// post traces directly rather than via OTLP. It supports two forms:
//   - nested: {"trace_id":"...","spans":[{...},{...}]}
//   - flat single span: {"trace_id":"...","span_id":"...","name":"...", ...}
//
// The flat form embeds legacySpan, so a single-span event needs no "spans"
// array (this preserves backwards compatibility with existing clients).
type legacyTrace struct {
	TraceID    string       `json:"trace_id"`
	AgentID    string       `json:"agent_id"`
	WorkflowID string       `json:"workflow_id"`
	Framework  string       `json:"framework"`
	Spans      []legacySpan `json:"spans"`
	legacySpan              // flat single-span fields
}

type legacySpan struct {
	SpanID           string            `json:"span_id"`
	ParentSpanID     string            `json:"parent_span_id"`
	Type             string            `json:"type"`
	Name             string            `json:"name"`
	Status           string            `json:"status"`
	LatencyMs        uint32            `json:"latency_ms"`
	Model            string            `json:"model"`
	PromptTokens     uint32            `json:"prompt_tokens"`
	CompletionTokens uint32            `json:"completion_tokens"`
	Input            string            `json:"input"`
	Output           string            `json:"output"`
	StartedAt        *time.Time        `json:"started_at"`
	Attributes       map[string]string `json:"attributes"`
}

// spans returns the trace's spans, synthesizing a single span from the flat
// embedded fields when no "spans" array was supplied.
func (lt legacyTrace) effectiveSpans() []legacySpan {
	if len(lt.Spans) > 0 {
		return lt.Spans
	}
	if lt.legacySpan.SpanID != "" || lt.legacySpan.Name != "" || lt.legacySpan.Model != "" {
		s := lt.legacySpan
		if s.SpanID == "" {
			s.SpanID = lt.TraceID + "_0"
		}
		return []legacySpan{s}
	}
	return nil
}

// ReceiveEvents handles the legacy /v1/events endpoint (JSON). It accepts a
// single trace object or an array of them, applies redaction + validation, and
// runs them through the same persistence path as OTLP ingestion.
func (h *Handler) ReceiveEvents(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)

	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var traces []legacyTrace
	if err := json.Unmarshal(body, &traces); err != nil {
		var single legacyTrace
		if err := json.Unmarshal(body, &single); err != nil {
			http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
			return
		}
		traces = []legacyTrace{single}
	}

	tenantAttrs := h.tenantResolver.Enrich(tenantInfo.OrgID, tenantInfo.ProjectID, tenantInfo.Env)
	traceEvents := make([]*streaming.TraceEvent, 0, len(traces))
	frameworks := make(frameworkByTrace, len(traces))

	for _, lt := range traces {
		te := &streaming.TraceEvent{
			TraceID:     lt.TraceID,
			OrgID:       tenantInfo.OrgID,
			ProjectID:   tenantInfo.ProjectID,
			Environment: tenantInfo.Env,
			AgentID:     defaultStr(lt.AgentID, "unknown"),
			WorkflowID:  lt.WorkflowID,
			IngestedAt:  time.Now().UTC(),
		}
		for _, ls := range lt.effectiveSpans() {
			input, _ := h.redactor.RedactString(ls.Input)
			output, _ := h.redactor.RedactString(ls.Output)
			started := time.Now().UTC()
			if ls.StartedAt != nil {
				started = *ls.StartedAt
			}
			te.Spans = append(te.Spans, streaming.SpanEvent{
				TraceID:          lt.TraceID,
				SpanID:           ls.SpanID,
				ParentSpanID:     ls.ParentSpanID,
				OrgID:            tenantInfo.OrgID,
				ProjectID:        tenantInfo.ProjectID,
				Type:             defaultStr(ls.Type, "step"),
				Name:             ls.Name,
				Status:           defaultStr(ls.Status, "ok"),
				LatencyMs:        ls.LatencyMs,
				Model:            ls.Model,
				PromptTokens:     ls.PromptTokens,
				CompletionTokens: ls.CompletionTokens,
				Attributes:       mergeAttrs(ls.Attributes, tenantAttrs),
				StartedAt:        started,
				RawInput:         input,
				RawOutput:        output,
			})
		}
		if err := validate.ValidateTrace(te); err != nil {
			h.logger.Warn("event validation failed", zap.Error(err))
			http.Error(w, `{"error":"`+jsonEscape(err.Error())+`"}`, http.StatusBadRequest)
			return
		}
		traceEvents = append(traceEvents, te)
		frameworks[te.TraceID] = lt.Framework
	}

	spanCount := h.persistTraces(r.Context(), traceEvents, frameworks)

	h.logger.Info("events received",
		zap.String("org", tenantInfo.OrgID),
		zap.String("project", tenantInfo.ProjectID),
		zap.Int("traces", len(traceEvents)),
		zap.Int("spans", spanCount),
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"accepted":  len(traceEvents),
		"spans":     spanCount,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func defaultStr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
