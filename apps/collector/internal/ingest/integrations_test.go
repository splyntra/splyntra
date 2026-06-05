// SPDX-License-Identifier: AGPL-3.0-only
package ingest

import (
	"testing"

	"go.uber.org/zap"

	"github.com/splyntra/splyntra/apps/collector/internal/auth"
	"github.com/splyntra/splyntra/apps/collector/internal/tenant"
)

func testHandler() *Handler {
	return NewHandler(zap.NewNop(), tenant.NewResolver(""), nil, nil, nil)
}

var testTenant = &auth.TenantInfo{OrgID: "org_1", ProjectID: "proj_1", Env: "test"}

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

func TestBuildIntegrationTrace_NodesAndRedaction(t *testing.T) {
	h := testHandler()
	nodes := []workflowNode{
		{ID: "n1", Name: "llm", Type: "LLM", Model: "gpt-4o", PromptTokens: 100, CompletionTokens: 20, Status: "succeeded"},
		{ID: "n2", Name: "fetch", Type: "http", Input: "key AKIAIOSFODNN7EXAMPLE", Status: "failed"},
	}
	te := h.buildIntegrationTrace(testTenant, "run_1", "wf_demo", nodes, "ok", 1.2)

	if te.TraceID != "run_1" || te.AgentID != "wf_demo" {
		t.Fatalf("unexpected trace identity: %+v", te)
	}
	if len(te.Spans) != 2 {
		t.Fatalf("want 2 spans, got %d", len(te.Spans))
	}
	if te.Spans[0].Type != "llm_call" {
		t.Errorf("span0 type = %q want llm_call", te.Spans[0].Type)
	}
	if te.Spans[1].Type != "tool_call" || te.Spans[1].Status != "error" {
		t.Errorf("span1 type/status = %q/%q want tool_call/error", te.Spans[1].Type, te.Spans[1].Status)
	}
	// Redaction applied to node input on the way in.
	if got := te.Spans[1].RawInput; got == "" || got == "key AKIAIOSFODNN7EXAMPLE" {
		t.Errorf("expected redacted input, got %q", got)
	}
	// Tenant enrichment present on spans.
	if te.Spans[0].Attributes["splyntra.org_id"] != "org_1" {
		t.Errorf("missing tenant enrichment: %v", te.Spans[0].Attributes)
	}
}

func TestBuildIntegrationTrace_NoNodesSynthesizesAgentSpan(t *testing.T) {
	h := testHandler()
	te := h.buildIntegrationTrace(testTenant, "", "wf_empty", nil, "error", 0.5)
	if len(te.Spans) != 1 || te.Spans[0].Type != "agent" {
		t.Fatalf("want 1 synthesized agent span, got %+v", te.Spans)
	}
	if te.Spans[0].Status != "error" || te.Spans[0].LatencyMs != 500 {
		t.Errorf("synth span status/latency = %q/%d want error/500", te.Spans[0].Status, te.Spans[0].LatencyMs)
	}
	if te.TraceID != "wf_wf_empty" {
		t.Errorf("fallback trace id = %q", te.TraceID)
	}
}
