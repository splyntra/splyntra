// SPDX-License-Identifier: FSL-1.1-ALv2
package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTrustedRealIP(t *testing.T) {
	trusted := parseCIDRs(defaultTrustedProxies)

	cases := []struct {
		name       string
		remoteAddr string // socket peer
		xff        string
		xrealip    string
		wantRemote string // RemoteAddr seen by the next handler
	}{
		// Proxy on a private network → its forwarded client IP is honored.
		{"private proxy honors XFF", "172.18.0.5:5000", "203.0.113.9", "", "203.0.113.9"},
		{"private proxy honors X-Real-IP", "10.1.2.3:5000", "", "203.0.113.7", "203.0.113.7"},
		{"X-Real-IP preferred over XFF", "10.0.0.9:5000", "1.1.1.1", "203.0.113.7", "203.0.113.7"},
		// Direct PUBLIC peer spoofing XFF → headers ignored, socket peer kept.
		{"public peer cannot spoof", "203.0.113.50:44321", "10.0.0.1", "127.0.0.1", "203.0.113.50:44321"},
		// No headers → unchanged.
		{"no headers", "172.18.0.5:5000", "", "", "172.18.0.5:5000"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var seen string
			h := trustedRealIP(trusted)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				seen = r.RemoteAddr
			}))
			req := httptest.NewRequest("GET", "/", nil)
			req.RemoteAddr = tc.remoteAddr
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			if tc.xrealip != "" {
				req.Header.Set("X-Real-IP", tc.xrealip)
			}
			h.ServeHTTP(httptest.NewRecorder(), req)
			if seen != tc.wantRemote {
				t.Errorf("RemoteAddr = %q, want %q", seen, tc.wantRemote)
			}
		})
	}
}

func TestParseCIDRsNoneTrustsNothing(t *testing.T) {
	// The "none" sentinel (not a valid CIDR) yields an empty set → no proxy
	// trusted, so a private peer can no longer spoof via headers either.
	trusted := parseCIDRs("none")
	if len(trusted) != 0 {
		t.Fatalf("expected empty trusted set, got %d", len(trusted))
	}
	if peerInCIDRs("10.0.0.1:5000", trusted) {
		t.Error("empty trusted set must not match any peer")
	}
}
