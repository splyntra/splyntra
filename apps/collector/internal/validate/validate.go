// SPDX-License-Identifier: AGPL-3.0-only
// Package validate provides input validation for the ingest pipeline.
// Validation runs before any storage or streaming so malformed traces are
// rejected at the edge with a structured 400 rather than silently persisted.
package validate

import (
	"errors"
	"fmt"

	"github.com/splyntra/splyntra/apps/collector/internal/streaming"
)

// Limits bound the size and shape of an accepted trace. They guard against
// resource exhaustion and obviously-corrupt payloads.
const (
	// MaxSpansPerTrace caps the number of spans in a single trace.
	MaxSpansPerTrace = 10000
	// MaxNameLen caps span/agent name length.
	MaxNameLen = 1024
	// MaxTokens is a sanity ceiling on per-span token counts.
	MaxTokens = 100_000_000
)

// ErrEmpty signals a required identifier was missing.
var ErrEmpty = errors.New("required field is empty")

// validSpanType is the set of span types the pipeline understands.
var validSpanType = map[string]bool{
	"agent":     true,
	"llm_call":  true,
	"tool_call": true,
	"step":      true,
}

// ValidateTrace checks a single trace event for the invariants the storage
// and query layers rely on. It returns a descriptive error on the first
// violation, or nil if the trace is acceptable.
func ValidateTrace(t *streaming.TraceEvent) error {
	if t == nil {
		return fmt.Errorf("trace: %w", ErrEmpty)
	}
	if t.TraceID == "" {
		return fmt.Errorf("trace_id: %w", ErrEmpty)
	}
	if t.OrgID == "" {
		return fmt.Errorf("org_id: %w", ErrEmpty)
	}
	if t.ProjectID == "" {
		return fmt.Errorf("project_id: %w", ErrEmpty)
	}
	if len(t.Spans) == 0 {
		return fmt.Errorf("trace %s has no spans", t.TraceID)
	}
	if len(t.Spans) > MaxSpansPerTrace {
		return fmt.Errorf("trace %s exceeds span limit (%d > %d)", t.TraceID, len(t.Spans), MaxSpansPerTrace)
	}
	if len(t.AgentID) > MaxNameLen {
		return fmt.Errorf("agent_id exceeds %d chars", MaxNameLen)
	}
	for i := range t.Spans {
		if err := validateSpan(&t.Spans[i]); err != nil {
			return fmt.Errorf("trace %s span %d: %w", t.TraceID, i, err)
		}
	}
	return nil
}

func validateSpan(s *streaming.SpanEvent) error {
	if s.SpanID == "" {
		return fmt.Errorf("span_id: %w", ErrEmpty)
	}
	if s.TraceID == "" {
		return fmt.Errorf("trace_id: %w", ErrEmpty)
	}
	if len(s.Name) > MaxNameLen {
		return fmt.Errorf("name exceeds %d chars", MaxNameLen)
	}
	if s.Type != "" && !validSpanType[s.Type] {
		return fmt.Errorf("unknown span type %q", s.Type)
	}
	if s.PromptTokens > MaxTokens || s.CompletionTokens > MaxTokens {
		return fmt.Errorf("token count out of range")
	}
	return nil
}
