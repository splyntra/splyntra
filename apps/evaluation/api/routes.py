# SPDX-License-Identifier: FSL-1.1-ALv2
"""Evaluation service API — datasets, runs, regression gates."""

from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import storage
from .auth import Tenant, require_tenant
from scorers import SCORERS, PLUGIN_SCORERS, scorer_catalog
from scorers.engine import score_items, is_regression

router = APIRouter()

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:120] or "dataset"


# ─── Scorers catalog ─────────────────────────────────────────────────────────

@router.get("/v1/scorers")
def list_scorers(tenant: Tenant = Depends(require_tenant)):
    """Available scorers for the dashboard's Run-evaluation scorer picker."""
    return {"scorers": scorer_catalog()}


# ─── Datasets ──────────────────────────────────────────────────────────────

class DatasetItem(BaseModel):
    input: str
    expected_output: str = ""
    expected_tool_calls: List[str] = Field(default_factory=list)
    # Retrieved context / source material for RAG groundedness + faithfulness.
    context: str = ""


class CreateDataset(BaseModel):
    name: str
    description: str = ""
    items: List[DatasetItem] = Field(default_factory=list)


@router.post("/v1/datasets", status_code=201)
def create_dataset(body: CreateDataset, tenant: Tenant = Depends(require_tenant)):
    slug = _slug(body.name)
    items = [i.model_dump() for i in body.items]
    # Allocate + record the version atomically under a dataset-row lock so two
    # concurrent uploads can't both read the same MAX(version)+1, write the same S3
    # key, and collide on the version unique key (the previous three-transaction
    # code raced here). FOR UPDATE serializes uploaders: the second blocks until
    # the first commits, then reads the next version. The S3 PUT is done AFTER the
    # transaction commits (connection released) — holding a pooled connection
    # across S3 I/O would exhaust the small pool under concurrent uploads.
    with storage.cursor() as cur:
        cur.execute(
            """
            INSERT INTO eval_datasets (org_id, project_id, name, slug, description)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (org_id, project_id, slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id::text
            """,
            (tenant.org_id, tenant.project_id, body.name, slug, body.description),
        )
        dataset_id = cur.fetchone()["id"]
        cur.execute("SELECT 1 FROM eval_datasets WHERE id = %s FOR UPDATE", (dataset_id,))
        cur.execute(
            "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM eval_dataset_versions WHERE dataset_id = %s",
            (dataset_id,),
        )
        version = cur.fetchone()["v"]
        key = f"{tenant.org_id}/{tenant.project_id}/{slug}/v{version}.jsonl"
        cur.execute(
            "INSERT INTO eval_dataset_versions (dataset_id, version, item_count, object_key) VALUES (%s,%s,%s,%s)",
            (dataset_id, version, len(items), key),
        )

    try:
        storage.put_items(key, items)
    except Exception:
        # The version row is committed but its object failed to upload; remove the
        # dangling row so the version doesn't point at a missing object.
        with storage.cursor() as cur:
            cur.execute(
                "DELETE FROM eval_dataset_versions WHERE dataset_id = %s AND version = %s",
                (dataset_id, version),
            )
        raise

    return {"dataset_id": dataset_id, "slug": slug, "version": version, "item_count": len(items)}


@router.get("/v1/datasets")
def list_datasets(tenant: Tenant = Depends(require_tenant)):
    with storage.cursor() as cur:
        cur.execute(
            """
            SELECT d.id::text, d.name, d.slug, d.description, d.created_at,
                   COALESCE(MAX(v.version), 0) AS latest_version,
                   COALESCE(MAX(v.item_count), 0) AS item_count
            FROM eval_datasets d
            LEFT JOIN eval_dataset_versions v ON v.dataset_id = d.id
            WHERE d.org_id = %s AND d.project_id = %s
            GROUP BY d.id ORDER BY d.created_at DESC
            """,
            (tenant.org_id, tenant.project_id),
        )
        return {"datasets": cur.fetchall()}


