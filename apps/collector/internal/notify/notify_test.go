// SPDX-License-Identifier: FSL-1.1-ALv2
package notify

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"go.uber.org/zap"
)

func TestSafeURL(t *testing.T) {
	// IP literals so the test never depends on DNS/network.
	cases := []struct {
		url  string
		want bool
	}{
		{"https://8.8.8.8/hook", true},
		{"http://1.1.1.1/x", true},
		{"http://127.0.0.1/hook", false},      // loopback
		{"http://[::1]/hook", false},          // loopback v6
		{"http://10.0.0.5/x", false},          // private
		{"http://192.168.1.5/x", false},       // private
		{"http://172.16.9.9/x", false},        // private
		{"http://169.254.169.254/meta", false}, // cloud metadata (link-local)
		{"http://0.0.0.0/x", false},           // unspecified
		{"ftp://8.8.8.8/x", false},            // bad scheme
		{"not-a-url", false},
		{"", false},
	}
	for _, c := range cases {
		if got := safeURL(c.url); got != c.want {
			t.Errorf("safeURL(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}

func TestDispatchDeliversWebhookAndSlack(t *testing.T) {
	var mu sync.Mutex
	got := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got[r.URL.Path] = string(b)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// allowPrivate: httptest binds to 127.0.0.1, which the SSRF guard blocks.
	n := &Notifier{client: srv.Client(), logger: zap.NewNop(), allowPrivate: true, sem: make(chan struct{}, 4)}
	n.dispatch(context.Background(),
		[]string{"webhook", "slack"},
		Event{AlertName: "High risk", TraceID: "t1", RiskScore: 90, Severity: "HIGH"},
		ChannelConfig{WebhookURL: srv.URL + "/wh", SlackWebhookURL: srv.URL + "/slack"},
	)

	mu.Lock()
	defer mu.Unlock()
	if body, ok := got["/wh"]; !ok || !strings.Contains(body, `"risk_score":90`) {
		t.Errorf("webhook not delivered correctly: %q", body)
	}
	if body, ok := got["/slack"]; !ok || !strings.Contains(body, `"text"`) {
		t.Errorf("slack not delivered in slack format: %q", body)
	}
}

func TestDispatchSSRFBlocksPrivateHost(t *testing.T) {
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// allowPrivate=false (the cloud default) must block delivery to 127.0.0.1.
	n := &Notifier{client: srv.Client(), logger: zap.NewNop(), allowPrivate: false, sem: make(chan struct{}, 4)}
	n.dispatch(context.Background(), []string{"webhook"}, Event{AlertName: "x"}, ChannelConfig{WebhookURL: srv.URL})
	if hit {
		t.Error("SSRF guard failed: delivered to a private/loopback host")
	}
}
