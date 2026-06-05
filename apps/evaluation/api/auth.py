# SPDX-License-Identifier: AGPL-3.0-only
"""API-key authentication, sharing the collector's api_keys table + hashing.

Resolves a Bearer token to a tenant (org_id, project_id). In development the
seeded `splyntra_dev_key` maps to the seeded org/project UUIDs (mirrors the
collector's dev fallback).
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException

from . import storage

_DEV_ORG = "00000000-0000-0000-0000-000000000001"
_DEV_PROJECT = "00000000-0000-0000-0000-000000000002"


@dataclass
class Tenant:
    org_id: str
    project_id: str


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def resolve(authorization: Optional[str]) -> Tenant:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing api key")
    key = authorization[len("Bearer "):]

    if os.getenv("ENV") == "development" and key == "splyntra_dev_key":
        return Tenant(org_id=_DEV_ORG, project_id=_DEV_PROJECT)

    with storage.cursor() as cur:
        cur.execute(
            """
            SELECT k.org_id::text AS org_id,
                   COALESCE(k.project_id::text, '') AS project_id
            FROM api_keys k
            WHERE k.key_hash = %s AND k.is_active = TRUE
              AND (k.expires_at IS NULL OR k.expires_at > NOW())
            """,
            (_hash(key),),
        )
        row = cur.fetchone()
    if not row or not row["project_id"]:
        raise HTTPException(status_code=401, detail="invalid api key")
    return Tenant(org_id=row["org_id"], project_id=row["project_id"])


def require_tenant(authorization: Optional[str] = Header(default=None)) -> Tenant:
    """FastAPI dependency."""
    return resolve(authorization)
