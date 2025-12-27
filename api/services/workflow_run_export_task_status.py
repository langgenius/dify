"""
Helpers for workflow run export task status tracking.
"""

import json
from datetime import UTC, datetime

from extensions.ext_redis import redis_client

TASK_STATUS_TTL_SECONDS = 7 * 24 * 3600  # keep status for 7 days


def _task_key(task_id: str) -> str:
    return f"workflow_run_export:task:{task_id}"


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
