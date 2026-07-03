// SPDX-License-Identifier: AGPL-3.0-only
package ingest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/internal/auth"
	"github.com/splyntra/splyntra/apps/collector/internal/tenant"
)

func testHandler() *Handler {
	// nil stores/publisher — persistTraces guards them, so the receivers run
	// end-to-end (parse → build → validate → 200) without a database.
	return NewHandler(zap.NewNop(), tenant.NewResolver(""), nil, nil, nil)
}

var testTenant = &auth.TenantInfo{OrgID: "org_1", ProjectID: "proj_1", Env: "test"}

func postIntegration(fn http.HandlerFunc, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), auth.TenantContextKey, testTenant))
	rec := httptest.NewRecorder()
	fn(rec, req)
	return rec
}

func decodeAccepted(t *testing.T, rec *httptest.ResponseRecorder) (spans int, traceID string) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Accepted int    `json:"accepted"`
		Spans    int    `json:"spans"`
		TraceID  string `json:"trace_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response json: %v (%s)", err, rec.Body.String())
	}
	if resp.Accepted != 1 {
		t.Fatalf("accepted = %d, want 1", resp.Accepted)
	}
	return resp.Spans, resp.TraceID
}

func TestNodeSpanType(t *testing.T) {
	cases := map[string]struct{ nodeType, model, want string }{
		"llm by model": {"custom", "gpt-4o", "llm_call"},
		"llm by type":  {"LLM", "", "llm_call"},
		"tool http":    {"http-request", "", "tool_call"},
		"tool code":    {"Code", "", "tool_call"},
		"plain step":   {"start", "", "step"},
	}
	for name, c := range cases {
		if got := nodeSpanType(c.nodeType, c.model); got != c.want {
			t.Errorf("%s: nodeSpanType(%q,%q)=%q want %q", name, c.nodeType, c.model, got, c.want)
		}
	}
}

func TestStatusFromString(t *testing.T) {
	for _, s := range []string{"failed", "error", "ERRORED"} {
		if statusFromString(s) != "error" {
			t.Errorf("statusFromString(%q) should be error", s)
		}
	}
	for _, s := range []string{"succeeded", "ok", ""} {
		if statusFromString(s) != "ok" {
			t.Errorf("statusFromString(%q) should be ok", s)
		}
	}
}

// A run with nodes yields a root agent span + one child per node, children
// parented to the root, with redaction and tenant enrichment applied.
func TestBuildIntegrationTrace_RootPlusChildren(t *testing.T) {
	h := testHandler()
	nodes := []workflowNode{
		{ID: "n1", Name: "llm", Type: "LLM", Model: "gpt-4o", PromptTokens: 100, CompletionTokens: 20, ElapsedMs: 200, Status: "succeeded"},
		{ID: "n2", Name: "fetch", Type: "http", Input: "key AKIAIOSFODNN7EXAMPLE", ElapsedMs: 300, Status: "failed"},
	}
	te := h.buildIntegrationTrace(testTenant, "run_1", "wf_demo", nodes, integrationRoot{status: "ok", elapsedSec: 1.2})

	if te.TraceID != "run_1" || te.AgentID != "wf_demo" {
		t.Fatalf("unexpected trace identity: %+v", te)
	}
	if len(te.Spans) != 3 {
		t.Fatalf("want root + 2 child spans = 3, got %d", len(te.Spans))
	}
	root := te.Spans[0]
	if root.Type != "agent" || root.ParentSpanID != "" || root.SpanID != "run_1_root" {
		t.Fatalf("root span wrong: %+v", root)
	}
	c0, c1 := te.Spans[1], te.Spans[2]
	if c0.ParentSpanID != root.SpanID || c1.ParentSpanID != root.SpanID {
		t.Errorf("children not parented to root: %q %q (root %q)", c0.ParentSpanID, c1.ParentSpanID, root.SpanID)
	}
	if c0.Type != "llm_call" {
		t.Errorf("child0 type = %q want llm_call", c0.Type)
	}
	if c1.Type != "tool_call" || c1.Status != "error" {
		t.Errorf("child1 type/status = %q/%q want tool_call/error", c1.Type, c1.Status)
	}
	if got := c1.RawInput; got == "" || got == "key AKIAIOSFODNN7EXAMPLE" {
		t.Errorf("expected redacted input, got %q", got)
	}
	if c0.Attributes["splyntra.org_id"] != "org_1" {
		t.Errorf("missing tenant enrichment: %v", c0.Attributes)
	}
	// Root wall-clock uses the larger of reported elapsed (1200ms) and node sum (500ms).
	if root.LatencyMs != 1200 {
		t.Errorf("root latency = %d want 1200", root.LatencyMs)
	}
}

// Child spans are sequenced by accumulated elapsed time (ordered waterfall).
func TestBuildIntegrationTrace_SequencedTiming(t *testing.T) {
	h := testHandler()
	nodes := []workflowNode{
		{ID: "a", Type: "llm", Model: "m", ElapsedMs: 200},
		{ID: "b", Type: "http", ElapsedMs: 300},
	}
	te := h.buildIntegrationTrace(testTenant, "run_2", "wf", nodes, integrationRoot{})
	root, c0, c1 := te.Spans[0], te.Spans[1], te.Spans[2]
	if root.LatencyMs != 500 {
		t.Errorf("root latency = %d want 500 (node sum)", root.LatencyMs)
	}
	if c0.StartedAt.Before(root.StartedAt) {
		t.Errorf("child0 starts before root")
	}
	if !c1.StartedAt.After(c0.StartedAt) {
		t.Errorf("child1 should start after child0 (got %v vs %v)", c1.StartedAt, c0.StartedAt)
	}
	if gap := c1.StartedAt.Sub(c0.StartedAt).Milliseconds(); gap != 200 {
		t.Errorf("child1-child0 offset = %dms want 200", gap)
	}
}

// With no node breakdown, a single root agent span is synthesized and carries
// the run's tokens/output/error (Dify no-nodes path). Total tokens surface as
// completion tokens so cost is non-zero.
func TestBuildIntegrationTrace_NoNodesEnrichment(t *testing.T) {
	h := testHandler()
	te := h.buildIntegrationTrace(testTenant, "", "wf_empty", nil, integrationRoot{
		status: "ok", elapsedSec: 0.5, totalTokens: 408, output: `{"answer":"hi"}`, errMsg: "boom",
	})
	if len(te.Spans) != 1 {
		t.Fatalf("want 1 synthesized agent span, got %d", len(te.Spans))
	}
	s := te.Spans[0]
	if s.Type != "agent" || s.LatencyMs != 500 {
		t.Errorf("synth span type/latency = %q/%d want agent/500", s.Type, s.LatencyMs)
	}
	if s.Status != "error" || s.Attributes["error"] != "boom" {
		t.Errorf("error not surfaced: status=%q attr=%q", s.Status, s.Attributes["error"])
	}
	if s.CompletionTokens != 408 || s.Attributes["total_tokens"] != "408" {
		t.Errorf("tokens not surfaced: completion=%d attr=%q", s.CompletionTokens, s.Attributes["total_tokens"])
	}
	if s.RawOutput == "" {
		t.Errorf("expected output on root span")
	}
	if te.TraceID != "wf_wf_empty" {
		t.Errorf("fallback trace id = %q", te.TraceID)
	}
}

// Platform identity (platform id + workflow id/name) is carried onto the
// TraceEvent so the run lands in the Agent Platforms domain (platform <> '')
// and is kept out of the agent registry. This is the S1 separation keystone.
func TestBuildIntegrationTrace_PlatformIdentity(t *testing.T) {
	h := testHandler()
	te := h.buildIntegrationTrace(testTenant, "run_1", "wf_demo", nil, integrationRoot{
		status: "ok", platform: "dify", workflowID: "wf_support", workflowName: "Support workflow",
	})
	if te.Platform != "dify" {
		t.Errorf("platform = %q want dify", te.Platform)
	}
	if te.WorkflowID != "wf_support" || te.WorkflowName != "Support workflow" {
		t.Errorf("workflow identity = %q/%q want wf_support/Support workflow", te.WorkflowID, te.WorkflowName)
	}
}

func TestReceiveDify_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"event":"workflow_finished","workflow_run_id":"run_abc",
	  "data":{"workflow_id":"wf_support","status":"succeeded","elapsed_time":1.2,"total_tokens":408},
	  "nodes":[
	    {"id":"n1","name":"classify","type":"llm","model":"gpt-4o","prompt_tokens":320,"completion_tokens":88,"elapsed_ms":220,"status":"succeeded"},
	    {"id":"n2","name":"crm.read","type":"tool","elapsed_ms":180,"status":"succeeded"}
	  ]}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveDify, body))
	if spans != 3 { // root + 2 nodes
		t.Errorf("dify spans = %d want 3", spans)
	}
	if traceID != "run_abc" {
		t.Errorf("dify trace_id = %q want run_abc", traceID)
	}
}

func TestReceiveDify_NoNodes_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"event":"workflow_finished","workflow_run_id":"run_x",
	  "data":{"workflow_id":"wf","status":"succeeded","elapsed_time":0.4,"total_tokens":120,"outputs":{"text":"hi"}}}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveDify, body))
	if spans != 1 {
		t.Errorf("dify no-nodes spans = %d want 1", spans)
	}
	if traceID != "run_x" {
		t.Errorf("trace_id = %q", traceID)
	}
}

func TestReceiveN8N_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"workflow":{"id":"wf_42","name":"Support Agent"},"execution_id":"exec_123","status":"success",
	  "nodes":[{"name":"OpenAI","type":"llm","model":"gpt-4o-mini","prompt_tokens":150,"completion_tokens":40,"elapsed_ms":300,"status":"success"}]}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveN8N, body))
	if spans != 2 { // root + 1 node
		t.Errorf("n8n spans = %d want 2", spans)
	}
	if traceID != "exec_123" {
		t.Errorf("n8n trace_id = %q want exec_123", traceID)
	}
}

func TestReceiveFlowise_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"chatflow_id":"cf_1","name":"RAG Bot","session_id":"sess_9","status":"success",
	  "nodes":[
	    {"name":"Retriever","type":"tool","elapsed_ms":90,"status":"success"},
	    {"name":"LLM Chain","type":"llm","model":"gpt-4o","prompt_tokens":210,"completion_tokens":55,"elapsed_ms":410,"status":"success"}
	  ]}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveFlowise, body))
	if spans != 3 { // root + 2 nodes
		t.Errorf("flowise spans = %d want 3", spans)
	}
	if traceID != "sess_9" {
		t.Errorf("flowise trace_id = %q want sess_9", traceID)
	}
}

func TestReceiveBedrock_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"agent_name":"support-agent","agent_id":"ABC123","session_id":"sess_br","status":"success",
	  "elapsed_time":1.4,
	  "nodes":[
	    {"name":"KnowledgeBase","type":"tool","elapsed_ms":120,"status":"success"},
	    {"name":"Claude","type":"llm","model":"anthropic.claude-3-sonnet","prompt_tokens":300,"completion_tokens":80,"elapsed_ms":500,"status":"success"}
	  ]}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveBedrock, body))
	if spans != 3 { // root + 2 nodes
		t.Errorf("bedrock spans = %d want 3", spans)
	}
	if traceID != "sess_br" {
		t.Errorf("bedrock trace_id = %q want sess_br", traceID)
	}
}

func TestReceiveBedrock_NoNodes_Enrichment(t *testing.T) {
	h := testHandler()
	// No node breakdown: tokens + output must still land on the root span.
	body := `{"agent_name":"a1","session_id":"sess_x","status":"failed","total_tokens":512,"output":"partial","error":"throttled"}`
	spans, _ := decodeAccepted(t, postIntegration(h.ReceiveBedrock, body))
	if spans != 1 {
		t.Errorf("bedrock no-nodes spans = %d want 1", spans)
	}
}

func TestReceiveVertex_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"app_name":"planner","reasoning_engine_id":"re_9","session_id":"sess_vx","status":"ok",
	  "nodes":[{"name":"Gemini","type":"llm","model":"gemini-1.5-pro","prompt_tokens":150,"completion_tokens":40,"elapsed_ms":300,"status":"ok"}]}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveVertex, body))
	if spans != 2 { // root + 1 node
		t.Errorf("vertex spans = %d want 2", spans)
	}
	if traceID != "sess_vx" {
		t.Errorf("vertex trace_id = %q want sess_vx", traceID)
	}
}

func TestReceiveOpenClaw_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"session_id":"sess_oc","agent":"coder","channel":"telegram","status":"success",
	  "elapsed_time":0.9,
	  "nodes":[
	    {"name":"read_file","type":"tool","elapsed_ms":40,"status":"success"},
	    {"name":"gpt-4o","type":"llm","model":"gpt-4o","prompt_tokens":120,"completion_tokens":30,"elapsed_ms":260,"status":"success"}
	  ]}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveOpenClaw, body))
	if spans != 3 { // root + 2 nodes
		t.Errorf("openclaw spans = %d want 3", spans)
	}
	if traceID != "sess_oc" {
		t.Errorf("openclaw trace_id = %q want sess_oc", traceID)
	}
}

func TestReceiveLangflow_HTTP(t *testing.T) {
	h := testHandler()
	body := `{"flow_id":"flow_1","name":"rag-flow","session_id":"sess_lf","status":"success",
	  "nodes":[{"name":"Retriever","type":"tool","elapsed_ms":60,"status":"success"},
	           {"name":"LLM","type":"llm","model":"gpt-4o-mini","prompt_tokens":80,"completion_tokens":20,"elapsed_ms":200,"status":"success"}]}`
	spans, traceID := decodeAccepted(t, postIntegration(h.ReceiveLangflow, body))
	if spans != 3 {
		t.Errorf("langflow spans = %d want 3", spans)
	}
	if traceID != "sess_lf" {
		t.Errorf("langflow trace_id = %q want sess_lf", traceID)
	}
}

func TestReceiveIntegration_BadJSON(t *testing.T) {
	h := testHandler()
	for _, fn := range []http.HandlerFunc{h.ReceiveDify, h.ReceiveN8N, h.ReceiveFlowise, h.ReceiveBedrock, h.ReceiveVertex, h.ReceiveOpenClaw, h.ReceiveLangflow} {
		rec := postIntegration(fn, `{not json`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("bad json: status = %d want 400", rec.Code)
		}
	}
}
