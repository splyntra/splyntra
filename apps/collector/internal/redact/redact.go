// SPDX-License-Identifier: AGPL-3.0-only
package redact

import (
	"regexp"
	"strings"
)

// Redactor applies early-stage redaction before storage.
// This runs in the hot path — only fast, high-confidence patterns here.
// Deep analysis (Presidio PII, ML injection) runs in the detector service.
type Redactor struct {
	patterns []*pattern
}

type pattern struct {
	name    string
	re      *regexp.Regexp
	replace string
}

func NewRedactor() *Redactor {
	return &Redactor{
		patterns: []*pattern{
			{
				name:    "aws_access_key",
				re:      regexp.MustCompile(`AKIA[0-9A-Z]{16}`),
				replace: "[REDACTED:AWS_KEY]",
			},
			{
				name:    "aws_secret_key",
				re:      regexp.MustCompile(`(?i)aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}`),
				replace: "[REDACTED:AWS_SECRET]",
			},
			{
				name:    "generic_api_key",
				re:      regexp.MustCompile(`(?i)(api[_-]?key|apikey|secret[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9\-._~]{20,}["']?`),
				replace: "[REDACTED:API_KEY]",
			},
			{
				name:    "bearer_token",
				re:      regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*`),
				replace: "[REDACTED:BEARER]",
			},
			{
				name:    "jwt",
				re:      regexp.MustCompile(`eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*`),
				replace: "[REDACTED:JWT]",
			},
		},
	}
}

// RedactString applies all patterns to a string and returns the redacted version
// plus a list of detection labels.
func (r *Redactor) RedactString(input string) (string, []string) {
	var detections []string
	result := input
	for _, p := range r.patterns {
		if p.re.MatchString(result) {
			detections = append(detections, p.name)
			result = p.re.ReplaceAllString(result, p.replace)
		}
	}
	return result, detections
}

// RedactMap applies redaction to all string values in a map (one level deep).
func (r *Redactor) RedactMap(input map[string]string) (map[string]string, []string) {
	var allDetections []string
	output := make(map[string]string, len(input))
	for k, v := range input {
		redacted, detections := r.RedactString(v)
		output[k] = redacted
		allDetections = append(allDetections, detections...)
	}
	return output, allDetections
}

// ContainsSensitive checks if a string likely contains sensitive data (fast check).
func (r *Redactor) ContainsSensitive(input string) bool {
	lower := strings.ToLower(input)
	keywords := []string{"password", "secret", "token", "api_key", "apikey", "credential"}
	for _, kw := range keywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	for _, p := range r.patterns {
		if p.re.MatchString(input) {
			return true
		}
	}
	return false
}
