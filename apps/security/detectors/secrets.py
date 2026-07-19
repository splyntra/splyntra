# SPDX-License-Identifier: FSL-1.1-ALv2
"""Secret Detection using gitleaks-style patterns.

Patterns are derived from the gitleaks rule sets (Go-native, Apache-2.0 licensed).
We reimplement the regex patterns in Python for the detector sidecar.
"""

from __future__ import annotations

import math
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
        description="OpenAI API Key (legacy)",
        regex=re.compile(r"sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}"),
        severity="CRITICAL",
    ),
    SecretPattern(
        id="openai-key-project",
        description="OpenAI API Key (project/service/admin)",
        # Modern OpenAI keys: sk-proj-…, sk-svcacct-…, sk-admin-… (issued since
        # 2024). These don't embed the legacy T3BlbkFJ marker and start with a
        # `-`-containing prefix, so the legacy pattern never matches them.
        regex=re.compile(r"sk-(proj|svcacct|admin)-[A-Za-z0-9_-]{20,}"),
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


# Generic patterns match any high-length token, so they need a Shannon-entropy
# gate to avoid flagging low-entropy placeholders (e.g. api_key=YOUR_KEY_HERE or
# a repetitive value). Vendor-specific patterns (AWS/GitHub/Stripe/…) are precise
# formats and stay unconditional.
_ENTROPY_GATED = {"generic-api-key", "database-url"}
_MIN_ENTROPY = 3.0  # bits/char; random base64/hex secrets are ~4-5, filler <3


def _shannon_entropy(s: str) -> float:
    """Shannon entropy (bits per character) of a string."""
    if not s:
        return 0.0
    from collections import Counter

    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in Counter(s).values())


class SecretDetector:
    """Pattern + entropy-gated secret detector.

    Uses gitleaks-style regex patterns for known secret formats; the generic
    catch-all patterns additionally require sufficient Shannon entropy so
    placeholders don't false-positive. High precision, GA quality.
    """

    def __init__(self):
        self.patterns = SECRET_PATTERNS

    def scan(self, text: str) -> list[Detection]:
        """Scan text for secrets and return detections."""
        detections = []

        for pattern in self.patterns:
            for match in pattern.regex.finditer(text):
                confidence = 0.95  # precise vendor pattern → high confidence
                if pattern.id in _ENTROPY_GATED:
                    entropy = _shannon_entropy(match.group(0))
                    if entropy < _MIN_ENTROPY:
                        continue  # low-entropy → placeholder/false positive, skip
                    # Scale confidence with entropy above the floor.
                    confidence = round(min(0.95, 0.6 + (entropy - _MIN_ENTROPY) * 0.15), 2)
                detections.append(
                    Detection(
                        detector="secrets",
                        category=pattern.id,
                        severity=pattern.severity,
                        confidence=confidence,
                        description=pattern.description,
                        start=match.start(),
                        end=match.end(),
                        redacted=f"[REDACTED:{pattern.id.upper()}]",
                        beta=False,
                    )
                )

        return detections
