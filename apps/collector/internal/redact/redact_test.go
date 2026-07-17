// SPDX-License-Identifier: FSL-1.1-ALv2
package redact

import (
	"testing"
)

func TestRedactAWSKey(t *testing.T) {
	r := NewRedactor()
	input := "Here is my key: AKIAIOSFODNN7EXAMPLE and some text"
	result, detections := r.RedactString(input)

	if len(detections) == 0 {
		t.Fatal("expected detection for AWS key")
	}
	if detections[0] != "aws_access_key" {
		t.Fatalf("expected aws_access_key, got %s", detections[0])
	}
	if result == input {
		t.Fatal("expected input to be redacted")
	}
	if !contains(result, "[REDACTED:AWS_KEY]") {
		t.Fatalf("expected redaction marker, got: %s", result)
	}
}

func TestRedactJWT(t *testing.T) {
	r := NewRedactor()
	input := "token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
	result, detections := r.RedactString(input)

	if len(detections) == 0 {
		t.Fatal("expected detection for JWT")
	}
	if !contains(result, "[REDACTED:JWT]") {
		t.Fatalf("expected JWT redaction, got: %s", result)
	}
}

func TestNoFalsePositive(t *testing.T) {
	r := NewRedactor()
	input := "Hello, this is a normal message about the weather"
	result, detections := r.RedactString(input)

	if len(detections) != 0 {
		t.Fatalf("expected no detections, got %v", detections)
	}
	if result != input {
		t.Fatal("expected input unchanged")
	}
}

func TestContainsSensitive(t *testing.T) {
	r := NewRedactor()

	cases := []struct {
		input    string
		expected bool
	}{
		{"my password is secret123", true},
		{"the api_key is abc", true},
		{"normal text here", false},
		{"AKIAIOSFODNN7EXAMPLE", true},
	}

	for _, tc := range cases {
		got := r.ContainsSensitive(tc.input)
		if got != tc.expected {
			t.Errorf("ContainsSensitive(%q) = %v, want %v", tc.input, got, tc.expected)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
