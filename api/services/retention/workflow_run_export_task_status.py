"""
Helpers for workflow run export task status tracking.
"""

import json
from datetime import UTC, datetime

from extensions.ext_redis import redis_client

TASK_STATUS_TTL_SECONDS = 7 * 24 * 3600  # keep status for 7 days


def _task_key(task_id: str) -> str:
    return f"workflow_run_export:task:{task_id}"


def _run_key(tenant_id: str, app_id: str, run_id: str) -> str:
    return f"workflow_run_export:run:{tenant_id}:{app_id}:{run_id}"


def set_task_status(task_id: str, status: str, payload: dict | None = None) -> None:
    data = {
        "task_id": task_id,
        "status": status,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if payload:
        data.update(payload)
    redis_client.set(_task_key(task_id), json.dumps(data, default=str), ex=TASK_STATUS_TTL_SECONDS)


def get_task_status(task_id: str) -> dict | None:
    raw = redis_client.get(_task_key(task_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def reserve_task_for_run(tenant_id: str, app_id: str, run_id: str, task_id: str) -> str:
    """
    Record the export task id for a workflow run if not already set.

    Returns the existing task id if one was already recorded, otherwise the provided task_id.
    """
    key = _run_key(tenant_id, app_id, run_id)
    if redis_client.setnx(key, task_id):
        redis_client.expire(key, TASK_STATUS_TTL_SECONDS)
        return task_id

    existing = redis_client.get(key)
    if existing:
        return existing.decode() if isinstance(existing, bytes) else str(existing)
    return task_id


def get_task_id_for_run(tenant_id: str, app_id: str, run_id: str) -> str | None:
    key = _run_key(tenant_id, app_id, run_id)
    existing = redis_client.get(key)
    if not existing:
        return None
    return existing.decode() if isinstance(existing, bytes) else str(existing)
