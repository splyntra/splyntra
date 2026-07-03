# SPDX-License-Identifier: AGPL-3.0-only
"""Prompt Injection Detection - BETA.

Uses heuristic pattern matching as the baseline.
Optional: DeBERTa-based classifier model for higher accuracy.
Clearly labeled as BETA - informs, does not enforce.
"""

from __future__ import annotations

import re
from .models import Detection


# Heuristic patterns for common injection techniques
INJECTION_PATTERNS = [
    (
        r"(?i)ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)",
        "instruction_override",
        "Attempt to override system instructions",
    ),
    (
        r"(?i)you\s+are\s+now\s+",
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
        r"(?i)(without\s+(any\s+)?(restrictions?|filters?|guidelines?|censorship)|unfiltered|no\s+longer\s+bound\s+by)",
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
        """Score text using DeBERTa-based injection classifier (optional)."""
        if self._model is None:
            try:
                from transformers import pipeline

                self._model = pipeline(
                    "text-classification",
                    model="protectai/deberta-v3-base-prompt-injection-v2",
                    truncation=True,
                    max_length=512,
                )
            except (ImportError, Exception):
                # ML model not available - graceful degradation
                self._model = False
                return None

        if self._model is False:
            return None

        result = self._model(text[:512])
        if result and result[0]["label"] == "INJECTION":
            return result[0]["score"]
        return None
