# SPDX-License-Identifier: FSL-1.1-ALv2
"""API routes for the detector service."""

from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from detectors.models import Detection

router = APIRouter()

# Internal service token for service-to-service auth
INTERNAL_SERVICE_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")

MAX_CONTENT_LENGTH = 100_000  # 100KB max content per request


class DetectRequest(BaseModel):
    """Request to run detectors on text content."""

    trace_id: str
    span_id: str
    content: str = Field(..., max_length=MAX_CONTENT_LENGTH)
    content_type: str = "text"  # text, prompt, completion, tool_input, tool_output
    detectors: list[str] | None = None  # None = run all


class DetectResponse(BaseModel):
    trace_id: str
    span_id: str
    risk_score: int  # 0-100
    detections: list[Detection]


@router.post("/detect", response_model=DetectResponse)
async def detect(request: Request, body: DetectRequest) -> DetectResponse:
    """Run all configured detectors against the provided content."""
    import asyncio

    # Service-to-service authentication
    if INTERNAL_SERVICE_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer ") or auth_header[7:] != INTERNAL_SERVICE_TOKEN:
            raise HTTPException(status_code=401, detail="Unauthorized")

    detections: list[Detection] = []

    run_all = body.detectors is None

    # Secret detection (fast, regex-based - run inline)
    if run_all or "secrets" in body.detectors:
        secret_detector = request.app.state.secret_detector
        secret_hits = secret_detector.scan(body.content)
        detections.extend(secret_hits)

    # PII detection (CPU-bound NLP - offload to thread pool)
    if run_all or "pii" in body.detectors:
        pii_detector = request.app.state.pii_detector
        pii_hits = await asyncio.to_thread(pii_detector.scan, body.content)
        detections.extend(pii_hits)

    # Prompt injection detection (CPU-bound ML - offload to thread pool)
    if run_all or "injection" in body.detectors:
        injection_detector = request.app.state.injection_detector
        injection_hits = await asyncio.to_thread(injection_detector.scan, body.content)
        detections.extend(injection_hits)

    # Compute risk score
    risk_score = compute_risk_score(detections)

    return DetectResponse(
        trace_id=body.trace_id,
        span_id=body.span_id,
        risk_score=risk_score,
        detections=detections,
    )


@router.get("/health")
async def health():
    return {"status": "ok", "service": "detector"}


def compute_risk_score(detections: list[Detection]) -> int:
    """Compute composite risk score 0-100 from detections."""
    if not detections:
        return 0

    severity_weights = {"CRITICAL": 40, "HIGH": 25, "MEDIUM": 10, "LOW": 5}
    score = 0
    for d in detections:
        weight = severity_weights.get(d.severity, 5)
        score += int(weight * d.confidence)

    return min(score, 100)
