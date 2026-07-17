// SPDX-License-Identifier: FSL-1.1-ALv2
package ingest

import "testing"

func TestEffectiveSpans_Nested(t *testing.T) {
	lt := legacyTrace{
		TraceID: "tr_1",
		Spans:   []legacySpan{{SpanID: "s1", Name: "a"}, {SpanID: "s2", Name: "b"}},
	}
	if got := lt.effectiveSpans(); len(got) != 2 {
		t.Fatalf("want 2 spans, got %d", len(got))
	}
}

func TestEffectiveSpans_FlatSynthesizesOne(t *testing.T) {
	lt := legacyTrace{TraceID: "tr_1"}
	lt.legacySpan = legacySpan{Name: "test.completion", Model: "gpt-4o", PromptTokens: 100}
	got := lt.effectiveSpans()
	if len(got) != 1 {
		t.Fatalf("want 1 synthesized span, got %d", len(got))
	}
	if got[0].SpanID != "tr_1_0" {
		t.Errorf("expected synthesized span id tr_1_0, got %q", got[0].SpanID)
	}
}

func TestEffectiveSpans_Empty(t *testing.T) {
	lt := legacyTrace{TraceID: "tr_1"}
	if got := lt.effectiveSpans(); got != nil {
		t.Fatalf("want nil for empty trace, got %v", got)
	}
}

func TestMergeAttrs(t *testing.T) {
	out := mergeAttrs(map[string]string{"k": "v"}, map[string]string{"splyntra.org_id": "o"})
	if out["k"] != "v" || out["splyntra.org_id"] != "o" {
		t.Errorf("merge lost data: %v", out)
	}
	// nil base still gets tenant attrs.
	out2 := mergeAttrs(nil, map[string]string{"splyntra.env": "dev"})
	if out2["splyntra.env"] != "dev" {
		t.Errorf("nil base not enriched: %v", out2)
	}
}

func TestJSONEscape(t *testing.T) {
	if got := jsonEscape(`he said "hi"`); got != `he said \"hi\"` {
		t.Errorf("unexpected escape: %q", got)
	}
}
