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
// n8n, Flowise) that emit webhooks rather than running an in-process SDK. Each
// handler translates the provider payload into internal TraceEvents and runs
// them through the shared persistTraces path (redaction + validation happen
// there and here, exactly like OTLP/legacy ingestion).
//
// Every run is rendered as a root `agent` span with the provider's steps as
// child spans (parent_span_id set), sequenced by their reported durations, so
// the dashboard shows a real waterfall rather than a flat list.

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

// workflowNode is a generic per-step record shared by the Dify/n8n/Flowise shapes.
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

// integrationRoot carries run-level info used to build the root agent span and,
// when the provider sends no node breakdown, to surface tokens/output/error on
// the root so they are not lost.
type integrationRoot struct {
	status      string
	elapsedSec  float64
	totalTokens uint32
	output      string
	errMsg      string
	// Workflow/platform identity — makes this a first-class platform run, kept
	// out of the agent registry and queryable by platform + workflow.
	platform        string
	workflowID      string
	workflowName    string
	workflowVersion string
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
	root := integrationRoot{
		status:       statusFromString(p.Data.Status),
		elapsedSec:   p.Data.ElapsedTime,
		totalTokens:  p.Data.TotalTokens,
		output:       marshalOutputs(p.Data.Outputs),
		errMsg:       p.Data.Error,
		platform:     "dify",
		workflowID:   defaultStr(p.Data.WorkflowID, "dify-workflow"),
		workflowName: defaultStr(p.Data.WorkflowID, "Dify workflow"),
	}
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, root)
	h.finishIntegration(w, r, tenantInfo, te, "dify")
}

// ─── n8n ──────────────────────────────────────────────────────────────────

// n8nPayload is the clean contract an n8n workflow assembles (via the Splyntra
// community node or a Code/HTTP node) and POSTs — we deliberately do not parse
// n8n's volatile internal run format.
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
	root := integrationRoot{
		status:       statusFromString(p.Status),
		platform:     "n8n",
		workflowID:   defaultStr(p.Workflow.ID, p.Workflow.Name),
		workflowName: defaultStr(p.Workflow.Name, "n8n workflow"),
	}
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, root)
	h.finishIntegration(w, r, tenantInfo, te, "n8n")
}

// ─── Flowise ────────────────────────────────────────────────────────────────

// flowisePayload is the clean contract a Flowise chatflow assembles (via an HTTP
// node or the Splyntra recipe) and POSTs — same shape as n8n, keyed by chatflow.
type flowisePayload struct {
	ChatflowID string         `json:"chatflow_id"`
	Name       string         `json:"name"`
	SessionID  string         `json:"session_id"`
	Status     string         `json:"status"`
	Nodes      []workflowNode `json:"nodes"`
}

// ReceiveFlowise ingests a Flowise chatflow execution.
func (h *Handler) ReceiveFlowise(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var p flowisePayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	traceID := defaultStr(p.SessionID, p.ChatflowID)
	agentID := defaultStr(p.Name, "flowise-chatflow")
	root := integrationRoot{
		status:       statusFromString(p.Status),
		platform:     "flowise",
		workflowID:   defaultStr(p.ChatflowID, p.Name),
		workflowName: defaultStr(p.Name, "Flowise chatflow"),
	}
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, root)
	h.finishIntegration(w, r, tenantInfo, te, "flowise")
}

// ─── Hyperscaler agent platforms ─────────────────────────────────────────────
// Bedrock AgentCore and Vertex Agent Engine emit gen_ai.* OTLP, which already
// ingests via /v1/traces. These webhook receivers accept a clean run summary
// (produced by a small Lambda/Cloud Function forwarder from their native
// traces/logs) for environments not wired for OTLP export — same contract and
// fidelity as the Dify/n8n/Flowise receivers. Keeping them in the open core
// preserves the neutral, multi-platform posture.

// bedrockPayload is a clean AWS Bedrock AgentCore run summary.
type bedrockPayload struct {
	AgentID     string         `json:"agent_id"`
	AgentName   string         `json:"agent_name"`
	SessionID   string         `json:"session_id"`
	Status      string         `json:"status"`
	ElapsedSec  float64        `json:"elapsed_time"`
	TotalTokens uint32         `json:"total_tokens"`
	Output      string         `json:"output"`
	Error       string         `json:"error"`
	Nodes       []workflowNode `json:"nodes"`
}