@router.get("/v1/datasets/{dataset_id}")
def get_dataset(dataset_id: str, tenant: Tenant = Depends(require_tenant)):
    """Dataset detail: versions, current baseline, and the latest version's items
    (capped) — powers the dashboard's dataset drawer."""
    if not _UUID_RE.match(dataset_id):
        raise HTTPException(status_code=404, detail="dataset not found")
    with storage.cursor() as cur:
        cur.execute(
            "SELECT id::text, name, slug, description, created_at FROM eval_datasets WHERE id = %s AND org_id = %s AND project_id = %s",
            (dataset_id, tenant.org_id, tenant.project_id),
        )
        ds = cur.fetchone()
        if not ds:
            raise HTTPException(status_code=404, detail="dataset not found")
        cur.execute(
            "SELECT version, item_count, object_key, created_at FROM eval_dataset_versions WHERE dataset_id = %s ORDER BY version DESC",
            (dataset_id,),
        )
        versions = cur.fetchall()
        cur.execute("SELECT run_id::text, score FROM eval_baselines WHERE dataset_id = %s", (dataset_id,))
        baseline = cur.fetchone()
    items = []
    if versions and versions[0].get("object_key"):
        try:
            items = storage.get_items(versions[0]["object_key"])
        except Exception:  # noqa: BLE001 — missing object shouldn't fail the view
            items = []
    return {"dataset": ds, "versions": versions, "baseline": baseline, "items": items[:500]}


# ─── Runs ──────────────────────────────────────────────────────────────────

class RunResultIn(BaseModel):
    input: str = ""
    expected: str = ""
    actual: str = ""
    tool_calls: List[str] = Field(default_factory=list)
    expected_tool_calls: List[str] = Field(default_factory=list)
    latency_ms: float = 0
    cost_usd: float = 0
    # Optional retrieved context, for groundedness/faithfulness scoring when the
    # dataset item doesn't carry one (falls back to the dataset's stored context).
    context: str = ""


class RunRequest(BaseModel):
    dataset_id: str
    scorers: List[str] = Field(default_factory=list)
    results: List[RunResultIn] = Field(default_factory=list)
    set_baseline: bool = False
    gate: bool = True
    # Version of the agent/prompt under test — enables version-over-version
    # regression (compare to the previous version's run, not just one baseline).
    version: Optional[int] = None
    # Leaderboard dimensions (optional): which agent + model produced these results.
    agent_id: str = ""
    model: str = ""


def _dataset_owned(cur, dataset_id: str, tenant: Tenant):
    cur.execute(
        "SELECT id::text FROM eval_datasets WHERE id = %s AND org_id = %s AND project_id = %s",
        (dataset_id, tenant.org_id, tenant.project_id),
    )
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="dataset not found")


def _load_ground_truth(cur, dataset_id: str) -> dict:
    """Map input -> dataset item from the latest dataset version's stored JSONL,
    so scoring uses the server-owned expected outputs. Empty if absent."""
    cur.execute(
        "SELECT object_key FROM eval_dataset_versions WHERE dataset_id = %s ORDER BY version DESC LIMIT 1",
        (dataset_id,),
    )
    row = cur.fetchone()
    if not row or not row.get("object_key"):
        return {}
    try:
        ds_items = storage.get_items(row["object_key"])
    except Exception:  # noqa: BLE001 — missing object shouldn't fail the run
        return {}
    return {it.get("input", ""): it for it in ds_items if it.get("input")}


