# SPDX-License-Identifier: AGPL-3.0-only
"""PII Detection using Microsoft Presidio."""

from __future__ import annotations

from presidio_analyzer import AnalyzerEngine, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider
from .models import Detection

# Use the small spaCy model — bundled at build time (see Dockerfile) so there is
# no runtime model download. Presidio defaults to en_core_web_lg, which would
# otherwise try to download on first use and crash in a locked-down container.
_SPACY_MODEL = "en_core_web_sm"


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

        return detections

    def _severity_for_entity(self, entity_type: str) -> str:
        critical = {"CREDIT_CARD", "US_SSN", "US_PASSPORT", "IBAN_CODE"}
        high = {"EMAIL_ADDRESS", "PHONE_NUMBER", "IP_ADDRESS"}
        if entity_type in critical:
            return "CRITICAL"
        elif entity_type in high:
            return "HIGH"
        return "MEDIUM"
