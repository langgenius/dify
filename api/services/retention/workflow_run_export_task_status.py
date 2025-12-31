"""
Helpers for workflow run export task status tracking.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from extensions.ext_redis import redis_client
from libs.archive_storage import get_archive_storage

TASK_STATUS_TTL_SECONDS = 7 * 24 * 3600
EXPORT_SIGNED_URL_EXPIRE_SECONDS = 3600
PUBLIC_TASK_STATUS_FIELDS = {
    "task_id",
    "status",
    "presigned_url",
    "presigned_url_expires_at",
}


def _task_key(task_id: str) -> str:
    return f"workflow_run_export:task:{task_id}"


def _run_key(tenant_id: str, app_id: str, run_id: str) -> str:
    return f"workflow_run_export:run:{tenant_id}:{app_id}:{run_id}"


def _save_task_status(task_id: str, data: dict) -> None:
    redis_client.set(_task_key(task_id), json.dumps(data, default=str), ex=TASK_STATUS_TTL_SECONDS)


def set_task_status(task_id: str, status: str, payload: dict | None = None) -> None:
    data = {
        "task_id": task_id,
        "status": status,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if payload:
        data.update(payload)
    if data.get("presigned_url") and not data.get("presigned_url_expires_at"):
        data["presigned_url_expires_at"] = (
            datetime.now(UTC) + timedelta(seconds=EXPORT_SIGNED_URL_EXPIRE_SECONDS)
        ).isoformat()
    _save_task_status(task_id, data)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _is_presigned_url_expired(status: dict) -> bool:
    expires_at = _parse_iso_datetime(status.get("presigned_url_expires_at"))
    if expires_at:
        return expires_at <= datetime.now(UTC)
    return True


def _refresh_presigned_url(task_id: str, status: dict) -> dict:
    if status.get("status") != "success":
        return status
    storage_key = status.get("storage_key")
    if not storage_key:
        return status
    if status.get("presigned_url") and not _is_presigned_url_expired(status):
        return status

    try:
        storage = get_archive_storage()
        presigned_url = storage.generate_presigned_url(
            storage_key,
            expires_in=EXPORT_SIGNED_URL_EXPIRE_SECONDS,
        )
    except Exception:
        return status

    now = datetime.now(UTC)
    status["presigned_url"] = presigned_url
    status["presigned_url_expires_at"] = (now + timedelta(seconds=EXPORT_SIGNED_URL_EXPIRE_SECONDS)).isoformat()
    status["updated_at"] = now.isoformat()
    _save_task_status(task_id, status)
    return status


def get_task_status(task_id: str) -> dict | None:
    raw = redis_client.get(_task_key(task_id))
    if not raw:
        return None
    try:
        status = json.loads(raw)
    except Exception:
        return None
    return _refresh_presigned_url(task_id, status)


def get_public_task_status(task_id: str) -> dict[str, Any] | None:
    status = get_task_status(task_id)
    if not status:
        return None
    return {key: status[key] for key in PUBLIC_TASK_STATUS_FIELDS if key in status}


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
