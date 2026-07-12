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
	// block marks a pattern precise enough to hard-block on inline (an unambiguous
	// attack signature). Loose, high-recall/low-precision patterns (persona/pretense
	// phrasing that also appears in legitimate role-play prompts) are false-flag risks
	// on the synchronous path, so they only surface as reasons — the async ML detector
	// (DeBERTa) makes the nuanced call. This keeps the inline guard from blocking
	// benign traffic in production while still recording the signal.
	block bool
}

// injectionPatterns mirror apps/security/detectors/injection.py so the inline Go
// verdict matches the async detector's categories. Heuristics only — the ML
// classifier stays server-side/async.
var injectionPatterns = []injPattern{
	{regexp.MustCompile(`(?i)ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)`), "instruction_override", "Attempt to override system instructions", true},
	{regexp.MustCompile(`(?i)you\s+are\s+now\s+`), "persona_hijack", "Attempt to reassign agent persona", false},
	{regexp.MustCompile(`(?i)forget\s+(everything|all|your)\s+(you\s+)?(know|learned|instructions?)`), "memory_wipe", "Attempt to clear agent instructions", true},
	{regexp.MustCompile(`(?i)system\s*:\s*you\s+are`), "system_prompt_injection", "Injected system prompt", true},
	{regexp.MustCompile(`(?i)(do\s+not|don'?t)\s+follow\s+(your|the|any)\s+(instructions?|rules?|guidelines?)`), "instruction_override", "Attempt to disable instruction following", true},
	{regexp.MustCompile(`(?i)pretend\s+(you\s+are|to\s+be|that)`), "persona_hijack", "Attempt to override agent behavior via pretense", false},
	{regexp.MustCompile(`(?i)reveal\s+(your|the|system)\s+(system\s+)?(prompt|instructions?|rules?)`), "prompt_extraction", "Attempt to extract system prompt", true},
	{regexp.MustCompile(`(?i)\[INST\]|\[/INST\]|<\|im_start\|>|<\|im_end\|>`), "format_exploitation", "Chat template format tokens in user input", true},
	// Jailbreak templates (kept in sync with injection.py's jailbreak patterns).
	{regexp.MustCompile(`(?i)\b(dan\s+mode|do\s+anything\s+now|developer\s+mode|jailbreak|AIM|stay\s+in\s+character\s+as)\b`), "jailbreak", "Known jailbreak persona/template", true},
	{regexp.MustCompile(`(?i)(without\s+(any\s+)?(restrictions?|filters?|guidelines?|censorship)|\bunfiltered\b|\bunrestricted\b|no\s+(restrictions?|filters?|limits?|rules?|guidelines?)|no\s+longer\s+bound\s+by)`), "jailbreak", "Attempt to remove safety constraints", true},
	{regexp.MustCompile(`(?i)(enable|activate)\s+(developer|god|unrestricted|admin)\s+mode`), "jailbreak", "Attempt to activate an unrestricted mode", true},
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
	blocked := false
	for _, p := range e.injection {
		if p.re.MatchString(content) {
			reasons = append(reasons, "injection:"+p.category)
			if p.block {
				blocked = true
			}
		}
	}
	// Only hard-block on a high-precision signature. A loose-only match (e.g. a
	// bare persona/pretense phrase) is reported via Reasons but does not block the
	// call — the async DeBERTa detector adjudicates those to avoid false positives.
	if blocked {
		return Decision{Action: ActionBlock, Reasons: reasons}
	}

	redacted, hits := e.redactor.RedactString(content)
	if len(hits) > 0 {
		for _, h := range hits {
			reasons = append(reasons, "secret:"+h)
		}
		return Decision{Action: ActionRedact, Reasons: reasons, Redacted: redacted}
	}

	// Allow, but still surface any loose injection signal so the caller can log it.
	return Decision{Action: ActionAllow, Reasons: reasons}
}
