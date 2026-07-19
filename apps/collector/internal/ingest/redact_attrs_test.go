// SPDX-License-Identifier: FSL-1.1-ALv2
package ingest

import (
	"testing"

	"github.com/splyntra/splyntra/apps/collector/internal/auth"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

func strAttr(k, v string) *commonpb.KeyValue {
	return &commonpb.KeyValue{Key: k, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: v}}}
}

func buildReq(span *tracepb.Span) *coltracepb.ExportTraceServiceRequest {
	return &coltracepb.ExportTraceServiceRequest{
		ResourceSpans: []*tracepb.ResourceSpans{{
			ScopeSpans: []*tracepb.ScopeSpans{{Spans: []*tracepb.Span{span}}},
		}},
	}
}

// P0.1: sensitive OTLP attributes must be redacted before storage, not just the
// synthesized raw input/output previews.
func TestOTLPRedactsAttributes(t *testing.T) {
	span := &tracepb.Span{
		TraceId: make([]byte, 16),
		SpanId:  make([]byte, 8),
		Name:    "llm call",
		Attributes: []*commonpb.KeyValue{
			strAttr("gen_ai.prompt", "here is my key AKIAIOSFODNN7EXAMPLE ok"),
			strAttr("gen_ai.request.model", "gpt-4o"), // benign, must survive
		},
		StartTimeUnixNano: 1_000_000_000,
		EndTimeUnixNano:   1_002_000_000,
	}
	events, _ := testHandler().otlpToTraceEvents(buildReq(span), &auth.TenantInfo{OrgID: "o", ProjectID: "p", Env: "dev"})
	if len(events) != 1 || len(events[0].Spans) != 1 {
		t.Fatalf("expected 1 span, got %+v", events)
	}
	attrs := events[0].Spans[0].Attributes
	if got := attrs["gen_ai.prompt"]; got == "" || contains(got, "AKIAIOSFODNN7EXAMPLE") {
		t.Errorf("prompt attribute not redacted: %q", got)
	}
	if !contains(attrs["gen_ai.prompt"], "[REDACTED:AWS_KEY]") {
		t.Errorf("expected redaction marker, got %q", attrs["gen_ai.prompt"])
	}
	if attrs["gen_ai.request.model"] != "gpt-4o" {
		t.Errorf("benign attribute was altered: %q", attrs["gen_ai.request.model"])
	}
	// tenant attrs still merged in unredacted.
	if attrs["splyntra.org_id"] != "o" {
		t.Errorf("tenant org_id missing/redacted: %q", attrs["splyntra.org_id"])
	}
}

// P0.6: an in-progress span (End==0) or End<Start must not underflow to a huge
// latency; it should record 0.
func TestOTLPLatencyGuards(t *testing.T) {
	cases := []struct {
		name          string
		start, end    uint64
		wantLatencyMs uint32
	}{
		{"in-progress end zero", 1_000_000_000, 0, 0},
		{"end before start", 2_000_000_000, 1_000_000_000, 0},
		{"start zero", 0, 1_000_000_000, 0},
		{"normal 5ms", 1_000_000_000, 1_005_000_000, 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			span := &tracepb.Span{
				TraceId: make([]byte, 16), SpanId: make([]byte, 8), Name: "s",
				StartTimeUnixNano: tc.start, EndTimeUnixNano: tc.end,
			}
			events, _ := testHandler().otlpToTraceEvents(buildReq(span), &auth.TenantInfo{OrgID: "o"})
			got := events[0].Spans[0].LatencyMs
			if got != tc.wantLatencyMs {
				t.Errorf("latency = %d, want %d", got, tc.wantLatencyMs)
			}
		})
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
