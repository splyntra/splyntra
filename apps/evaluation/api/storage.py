# SPDX-License-Identifier: AGPL-3.0-only
"""Postgres + object-storage (MinIO/S3) helpers for the evaluation service.

Postgres holds dataset/run metadata; the object store holds dataset items as
JSONL. Both are initialized lazily and shared across requests.
"""

from __future__ import annotations

import io
import json
import os
from contextlib import contextmanager
from typing import Iterator, List, Optional

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

_pool: Optional[ThreadedConnectionPool] = None
_s3 = None
_BUCKET = os.getenv("EVAL_BUCKET", "splyntra-datasets")


def init() -> None:
    """Initialize the DB pool and ensure the dataset bucket exists."""
    global _pool, _s3
    dsn = os.getenv(
        "POSTGRES_DSN",
        "postgres://splyntra:splyntra@localhost:5432/splyntra?sslmode=disable",
    )
    _pool = ThreadedConnectionPool(1, 10, dsn)

    import boto3
    from botocore.client import Config

    _s3 = boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY", "minioadmin"),
        config=Config(signature_version="s3v4"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
    )
    try:
        _s3.head_bucket(Bucket=_BUCKET)
    except Exception:  # noqa: BLE001 - create if missing
        try:
            _s3.create_bucket(Bucket=_BUCKET)
        except Exception:  # noqa: BLE001 - already exists / race
            pass


def close() -> None:
    if _pool:
        _pool.closeall()


@contextmanager
def cursor() -> Iterator[psycopg2.extras.RealDictCursor]:
    assert _pool is not None, "storage not initialized"
    conn = _pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


# ─── Object storage ────────────────────────────────────────────────────────

def put_items(key: str, items: List[dict]) -> None:
    body = "\n".join(json.dumps(i) for i in items).encode("utf-8")
    _s3.put_object(Bucket=_BUCKET, Key=key, Body=io.BytesIO(body), ContentLength=len(body))


def get_items(key: str) -> List[dict]:
    obj = _s3.get_object(Bucket=_BUCKET, Key=key)
    text = obj["Body"].read().decode("utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]