// ReceiveBedrock ingests an AWS Bedrock AgentCore run.
func (h *Handler) ReceiveBedrock(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var p bedrockPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	traceID := defaultStr(p.SessionID, p.AgentID)
	agentID := defaultStr(p.AgentName, defaultStr(p.AgentID, "bedrock-agent"))
	root := integrationRoot{
		status:       statusFromString(p.Status),
		elapsedSec:   p.ElapsedSec,
		totalTokens:  p.TotalTokens,
		output:       p.Output,
		errMsg:       p.Error,
		platform:     "bedrock",
		workflowID:   defaultStr(p.AgentID, p.AgentName),
		workflowName: defaultStr(p.AgentName, "Bedrock agent"),
	}
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, root)
	h.finishIntegration(w, r, tenantInfo, te, "bedrock")
}

// vertexPayload is a clean Google Vertex Agent Engine run summary.
type vertexPayload struct {
	AppName           string         `json:"app_name"`
	ReasoningEngineID string         `json:"reasoning_engine_id"`
	SessionID         string         `json:"session_id"`
	Status            string         `json:"status"`
	ElapsedSec        float64        `json:"elapsed_time"`
	TotalTokens       uint32         `json:"total_tokens"`
	Output            string         `json:"output"`
	Error             string         `json:"error"`
	Nodes             []workflowNode `json:"nodes"`
}

// ReceiveVertex ingests a Google Vertex Agent Engine run.
func (h *Handler) ReceiveVertex(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var p vertexPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	traceID := defaultStr(p.SessionID, p.ReasoningEngineID)
	agentID := defaultStr(p.AppName, defaultStr(p.ReasoningEngineID, "vertex-agent"))
	root := integrationRoot{
		status:       statusFromString(p.Status),
		elapsedSec:   p.ElapsedSec,
		totalTokens:  p.TotalTokens,
		output:       p.Output,
		errMsg:       p.Error,
		platform:     "vertex",
		workflowID:   defaultStr(p.ReasoningEngineID, p.AppName),
		workflowName: defaultStr(p.AppName, "Vertex agent"),
	}
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, root)
	h.finishIntegration(w, r, tenantInfo, te, "vertex")
}

// openclawPayload is a clean OpenClaw (self-hosted agent gateway) run summary,
// assembled by the Splyntra OpenClaw plugin from its lifecycle hooks. OpenClaw
// is per-session, so a session is the trace and each tool/model step is a node.
type openclawPayload struct {
	SessionID   string         `json:"session_id"`
	Agent       string         `json:"agent"`
	Channel     string         `json:"channel"`
	Status      string         `json:"status"`
	ElapsedSec  float64        `json:"elapsed_time"`
	TotalTokens uint32         `json:"total_tokens"`
	Output      string         `json:"output"`
	Error       string         `json:"error"`
	Nodes       []workflowNode `json:"nodes"`
}

// ReceiveOpenClaw ingests an OpenClaw agent session run.
func (h *Handler) ReceiveOpenClaw(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var p openclawPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	traceID := defaultStr(p.SessionID, p.Agent)
	agentID := defaultStr(p.Agent, "openclaw-agent")
	root := integrationRoot{
		status:       statusFromString(p.Status),
		elapsedSec:   p.ElapsedSec,
		totalTokens:  p.TotalTokens,
		output:       p.Output,
		errMsg:       p.Error,
		platform:     "openclaw",
		workflowID:   defaultStr(p.Agent, "openclaw-agent"),
		workflowName: defaultStr(p.Agent, "OpenClaw agent"),
	}
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, root)
	h.finishIntegration(w, r, tenantInfo, te, "openclaw")
}

// langflowPayload is a clean Langflow flow-run summary (HTTP node / component).
type langflowPayload struct {
	FlowID    string         `json:"flow_id"`
	Name      string         `json:"name"`
	SessionID string         `json:"session_id"`
	Status    string         `json:"status"`
	Nodes     []workflowNode `json:"nodes"`
}

