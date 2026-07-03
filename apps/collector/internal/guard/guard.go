// SPDX-License-Identifier: AGPL-3.0-only
// Package guard is the collector's synchronous, inline content guardrail — the
// "prevent, not just detect" path. It runs fast, high-confidence checks in Go
// (no ML) so an SDK pre-flight hook can block or redact a prompt/response before
// the model call completes. Deep analysis (Presidio PII, DeBERTa injection)
// stays on the async detector path; this is the low-latency subset.
package guard

import (
	"regexp"

	"github.com/splyntra/splyntra/apps/collector/internal/redact"
)

// Action is the guardrail's verdict for a piece of content.
type Action string

const (
	ActionAllow  Action = "allow"  // nothing matched — proceed
	ActionRedact Action = "redact" // secrets present — proceed with Redacted content
	ActionBlock  Action = "block"  // high-confidence injection — reject the call
)

// Decision is what Evaluate returns (and what /v1/guard serializes).
type Decision struct {
	Action   Action   `json:"action"`
	Reasons  []string `json:"reasons,omitempty"`
	Redacted string   `json:"redacted,omitempty"` // set when Action == ActionRedact
}

type injPattern struct {
	re          *regexp.Regexp
	category    string
	description string
}

// injectionPatterns mirror apps/security/detectors/injection.py so the inline Go
// verdict matches the async detector's categories. Heuristics only — the ML
// classifier stays server-side/async.
var injectionPatterns = []injPattern{
	{regexp.MustCompile(`(?i)ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)`), "instruction_override", "Attempt to override system instructions"},
	{regexp.MustCompile(`(?i)you\s+are\s+now\s+`), "persona_hijack", "Attempt to reassign agent persona"},
	{regexp.MustCompile(`(?i)forget\s+(everything|all|your)\s+(you\s+)?(know|learned|instructions?)`), "memory_wipe", "Attempt to clear agent instructions"},
	{regexp.MustCompile(`(?i)system\s*:\s*you\s+are`), "system_prompt_injection", "Injected system prompt"},
	{regexp.MustCompile(`(?i)(do\s+not|don'?t)\s+follow\s+(your|the|any)\s+(instructions?|rules?|guidelines?)`), "instruction_override", "Attempt to disable instruction following"},
	{regexp.MustCompile(`(?i)pretend\s+(you\s+are|to\s+be|that)`), "persona_hijack", "Attempt to override agent behavior via pretense"},
	{regexp.MustCompile(`(?i)reveal\s+(your|the|system)\s+(system\s+)?(prompt|instructions?|rules?)`), "prompt_extraction", "Attempt to extract system prompt"},
	{regexp.MustCompile(`(?i)\[INST\]|\[/INST\]|<\|im_start\|>|<\|im_end\|>`), "format_exploitation", "Chat template format tokens in user input"},
}

// Engine evaluates content against the inline rule set. It reuses the collector's
// redaction patterns for secrets so the guard and the storage redactor never drift.
type Engine struct {
	redactor  *redact.Redactor
	injection []injPattern
}

// New builds an Engine with the default secret + injection rule sets.
func New() *Engine {
	return &Engine{redactor: redact.NewRedactor(), injection: injectionPatterns}
}

// Evaluate returns a Decision for content. Precedence: a high-confidence
// injection match blocks (most severe); otherwise secret matches redact;
// otherwise allow. Empty content always allows.
func (e *Engine) Evaluate(content string) Decision {
	if content == "" {
		return Decision{Action: ActionAllow}
	}

	var reasons []string
	for _, p := range e.injection {
		if p.re.MatchString(content) {
			reasons = append(reasons, "injection:"+p.category)
		}
	}
	if len(reasons) > 0 {
		return Decision{Action: ActionBlock, Reasons: reasons}
	}

	redacted, hits := e.redactor.RedactString(content)
	if len(hits) > 0 {
		rs := make([]string, 0, len(hits))
		for _, h := range hits {
			rs = append(rs, "secret:"+h)
		}
		return Decision{Action: ActionRedact, Reasons: rs, Redacted: redacted}
	}

	return Decision{Action: ActionAllow}
}