@router.post("/v1/evaluations/run")
def run_evaluation(body: RunRequest, tenant: Tenant = Depends(require_tenant)):
    if not body.results:
        raise HTTPException(status_code=400, detail="no results to score")

    # Reject unknown scorer names up front. Otherwise the engine silently drops
    # them and a CI gate can "pass" on a typo'd scorer — a dangerous false green.
    known = set(SCORERS) | set(PLUGIN_SCORERS)
    unknown = [s for s in body.scorers if s not in known]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"unknown scorer(s): {', '.join(unknown)}. Available: {', '.join(sorted(known))}",
        )

    items = [r.model_dump() for r in body.results]

    # Join the dataset's server-owned ground truth to the submitted results by
    # input, so scores reflect the dataset's expected outputs rather than the
    # caller-supplied `expected` (which the client controls and could spoof).
    with storage.cursor() as cur:
        _dataset_owned(cur, body.dataset_id, tenant)
        ground_truth = _load_ground_truth(cur, body.dataset_id)
    matched = 0
    for it in items:
        g = ground_truth.get(it.get("input", ""))
        if g:
            it["expected"] = g.get("expected_output", it.get("expected", ""))
            it["expected_tool_calls"] = g.get("expected_tool_calls", it.get("expected_tool_calls", []))
            # Prefer the dataset's server-owned context; fall back to the client's.
            if g.get("context"):
                it["context"] = g["context"]
            matched += 1

    scored = score_items(items, body.scorers)

    version = body.version or 1

    with storage.cursor() as cur:
        # Version-over-version regression: when a version is supplied, compare to
        # the most recent PRIOR version's run for this dataset; otherwise fall back
        # to the single stored baseline. Either way, a drop beyond the delta gates.
        baseline = None
        if body.version:
            cur.execute(
                """
                SELECT score FROM eval_runs
                WHERE dataset_id = %s AND org_id = %s AND project_id = %s AND version < %s
                ORDER BY version DESC, created_at DESC LIMIT 1
                """,
                (body.dataset_id, tenant.org_id, tenant.project_id, version),
            )
            prev = cur.fetchone()
            baseline = prev["score"] if prev else None
        if baseline is None:
            cur.execute("SELECT score FROM eval_baselines WHERE dataset_id = %s", (body.dataset_id,))
            row = cur.fetchone()
            baseline = row["score"] if row else None
        regression = is_regression(scored["score"], baseline)
        passed = not (body.gate and regression)

        import json as _json

        cur.execute(
            """
            INSERT INTO eval_runs (org_id, project_id, dataset_id, version, agent_id, model, score, item_count, passed, regression, per_scorer)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id::text
            """,
            (
                tenant.org_id, tenant.project_id, body.dataset_id, version,
                body.agent_id or None, body.model or None, scored["score"],
                len(items), passed, regression, _json.dumps(scored["per_scorer"]),
            ),
        )
        run_id = cur.fetchone()["id"]
        for r in scored["results"]:
            cur.execute(
                "INSERT INTO eval_results (run_id, idx, input, expected, actual, passed, scores) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (run_id, r["idx"], r["input"], r["expected"], r["actual"], r["passed"], _json.dumps(r["scores"])),
            )
        if body.set_baseline:
            cur.execute(
                """
                INSERT INTO eval_baselines (dataset_id, run_id, score) VALUES (%s,%s,%s)
                ON CONFLICT (dataset_id) DO UPDATE SET run_id = EXCLUDED.run_id, score = EXCLUDED.score, updated_at = NOW()
                """,
                (body.dataset_id, run_id, scored["score"]),
            )

    return {
        "run_id": run_id,
        "version": version,
        "score": round(scored["score"], 4),
        "per_scorer": {k: round(v, 4) for k, v in scored["per_scorer"].items()},
        "baseline": baseline,
        "regression": regression,
        "passed": passed,
        "matched_dataset_items": matched,
        "item_count": len(items),
    }


