// SPDX-License-Identifier: AGPL-3.0-only
package guard

import (
	"encoding/json"
	"io"
	"net/http"

	"go.uber.org/zap"
)

const maxBodySize = 1 << 20 // 1 MiB — guard payloads are single prompts/responses

// Handler serves the inline guardrail (/v1/guard). Policy authorization + the
// activity ledger (/v1/authorize, /v1/ledger) are governance concerns owned by
// the commercial governance extension module, not the open core.
type Handler struct {
	engine *Engine
	logger *zap.Logger
}

func NewHandler(logger *zap.Logger) *Handler {
	return &Handler{engine: New(), logger: logger}
}

type guardRequest struct {
	Content   string `json:"content"`
	Direction string `json:"direction"` // "input" | "output" (informational)
}

// Guard evaluates a single piece of content and returns a Decision. It is pure,
// synchronous, and stateless — safe on an SDK pre-flight hot path.
func (h *Handler) Guard(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var req guardRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	decision := h.engine.Evaluate(req.Content)
	if decision.Action != ActionAllow {
		h.logger.Info("guard verdict",
			zap.String("action", string(decision.Action)),
			zap.String("direction", req.Direction),
			zap.Strings("reasons", decision.Reasons),
		)
	}
	writeJSON(w, decision)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
