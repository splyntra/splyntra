# SPDX-License-Identifier: FSL-1.1-ALv2
"""Splyntra Detector Service - FastAPI application."""

from fastapi import FastAPI
from contextlib import asynccontextmanager

from detectors.pii import PIIDetector
from detectors.secrets import SecretDetector
from detectors.injection import InjectionDetector
from detectors.moderation import ModerationDetector
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize detectors. Must stay in sync with the /detect route's
    # supported set and the NATS consumer, so the HTTP and streaming paths never
    # disagree on what "clean" means.
    app.state.pii_detector = PIIDetector()
    app.state.secret_detector = SecretDetector()
    app.state.injection_detector = InjectionDetector()
    app.state.moderation_detector = ModerationDetector()
    yield
    # Shutdown


app = FastAPI(
    title="Splyntra Detector Service",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(router)
