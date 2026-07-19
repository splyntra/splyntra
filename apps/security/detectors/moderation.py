# SPDX-License-Identifier: FSL-1.1-ALv2
"""Output moderation detector — flags toxic / harmful model output.

Heuristic baseline (lexical) with an optional ML classifier (detoxify) that
degrades gracefully when the dependency is absent — the same pattern the
injection detector uses for DeBERTa. Scans the model *output*, not the prompt.
Ships as BETA.
"""

from __future__ import annotations

import re

from .models import Detection

# category -> compiled term pattern. Deliberately conservative word-boundary
# matches to limit false positives on benign text.
_CATEGORIES = {
    "hate": r"\b(kill all|exterminate|subhuman|racial slur|genocide)\b",
    "violence": r"\b(how to (make|build) a (bomb|explosive)|detonat\w*|mass shooting|assassinat\w*)\b",
    "self_harm": r"\b(how to (kill|hurt) (myself|yourself)|commit suicide|ways to self-harm)\b",
    "sexual_minors": r"\b(child (porn|sexual)|csam|minor.{0,10}explicit)\b",
}

_SEVERITY = {
    "hate": "HIGH",
    "violence": "HIGH",
    "self_harm": "HIGH",
    "sexual_minors": "CRITICAL",
}


class ModerationDetector:
    """Output toxicity / harm detector. Non-blocking (BETA)."""

    def __init__(self):
        self._patterns = {cat: re.compile(p, re.IGNORECASE) for cat, p in _CATEGORIES.items()}
        self._model = None  # lazy-loaded detoxify pipeline if available

    def scan(self, text: str) -> list[Detection]:
        detections: list[Detection] = []

        for category, regex in self._patterns.items():
            m = regex.search(text)
            if m:
                detections.append(
                    Detection(
                        detector="moderation",
                        category=category,
                        severity=_SEVERITY.get(category, "MEDIUM"),
                        confidence=0.7,
                        description=f"Potentially harmful content ({category})",
                        start=m.start(),
                        end=m.end(),
                        beta=True,
                    )
                )

        score = self._ml_score(text)
        if score is not None and score > 0.8:
            detections.append(
                Detection(
                    detector="moderation",
                    category="toxicity",
                    severity="HIGH",
                    confidence=round(score, 2),
                    description="ML model flagged toxic content",
                    beta=True,
                )
            )

        return detections

    def _ml_score(self, text: str) -> float | None:
        """Score with detoxify if installed; otherwise degrade gracefully."""
        if self._model is None:
            try:
                from detoxify import Detoxify

                self._model = Detoxify("original")
            except Exception:
                self._model = False
                return None
        if self._model is False:
            return None
        try:
            results = self._model.predict(text[:2000])
            return float(max(results.values()))
        except Exception:
            return None
