// SPDX-License-Identifier: AGPL-3.0-only
package ingest

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/internal/auth"
	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
	"github.com/splyntra/splyntra/apps/collector/internal/validate"
)

// This file ingests telemetry from out-of-process workflow platforms (Dify,
// n8n) that emit webhooks rather than running an in-process SDK. Each handler
// translates the provider payload into internal TraceEvents and runs them
// through the shared persistTraces path (redaction + validation happen there
// and here, exactly like OTLP/legacy ingestion).

// ─── Dify ───────────────────────────────────────────────────────────────────

// difyPayload models Dify's `workflow_finished` webhook plus an optional list
// of node executions (from `node_finished` events, batched by the caller).
type difyPayload struct {
	Event         string `json:"event"`
	WorkflowRunID string `json:"workflow_run_id"`
	Data          struct {
		ID          string                 `json:"id"`
		WorkflowID  string                 `json:"workflow_id"`
		Status      string                 `json:"status"`
		Outputs     map[string]interface{} `json:"outputs"`
		ElapsedTime float64                `json:"elapsed_time"`
		TotalTokens uint32                 `json:"total_tokens"`
		Error       string                 `json:"error"`
	} `json:"data"`
	Nodes []workflowNode `json:"nodes"`
}

// workflowNode is a generic per-step record shared by the Dify and n8n shapes.
type workflowNode struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Type             string `json:"type"`       // node/tool type label
	Status           string `json:"status"`     // succeeded|failed|ok|error
	ElapsedMs        uint32 `json:"elapsed_ms"` // duration
	Model            string `json:"model"`
	PromptTokens     uint32 `json:"prompt_tokens"`
	CompletionTokens uint32 `json:"completion_tokens"`
	Input            string `json:"input"`
	Output           string `json:"output"`
}

// ReceiveDify ingests a Dify workflow webhook.
func (h *Handler) ReceiveDify(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var p difyPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	traceID := defaultStr(p.WorkflowRunID, p.Data.ID)
	agentID := defaultStr(p.Data.WorkflowID, "dify-workflow")
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, statusFromString(p.Data.Status), p.Data.ElapsedTime)
	h.finishIntegration(w, r, tenantInfo, te, "dify")
}

// ─── n8n ──────────────────────────────────────────────────────────────────

// n8nPayload is the clean contract an n8n workflow assembles (via a Code/HTTP
// node) and POSTs — we deliberately do not parse n8n's volatile internal run
// format.
type n8nPayload struct {
	Workflow struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"workflow"`
	ExecutionID string         `json:"execution_id"`
	Status      string         `json:"status"`
	Nodes       []workflowNode `json:"nodes"`
}

// ReceiveN8N ingests an n8n workflow execution.
func (h *Handler) ReceiveN8N(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var p n8nPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	traceID := defaultStr(p.ExecutionID, p.Workflow.ID)
	agentID := defaultStr(p.Workflow.Name, "n8n-workflow")
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, statusFromString(p.Status), 0)
	h.finishIntegration(w, r, tenantInfo, te, "n8n")
}

// ─── shared translation ─────────────────────────────────────────────────────

// buildIntegrationTrace turns a list of workflow nodes into a TraceEvent with
// redacted span input/output and tenant enrichment.
func (h *Handler) buildIntegrationTrace(
	t *auth.TenantInfo, traceID, agentID string, nodes []workflowNode, traceStatus string, elapsedSec float64,
) *streaming.TraceEvent {
	if traceID == "" {
		traceID = "wf_" + agentID
	}
	tenantAttrs := h.tenantResolver.Enrich(t.OrgID, t.ProjectID, t.Env)
	te := &streaming.TraceEvent{
		TraceID:     traceID,
		OrgID:       t.OrgID,
		ProjectID:   t.ProjectID,
		Environment: t.Env,
		AgentID:     agentID,
		IngestedAt:  time.Now().UTC(),
	}

	now := time.Now().UTC()
	for i, n := range nodes {
		input, _ := h.redactor.RedactString(n.Input)
		output, _ := h.redactor.RedactString(n.Output)
		spanID := n.ID
		if spanID == "" {
			spanID = traceID + "_" + itoa(i)
		}
		te.Spans = append(te.Spans, streaming.SpanEvent{
			TraceID:          traceID,
			SpanID:           spanID,
			OrgID:            t.OrgID,
			ProjectID:        t.ProjectID,
			Type:             nodeSpanType(n.Type, n.Model),
			Name:             defaultStr(n.Name, n.Type),
			Status:           statusFromString(n.Status),
			LatencyMs:        n.ElapsedMs,
			Model:            n.Model,
			PromptTokens:     n.PromptTokens,
			CompletionTokens: n.CompletionTokens,
			Attributes:       mergeAttrs(nil, tenantAttrs),
			StartedAt:        now,
			RawInput:         input,
			RawOutput:        output,
		})
	}

	// If the provider sent no node breakdown, synthesize a single agent span so
	// the run is still visible end-to-end.
	if len(te.Spans) == 0 {
		te.Spans = append(te.Spans, streaming.SpanEvent{
			TraceID:    traceID,
			SpanID:     traceID + "_0",
			OrgID:      t.OrgID,
			ProjectID:  t.ProjectID,
			Type:       "agent",
			Name:       agentID,
			Status:     traceStatus,
			LatencyMs:  uint32(elapsedSec * 1000),
			Attributes: mergeAttrs(nil, tenantAttrs),
			StartedAt:  now,
		})
	}
	return te
}

func (h *Handler) finishIntegration(
	w http.ResponseWriter, r *http.Request, t *auth.TenantInfo, te *streaming.TraceEvent, framework string,
) {
	if err := validate.ValidateTrace(te); err != nil {
		h.logger.Warn("integration validation failed", zap.String("framework", framework), zap.Error(err))
		http.Error(w, `{"error":"`+jsonEscape(err.Error())+`"}`, http.StatusBadRequest)
		return
	}
	spanCount := h.persistTraces(r.Context(), []*streaming.TraceEvent{te}, frameworkByTrace{te.TraceID: framework})
	h.logger.Info("integration ingest",
		zap.String("framework", framework),
		zap.String("org", t.OrgID),
		zap.String("trace", te.TraceID),
		zap.Int("spans", spanCount),
	)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"accepted": 1, "spans": spanCount, "trace_id": te.TraceID,
	})
}

// nodeSpanType maps a provider node type to an internal span type.
func nodeSpanType(nodeType, model string) string {
	lt := strings.ToLower(nodeType)
	switch {
	case model != "" || strings.Contains(lt, "llm") || strings.Contains(lt, "model") || strings.Contains(lt, "agent"):
		return "llm_call"
	case strings.Contains(lt, "tool") || strings.Contains(lt, "http") || strings.Contains(lt, "code") || strings.Contains(lt, "function"):
		return "tool_call"
	default:
		return "step"
	}
}

func statusFromString(s string) string {
	switch strings.ToLower(s) {
	case "failed", "error", "errored":
		return "error"
	default:
		return "ok"
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(b[pos:])
}