@router.get("/v1/evaluations/leaderboard")
def leaderboard(dataset_id: Optional[str] = None, tenant: Tenant = Depends(require_tenant)):
    """Rank agents/models by their eval performance. Grouped by (agent_id, model),
    returns best + latest score, pass-rate, and run count. Ranks SUBMITTED runs —
    the service does not execute agents (results are produced client-side)."""
    # Declared before /v1/evaluations/{run_id} so the static path isn't captured
    # by the {run_id} param route.
    where = "org_id = %s AND project_id = %s AND agent_id IS NOT NULL"
    params: list = [tenant.org_id, tenant.project_id]
    if dataset_id:
        where += " AND dataset_id = %s"
        params.append(dataset_id)
    with storage.cursor() as cur:
        cur.execute(
            f"""
            SELECT agent_id,
                   COALESCE(model, '') AS model,
                   COUNT(*) AS runs,
                   MAX(score) AS best_score,
                   (ARRAY_AGG(score ORDER BY created_at DESC))[1] AS latest_score,
                   AVG(CASE WHEN passed THEN 1.0 ELSE 0.0 END) AS pass_rate,
                   MAX(created_at) AS last_run_at
            FROM eval_runs
            WHERE {where}
            GROUP BY agent_id, model
            ORDER BY best_score DESC NULLS LAST
            LIMIT 100
            """,
            params,
        )
        return {"leaderboard": cur.fetchall()}


@router.get("/v1/evaluations/{run_id}")
def get_run(run_id: str, tenant: Tenant = Depends(require_tenant)):
    """Return a run plus its per-item results (already persisted at run time)."""
    if not _UUID_RE.match(run_id):
        raise HTTPException(status_code=404, detail="run not found")
    with storage.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, dataset_id::text, version, agent_id, model, score, item_count, passed, regression, per_scorer, created_at
            FROM eval_runs WHERE id = %s AND org_id = %s AND project_id = %s
            """,
            (run_id, tenant.org_id, tenant.project_id),
        )
        run = cur.fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        cur.execute(
            "SELECT idx, input, expected, actual, passed, scores FROM eval_results WHERE run_id = %s ORDER BY idx ASC",
            (run_id,),
        )
        items = cur.fetchall()
    return {"run": run, "items": items}


@router.post("/v1/evaluations/{run_id}/baseline")
def set_run_baseline(run_id: str, tenant: Tenant = Depends(require_tenant)):
    """Promote an existing run to its dataset's baseline (future runs gate against it)."""
    if not _UUID_RE.match(run_id):
        raise HTTPException(status_code=404, detail="run not found")
    with storage.cursor() as cur:
        cur.execute(
            "SELECT dataset_id::text, score FROM eval_runs WHERE id = %s AND org_id = %s AND project_id = %s",
            (run_id, tenant.org_id, tenant.project_id),
        )
        run = cur.fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        cur.execute(
            """
            INSERT INTO eval_baselines (dataset_id, run_id, score) VALUES (%s,%s,%s)
            ON CONFLICT (dataset_id) DO UPDATE SET run_id = EXCLUDED.run_id, score = EXCLUDED.score, updated_at = NOW()
            """,
            (run["dataset_id"], run_id, run["score"]),
        )
    return {"status": "ok", "dataset_id": run["dataset_id"], "score": run["score"]}


@router.get("/v1/evaluations")
def list_runs(dataset_id: Optional[str] = None, tenant: Tenant = Depends(require_tenant)):
    with storage.cursor() as cur:
        if dataset_id:
            cur.execute(
                """
                SELECT id::text, dataset_id::text, version, agent_id, model, score, item_count, passed, regression, per_scorer, created_at
                FROM eval_runs WHERE org_id = %s AND project_id = %s AND dataset_id = %s
                ORDER BY created_at DESC LIMIT 100
                """,
                (tenant.org_id, tenant.project_id, dataset_id),
            )
        else:
            cur.execute(
                """
                SELECT id::text, dataset_id::text, version, agent_id, model, score, item_count, passed, regression, per_scorer, created_at
                FROM eval_runs WHERE org_id = %s AND project_id = %s
                ORDER BY created_at DESC LIMIT 100
                """,
                (tenant.org_id, tenant.project_id),
            )
        return {"runs": cur.fetchall()}
