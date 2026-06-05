# SPDX-License-Identifier: AGPL-3.0-only
"""Splyntra Evaluation Service — FastAPI application."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import storage
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage.init()
    yield
    storage.close()


app = FastAPI(title="Splyntra Evaluation Service", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


app.include_router(router)
