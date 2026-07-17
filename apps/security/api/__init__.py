# SPDX-License-Identifier: FSL-1.1-ALv2
"""Splyntra Detector Service - FastAPI application."""

from fastapi import FastAPI
from contextlib import asynccontextmanager

from detectors.pii import PIIDetector
from detectors.secrets import SecretDetector
from detectors.injection import InjectionDetector
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize detectors
    app.state.pii_detector = PIIDetector()
    app.state.secret_detector = SecretDetector()
    app.state.injection_detector = InjectionDetector()
    yield
    # Shutdown


app = FastAPI(
    title="Splyntra Detector Service",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(router)