// ReceiveLangflow ingests a Langflow flow run.
func (h *Handler) ReceiveLangflow(w http.ResponseWriter, r *http.Request) {
	tenantInfo := r.Context().Value(auth.TenantContextKey).(*auth.TenantInfo)
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var p langflowPayload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	traceID := defaultStr(p.SessionID, p.FlowID)
	agentID := defaultStr(p.Name, "langflow-flow")
	root := integrationRoot{
		status:       statusFromString(p.Status),
		platform:     "langflow",
		workflowID:   defaultStr(p.FlowID, p.Name),
		workflowName: defaultStr(p.Name, "Langflow flow"),
	}
	te := h.buildIntegrationTrace(tenantInfo, traceID, agentID, p.Nodes, root)
	h.finishIntegration(w, r, tenantInfo, te, "langflow")
}

// ─── shared translation ─────────────────────────────────────────────────────

// buildIntegrationTrace turns a list of workflow nodes into a TraceEvent: a root
// `agent` span that parents each node span, with redacted span input/output,
// per-node sequenced timing, and tenant enrichment.
func (h *Handler) buildIntegrationTrace(
	t *auth.TenantInfo, traceID, agentID string, nodes []workflowNode, root integrationRoot,
) *streaming.TraceEvent {
	if traceID == "" {
		traceID = "wf_" + agentID
	}
	tenantAttrs := h.tenantResolver.Enrich(t.OrgID, t.ProjectID, t.Env)
	te := &streaming.TraceEvent{
		TraceID:         traceID,
		OrgID:           t.OrgID,
		ProjectID:       t.ProjectID,
		Environment:     t.Env,
		AgentID:         agentID,
		Platform:        root.platform,
		WorkflowID:      root.workflowID,
		WorkflowName:    root.workflowName,
		WorkflowVersion: root.workflowVersion,
		IngestedAt:      time.Now().UTC(),
	}

	// Total wall-clock: prefer the provider-reported elapsed; fall back to the
	// sum of node durations so the root span isn't shorter than its children.
	var sumMs uint32
	for _, n := range nodes {
		sumMs += n.ElapsedMs
	}
	totalMs := uint32(root.elapsedSec * 1000)
	if totalMs < sumMs {
		totalMs = sumMs
	}
	rootStart := time.Now().UTC().Add(-time.Duration(totalMs) * time.Millisecond)

	// Root agent span — always present, parents every node so the trace renders
	// as a waterfall instead of a flat list of siblings.
	rootAttrs := mergeAttrs(nil, tenantAttrs)
	rootStatus := defaultStr(root.status, "ok")
	if root.errMsg != "" {
		rootStatus = "error"
		rootAttrs["error"] = root.errMsg
	}
	rootSpan := streaming.SpanEvent{
		TraceID:    traceID,
		SpanID:     traceID + "_root",
		OrgID:      t.OrgID,
		ProjectID:  t.ProjectID,
		Type:       "agent",
		Name:       agentID,
		Status:     rootStatus,
		LatencyMs:  totalMs,
		Attributes: rootAttrs,
		StartedAt:  rootStart,
	}
	// No node breakdown: surface the run's output + tokens on the root so cost
	// and output aren't lost. Dify reports a single combined total_tokens (no
	// prompt/completion split), so we record it as completion tokens for an
	// approximate cost and keep the exact total in an attribute.
	if len(nodes) == 0 {
		if root.output != "" {
			rootSpan.RawOutput, _ = h.redactor.RedactString(root.output)
		}
		if root.totalTokens > 0 {
			rootSpan.CompletionTokens = root.totalTokens
			rootAttrs["total_tokens"] = itoa(int(root.totalTokens))
		}
	}
	te.Spans = append(te.Spans, rootSpan)

	// Child node spans, each parented to the root and sequenced by accumulated
	// elapsed time so the waterfall is ordered.
	var offset uint32
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
			ParentSpanID:     rootSpan.SpanID,
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
			StartedAt:        rootStart.Add(time.Duration(offset) * time.Millisecond),
			RawInput:         input,
			RawOutput:        output,
		})
		offset += n.ElapsedMs
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

// marshalOutputs renders a provider's structured outputs map to a compact JSON
// string for storage as the root span's output (empty when there's nothing).
func marshalOutputs(outputs map[string]interface{}) string {
	if len(outputs) == 0 {
		return ""
	}
	b, err := json.Marshal(outputs)
	if err != nil {
		return ""
	}
	return string(b)
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
