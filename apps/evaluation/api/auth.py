# SPDX-License-Identifier: AGPL-3.0-only
"""API-key authentication, sharing the collector's api_keys table + hashing.

Resolves a Bearer token to a tenant (org_id, project_id). In development the
seeded `splyntra_dev_key` maps to the seeded org/project UUIDs (mirrors the
collector's dev fallback).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException, Query

from . import storage

_DEV_ORG = "00000000-0000-0000-0000-000000000001"
_DEV_PROJECT = "00000000-0000-0000-0000-000000000002"
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


@dataclass
class Tenant:
    org_id: str
    project_id: str


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def resolve(
    authorization: Optional[str],
    org_header: Optional[str] = None,
    project_header: Optional[str] = None,
) -> Tenant:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing api key")
    key = authorization[len("Bearer "):]

    # Trusted first-party channel: the dashboard BFF presents the shared service
    # token plus X-Splyntra-Org-Id / X-Splyntra-Project-Id headers to scope the
    # request to the user's ACTIVE org (the BFF has already verified membership).
    # Honored only on a constant-time token match — mirrors the collector.
    service_token = os.getenv("COLLECTOR_SERVICE_TOKEN", "")
    if service_token and hmac.compare_digest(key, service_token):
        # Mirror the collector: X-Splyntra-Org-Id is required; the project is
        # OPTIONAL on this trusted channel (the BFF scopes to the active org and
        # the client drives the project via ?project_id=, honored in
        # require_tenant below). Never require the project header here — the cloud
        # BFF doesn't send it, and requiring it would 400 every request.
        if not org_header or not _UUID_RE.match(org_header):
            raise HTTPException(status_code=400, detail="service token requires a valid X-Splyntra-Org-Id")
        project = project_header if (project_header and _UUID_RE.match(project_header)) else ""
        return Tenant(org_id=org_header, project_id=project)

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


def require_tenant(
    authorization: Optional[str] = Header(default=None),
    x_splyntra_org_id: Optional[str] = Header(default=None),
    x_splyntra_project_id: Optional[str] = Header(default=None),
    project_id: Optional[str] = Query(default=None),
) -> Tenant:
    """FastAPI dependency. Honors an explicit ?project_id= to scope within the
    authenticated org — the eval analog of the collector's effectiveProject, so
    the dashboard's project switcher applies to evaluation data. Org scoping still
    comes only from auth (a query param can never cross orgs: every query filters
    on the authed org_id AND this project_id)."""
    tenant = resolve(authorization, x_splyntra_org_id, x_splyntra_project_id)
    if project_id and _UUID_RE.match(project_id):
        return Tenant(org_id=tenant.org_id, project_id=project_id)
    return tenant
