// SPDX-License-Identifier: FSL-1.1-ALv2
package store

import "testing"

// sourceWhere is the single point where the Agents vs Agent Platforms separation
// is enforced at the query layer — pin its behavior.
func TestSourceWhere(t *testing.T) {
	cases := []struct {
		name          string
		source        string
		platform      string
		wantClause    string
		wantExtraArgs int
	}{
		{"all", "", "", "base", 0},
		{"agents only", "agent", "", "base AND platform = ''", 0},
		{"platforms only", "platform", "", "base AND platform <> ''", 0},
		{"explicit platform id", "", "dify", "base AND platform = ?", 1},
		{"platform id wins over source", "agent", "n8n", "base AND platform = ?", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			where, args := sourceWhere("base", []any{}, c.source, c.platform)
			if where != c.wantClause {
				t.Errorf("where = %q want %q", where, c.wantClause)
			}
			if len(args) != c.wantExtraArgs {
				t.Errorf("args = %d want %d", len(args), c.wantExtraArgs)
			}
		})
	}
}

// traceScopeSubquery scopes detections/spans (no platform column) via a subquery
// on traces. It must return an empty clause only when no scoping is requested.
func TestTraceScopeSubquery(t *testing.T) {
	if clause, _ := traceScopeSubquery("o", "p", "", ""); clause != "" {
		t.Errorf("unscoped should yield no clause, got %q", clause)
	}
	for _, src := range []string{"agent", "platform"} {
		clause, args := traceScopeSubquery("o", "p", src, "")
		if clause == "" || len(args) != 2 {
			t.Errorf("source %q: clause=%q args=%d want non-empty clause + 2 args", src, clause, len(args))
		}
	}
	clause, args := traceScopeSubquery("o", "p", "", "dify")
	if clause == "" || len(args) != 3 { // org, project, platform
		t.Errorf("platform id: clause=%q args=%d want non-empty + 3 args", clause, len(args))
	}
}
