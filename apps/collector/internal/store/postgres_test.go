// SPDX-License-Identifier: FSL-1.1-ALv2
package store

import (
	"strings"
	"testing"
)

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Checkout Agent":   "checkout-agent",
		"  Acme  AI  ":     "acme-ai",
		"Weird!!!Chars$$$": "weird-chars",
		"already-slug":     "already-slug",
		"UPPER":            "upper",
		"":                 "",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q)=%q want %q", in, got, want)
		}
	}
}

func TestNewKeyMaterial(t *testing.T) {
	plaintext, prefix, hash, err := newKeyMaterial()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(plaintext, "splyntra_") {
		t.Errorf("plaintext should be prefixed: %q", plaintext)
	}
	if prefix != plaintext[:12] {
		t.Errorf("prefix %q should be first 12 of plaintext", prefix)
	}
	if len(hash) != 64 {
		t.Errorf("hash should be 64 hex chars (sha256), got %d", len(hash))
	}
	// Two mints must differ (randomness).
	p2, _, h2, _ := newKeyMaterial()
	if plaintext == p2 || hash == h2 {
		t.Error("successive keys must be unique")
	}
}
