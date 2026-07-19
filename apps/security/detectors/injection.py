# SPDX-License-Identifier: FSL-1.1-ALv2
"""Prompt Injection Detection - BETA.

Uses heuristic pattern matching as the baseline.
Optional: DeBERTa-based classifier model for higher accuracy.
Clearly labeled as BETA - informs, does not enforce.
"""

from __future__ import annotations

import os
import re
from .models import Detection

# The prompt-injection classifier. In production it is exported to ONNX and baked
# into the image at build (see scripts/bundle_injection_onnx.py) so detection runs
# offline; SPLYNTRA_INJECTION_MODEL_DIR points at that baked directory.
_INJECTION_MODEL_ID = "protectai/deberta-v3-base-prompt-injection-v2"
_INJECTION_MODEL_DIR = os.getenv("SPLYNTRA_INJECTION_MODEL_DIR", "/app/models/injection-onnx")


# Heuristic patterns for common injection techniques
INJECTION_PATTERNS = [
    (
        r"(?i)ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)",
        "instruction_override",
        "Attempt to override system instructions",
    ),
    (
        # Require a persona/role target after "you are now" so benign phrasing
        # ("you are now logged in", "you are now eligible …") doesn't false-trip.
        # Bare named-persona jailbreaks ("you are now DAN") aren't matched here by
        # design (a name isn't a determiner) — the well-known handles are covered
        # by the explicit branch, and novel ones fall to the ML backstop.
        r"(?i)you\s+are\s+now\s+(an?|the|acting\s+as|going\s+to|no\s+longer|in\s+\w+\s+mode|dan|stan|aim|dude)\b",
        "persona_hijack",
        "Attempt to reassign agent persona",
    ),
    (
        r"(?i)forget\s+(everything|all|your)\s+(you\s+)?(know|learned|instructions?)",
        "memory_wipe",
        "Attempt to clear agent instructions",
    ),
    (
        r"(?i)system\s*:\s*you\s+are",
        "system_prompt_injection",
        "Injected system prompt",
    ),
    (
        r"(?i)(do\s+not|don'?t)\s+follow\s+(your|the|any)\s+(instructions?|rules?|guidelines?)",
        "instruction_override",
        "Attempt to disable instruction following",
    ),
    (
        r"(?i)pretend\s+(you\s+are|to\s+be|that)",
        "persona_hijack",
        "Attempt to override agent behavior via pretense",
    ),
    (
        r"(?i)reveal\s+(your|the|system)\s+(system\s+)?(prompt|instructions?|rules?)",
        "prompt_extraction",
        "Attempt to extract system prompt",
    ),
    (
        r"(?i)\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>",
        "format_exploitation",
        "Chat template format tokens in user input",
    ),
    # ── Jailbreak templates (named personas / mode escapes) ──
    (
        r"(?i)\b(dan\s+mode|do\s+anything\s+now|developer\s+mode|jailbreak|\bAIM\b|stay\s+in\s+character\s+as)\b",
        "jailbreak",
        "Known jailbreak persona/template",
    ),
    (
        r"(?i)(without\s+(any\s+)?(restrictions?|filters?|guidelines?|censorship)|\bunfiltered\b|\bunrestricted\b|no\s+(restrictions?|filters?|limits?|rules?|guidelines?)|no\s+longer\s+bound\s+by)",
        "jailbreak",
        "Attempt to remove safety constraints",
    ),
    (
        r"(?i)(enable|activate)\s+(developer|god|unrestricted|admin)\s+mode",
        "jailbreak",
        "Attempt to activate an unrestricted mode",
    ),
]


class InjectionDetector:
    """Prompt injection detector - ships as BETA.

    Uses heuristic pattern matching as baseline.
    Non-blocking by default - informs, does not enforce.
    """

    def __init__(self):
        self.patterns = [
            (re.compile(pattern), category, description)
            for pattern, category, description in INJECTION_PATTERNS
        ]
        self._model = None  # Lazy-load ML model if available

    def scan(self, text: str) -> list[Detection]:
        """Scan text for prompt injection patterns."""
        detections = []

        # Heuristic pattern matching
        for regex, category, description in self.patterns:
            match = regex.search(text)
            if match:
                detections.append(
                    Detection(
                        detector="injection",
                        category=category,
                        severity="HIGH",
                        confidence=0.7,  # Heuristic = moderate confidence
                        description=description,
                        start=match.start(),
                        end=match.end(),
                        beta=True,  # Always beta for injection
                    )
                )

        # ML model scoring (if available)
        ml_score = self._ml_score(text)
        if ml_score is not None and ml_score > 0.8:
            detections.append(
                Detection(
                    detector="injection",
                    category="ml_classifier",
                    severity="HIGH",
                    confidence=round(ml_score, 2),
                    description="ML model detected likely prompt injection",
                    beta=True,
                )
            )

        return detections

    def _ml_score(self, text: str) -> float | None:
        """Score text using the DeBERTa injection classifier.

        Loads the locally-baked ONNX model first (offline, fast CPU inference),
        falling back to a HuggingFace transformers pipeline (downloads on first
        use), then to regex-only. Cached after the first call.
        """
        if self._model is None:
            self._model = self._load_model()
        if self._model is False:
            return None
        result = self._model(text[:512])
        if result and result[0]["label"] == "INJECTION":
            return result[0]["score"]
        return None

    @staticmethod
    def _load_model():
        """Return a text-classification pipeline, or False when unavailable."""
        # 1) Locally-baked ONNX model (bundled at build → offline + fast).
        if os.path.isdir(_INJECTION_MODEL_DIR) and os.listdir(_INJECTION_MODEL_DIR):
            try:
                from optimum.onnxruntime import ORTModelForSequenceClassification
                from transformers import AutoTokenizer, pipeline

                tokenizer = AutoTokenizer.from_pretrained(_INJECTION_MODEL_DIR)
                # Prefer a quantized ONNX file when present (smaller/faster).
                for fname in ("model_quantized.onnx", "model.onnx", None):
                    try:
                        kwargs = {"file_name": fname} if fname else {}
                        model = ORTModelForSequenceClassification.from_pretrained(_INJECTION_MODEL_DIR, **kwargs)
                        return pipeline("text-classification", model=model, tokenizer=tokenizer, truncation=True, max_length=512)
                    except Exception:  # noqa: BLE001 — try the next candidate file
                        continue
            except Exception:  # noqa: BLE001 — ONNX runtime not available; fall through
                pass
        # 2) HuggingFace transformers pipeline (fetches the model on first use).
        try:
            from transformers import pipeline

            return pipeline("text-classification", model=_INJECTION_MODEL_ID, truncation=True, max_length=512)
        except Exception:  # noqa: BLE001 — graceful degradation to regex-only
            return False
