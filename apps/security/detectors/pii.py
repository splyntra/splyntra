# SPDX-License-Identifier: FSL-1.1-ALv2
"""PII Detection using Microsoft Presidio."""

from __future__ import annotations

import re

from presidio_analyzer import AnalyzerEngine, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider
from .models import Detection

# Use the small spaCy model — bundled at build time (see Dockerfile) so there is
# no runtime model download. Presidio defaults to en_core_web_lg, which would
# otherwise try to download on first use and crash in a locked-down container.
_SPACY_MODEL = "en_core_web_sm"

# ─── India-specific PII (BRD §8.2): Aadhaar + PAN ────────────────────────────
# Aadhaar: 12 digits (never starting 0/1), optionally spaced 4-4-4, with a
# Verhoeff check digit — validating the checksum makes this near-zero false
# positive vs. a bare 12-digit match.
_AADHAAR_RE = re.compile(r"\b([2-9]\d{3})\s?(\d{4})\s?(\d{4})\b")
# Indian PAN: 5 letters + 4 digits + 1 letter; the 4th letter is the holder type.
_PAN_RE = re.compile(r"\b[A-Z]{3}[ABCFGHLJPTKE][A-Z]\d{4}[A-Z]\b", re.IGNORECASE)

# Verhoeff checksum tables (used by Aadhaar).
_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def _verhoeff_valid(number: str) -> bool:
    """True if the digit string passes the Verhoeff checksum (Aadhaar uses it)."""
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


class PIIDetector:
    """Wraps Microsoft Presidio for PII detection.

    Presidio provides GA-quality detection for:
    - Email addresses, phone numbers
    - Credit card numbers (PAN)
    - US SSN, passport numbers
    - Physical addresses
    - Names, dates of birth
    - Custom entities via configuration
    """

    def __init__(self):
        nlp_engine = NlpEngineProvider(
            nlp_configuration={
                "nlp_engine_name": "spacy",
                "models": [{"lang_code": "en", "model_name": _SPACY_MODEL}],
            }
        ).create_engine()
        self.analyzer = AnalyzerEngine(nlp_engine=nlp_engine)
        self.supported_entities = [
            "EMAIL_ADDRESS",
            "PHONE_NUMBER",
            "CREDIT_CARD",
            "US_SSN",
            "US_PASSPORT",
            "IBAN_CODE",
            "IP_ADDRESS",
            "PERSON",
            "LOCATION",
        ]

    def scan(self, text: str) -> list[Detection]:
        """Scan text for PII and return detections."""
        results: list[RecognizerResult] = self.analyzer.analyze(
            text=text,
            entities=self.supported_entities,
            language="en",
        )

        detections = []
        for result in results:
            severity = self._severity_for_entity(result.entity_type)
            detections.append(
                Detection(
                    detector="pii",
                    category=result.entity_type.lower(),
                    severity=severity,
                    confidence=round(result.score, 2),
                    description=f"PII detected: {result.entity_type}",
                    start=result.start,
                    end=result.end,
                    redacted=f"[REDACTED:{result.entity_type}]",
                    beta=False,
                )
            )

        detections.extend(self._scan_india(text))
        return detections

    def _scan_india(self, text: str) -> list[Detection]:
        """Detect India-specific identifiers (Aadhaar, PAN) that Presidio's
        default recognizers miss. Aadhaar is Verhoeff-validated to avoid flagging
        arbitrary 12-digit numbers (order IDs, timestamps)."""
        out: list[Detection] = []
        for m in _AADHAAR_RE.finditer(text):
            digits = (m.group(1) + m.group(2) + m.group(3))
            if not _verhoeff_valid(digits):
                continue
            out.append(
                Detection(
                    detector="pii",
                    category="aadhaar",
                    severity="CRITICAL",
                    confidence=0.95,
                    description="PII detected: AADHAAR (India)",
                    start=m.start(),
                    end=m.end(),
                    redacted="[REDACTED:AADHAAR]",
                    beta=False,
                )
            )
        for m in _PAN_RE.finditer(text):
            out.append(
                Detection(
                    detector="pii",
                    category="indian_pan",
                    severity="HIGH",
                    confidence=0.9,
                    description="PII detected: INDIAN_PAN",
                    start=m.start(),
                    end=m.end(),
                    redacted="[REDACTED:INDIAN_PAN]",
                    beta=False,
                )
            )
        return out

    def _severity_for_entity(self, entity_type: str) -> str:
        critical = {"CREDIT_CARD", "US_SSN", "US_PASSPORT", "IBAN_CODE"}
        high = {"EMAIL_ADDRESS", "PHONE_NUMBER", "IP_ADDRESS"}
        if entity_type in critical:
            return "CRITICAL"
        elif entity_type in high:
            return "HIGH"
        return "MEDIUM"
