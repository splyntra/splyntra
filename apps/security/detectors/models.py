# SPDX-License-Identifier: AGPL-3.0-only
"""Shared models for the detector service."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class Detection(BaseModel):
    detector: str
    category: str
    severity: str  # LOW, MEDIUM, HIGH, CRITICAL
    confidence: float
    description: str
    start: Optional[int] = None
    end: Optional[int] = None
    redacted: Optional[str] = None
    beta: bool = False
