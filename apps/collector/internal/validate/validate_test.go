// SPDX-License-Identifier: AGPL-3.0-only
package validate

import (
	"errors"
	"strings"
	"testing"

	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
)

func validTrace() *streaming.TraceEvent {
	return &streaming.TraceEvent{
		TraceID:   "tr_1",
		OrgID:     "org_1",
		ProjectID: "proj_1",
		AgentID:   "support_agent",
		Spans: []streaming.SpanEvent{
			{TraceID: "tr_1", SpanID: "sp_1", Type: "agent", Name: "plan"},
			{TraceID: "tr_1", SpanID: "sp_2", Type: "llm_call", Name: "call", PromptTokens: 100, CompletionTokens: 50},
		},
	}
}

func TestValidateTrace_OK(t *testing.T) {
	if err := ValidateTrace(validTrace()); err != nil {
		t.Fatalf("expected valid trace, got %v", err)
	}
}

func TestValidateTrace_MissingIDs(t *testing.T) {
	cases := map[string]func(*streaming.TraceEvent){
		"trace_id":   func(tr *streaming.TraceEvent) { tr.TraceID = "" },
		"org_id":     func(tr *streaming.TraceEvent) { tr.OrgID = "" },
		"project_id": func(tr *streaming.TraceEvent) { tr.ProjectID = "" },
	}
	for name, mutate := range cases {
		tr := validTrace()
		mutate(tr)
		err := ValidateTrace(tr)
		if err == nil || !errors.Is(err, ErrEmpty) {
			t.Errorf("%s: expected ErrEmpty, got %v", name, err)
		}
	}
}

func TestValidateTrace_NoSpans(t *testing.T) {
	tr := validTrace()
	tr.Spans = nil
	if err := ValidateTrace(tr); err == nil {
		t.Error("expected error for trace with no spans")
	}
}

func TestValidateTrace_TooManySpans(t *testing.T) {
	tr := validTrace()
	tr.Spans = make([]streaming.SpanEvent, MaxSpansPerTrace+1)
	for i := range tr.Spans {
		tr.Spans[i] = streaming.SpanEvent{TraceID: "tr_1", SpanID: "sp", Type: "step"}
	}
	if err := ValidateTrace(tr); err == nil {
		t.Error("expected error for exceeding span limit")
	}
}

func TestValidateTrace_BadSpanType(t *testing.T) {
	tr := validTrace()
	tr.Spans[0].Type = "wizardry"
	if err := ValidateTrace(tr); err == nil {
		t.Error("expected error for unknown span type")
	}
}

func TestValidateTrace_TokenOverflow(t *testing.T) {
	tr := validTrace()
	tr.Spans[1].PromptTokens = MaxTokens + 1
	if err := ValidateTrace(tr); err == nil {
		t.Error("expected error for token count out of range")
	}
}

func TestValidateTrace_LongName(t *testing.T) {
	tr := validTrace()
	tr.Spans[0].Name = strings.Repeat("x", MaxNameLen+1)
	if err := ValidateTrace(tr); err == nil {
		t.Error("expected error for over-long span name")
	}
}
