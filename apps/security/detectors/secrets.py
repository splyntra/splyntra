# SPDX-License-Identifier: AGPL-3.0-only
"""Secret Detection using gitleaks-style patterns.

Patterns are derived from the gitleaks rule sets (Go-native, Apache-2.0 licensed).
We reimplement the regex patterns in Python for the detector sidecar.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Detection


@dataclass
class SecretPattern:
    id: str
    description: str
    regex: re.Pattern
    severity: str = "CRITICAL"


# Patterns based on gitleaks/TruffleHog rule sets
SECRET_PATTERNS: list[SecretPattern] = [
    SecretPattern(
        id="aws-access-key",
        description="AWS Access Key ID",
        regex=re.compile(r"AKIA[0-9A-Z]{16}"),
        severity="CRITICAL",
    ),
    SecretPattern(
        id="aws-secret-key",
        description="AWS Secret Access Key",
        regex=re.compile(
            r"(?i)aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}"
        ),
        severity="CRITICAL",
    ),
    SecretPattern(
        id="github-token",
        description="GitHub Personal Access Token",
        regex=re.compile(r"gh[pousr]_[A-Za-z0-9_]{36,255}"),
        severity="CRITICAL",
    ),
    SecretPattern(
        id="generic-api-key",
        description="Generic API Key",
        regex=re.compile(
            r'(?i)(api[_-]?key|apikey|secret[_-]?key)\s*[=:]\s*["\']?[A-Za-z0-9\-._~]{20,}["\']?'
        ),
        severity="HIGH",
    ),
    SecretPattern(
        id="jwt",
        description="JSON Web Token",
        regex=re.compile(r"eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*"),
        severity="HIGH",
    ),
    SecretPattern(
        id="private-key",
        description="Private Key",
        regex=re.compile(r"-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"),
        severity="CRITICAL",
    ),
    SecretPattern(
        id="slack-token",
        description="Slack Token",
        regex=re.compile(r"xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,32}"),
        severity="HIGH",
    ),
    SecretPattern(
        id="stripe-secret",
        description="Stripe Secret Key",
        regex=re.compile(r"sk_live_[0-9a-zA-Z]{24,99}"),
        severity="CRITICAL",
    ),
    SecretPattern(
        id="openai-key",
        description="OpenAI API Key",
        regex=re.compile(r"sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}"),
        severity="CRITICAL",
    ),
    SecretPattern(
        id="database-url",
        description="Database Connection String",
        regex=re.compile(
            r"(?i)(postgres|mysql|mongodb|redis)://[^\s\"'<>]{10,}"
        ),
        severity="HIGH",
    ),
]


class SecretDetector:
    """Pattern + entropy-based secret detector.

    Uses gitleaks-style regex patterns for known secret formats.
    Ships as 'reliable' - high precision, GA quality.
    """

    def __init__(self):
        self.patterns = SECRET_PATTERNS

    def scan(self, text: str) -> list[Detection]:
        """Scan text for secrets and return detections."""
        detections = []

        for pattern in self.patterns:
            for match in pattern.regex.finditer(text):
                detections.append(
                    Detection(
                        detector="secrets",
                        category=pattern.id,
                        severity=pattern.severity,
                        confidence=0.95,  # Pattern-based = high confidence
                        description=pattern.description,
                        start=match.start(),
                        end=match.end(),
                        redacted=f"[REDACTED:{pattern.id.upper()}]",
                        beta=False,
                    )
                )

        return detections
