"""Asynchronous website datasource previews that do not hold Console HTTP workers."""

from __future__ import annotations

import json
import uuid
from typing import Literal

from celery import current_app as celery_app

from extensions.ext_redis import redis_client
from models.account import Account
from services.knowledge_fs.initial_source_preview import KnowledgeFSInitialSourcePreviewService
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialSourcePreviewJobCreateResponse,
    KnowledgeFSInitialSourcePreviewJobResponse,
    KnowledgeFSInitialSourcePreviewResponse,
    KnowledgeFSInitialWebsiteSourcePreviewPayload,
)

_JOB_TTL_SECONDS = 60 * 60
_RELEASE_ACTIVE_JOB_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""
_TRANSITION_STATUS_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
for index = 3, #ARGV do
  if decoded.status == ARGV[index] then
    redis.call('SETEX', KEYS[1], ARGV[2], ARGV[1])
    return 1
  end
end
return 0
"""


class KnowledgeFSInitialSourcePreviewJobNotFoundError(LookupError):
    pass


class KnowledgeFSInitialSourcePreviewJobAlreadyRunningError(RuntimeError):
    pass


def _job_key(*, tenant_id: str, account_id: str, job_id: str) -> str:
    return f"knowledge_fs:initial_source_preview:{tenant_id}:{account_id}:{job_id}"


def _active_job_key(*, tenant_id: str, account_id: str) -> str:
    return f"knowledge_fs:initial_source_preview:{tenant_id}:{account_id}:active"


class KnowledgeFSInitialSourcePreviewJobService:
    def __init__(self, session_maker) -> None:
        self._preview_service = KnowledgeFSInitialSourcePreviewService(session_maker)

    def start(
        self,
        *,
        tenant_id: str,
        account: Account,
        payload: KnowledgeFSInitialWebsiteSourcePreviewPayload,
    ) -> KnowledgeFSInitialSourcePreviewJobCreateResponse:
        self._preview_service.require_visible_credential(tenant_id=tenant_id, account=account, payload=payload)
        job_id = str(uuid.uuid4())
        active_job_key = _active_job_key(tenant_id=tenant_id, account_id=account.id)
        if not redis_client.set(active_job_key, job_id, ex=_JOB_TTL_SECONDS, nx=True):
            raise KnowledgeFSInitialSourcePreviewJobAlreadyRunningError(
                "A datasource preview is already running for this account"
            )
        try:
            self.set_status(
                tenant_id=tenant_id,
                account_id=account.id,
                job_id=job_id,
                status="pending",
            )
            from tasks.knowledge_fs_initial_source_preview_tasks import run_knowledge_fs_initial_source_preview

            run_knowledge_fs_initial_source_preview.apply_async(
                kwargs={
                    "account_id": account.id,
                    "job_id": job_id,
                    "payload": payload.model_dump(mode="json", by_alias=True),
                    "tenant_id": tenant_id,
                },
                task_id=job_id,
            )
        except Exception:
            redis_client.delete(_job_key(tenant_id=tenant_id, account_id=account.id, job_id=job_id))
            self.release_active_job(tenant_id=tenant_id, account_id=account.id, job_id=job_id)
            raise
        return KnowledgeFSInitialSourcePreviewJobCreateResponse(job_id=job_id)

    @staticmethod
    def get(*, tenant_id: str, account_id: str, job_id: str) -> KnowledgeFSInitialSourcePreviewJobResponse:
        raw = redis_client.get(_job_key(tenant_id=tenant_id, account_id=account_id, job_id=job_id))
        if raw is None:
            raise KnowledgeFSInitialSourcePreviewJobNotFoundError(job_id)
        return KnowledgeFSInitialSourcePreviewJobResponse.model_validate_json(raw)

    @classmethod
    def cancel(cls, *, tenant_id: str, account_id: str, job_id: str) -> KnowledgeFSInitialSourcePreviewJobResponse:
        current = cls.get(tenant_id=tenant_id, account_id=account_id, job_id=job_id)
        if current.status in {"completed", "failed"}:
            cls.release_active_job(tenant_id=tenant_id, account_id=account_id, job_id=job_id)
            return current

        if current.status != "canceled":
            transitioned = cls.transition_status(
                tenant_id=tenant_id,
                account_id=account_id,
                job_id=job_id,
                status="canceled",
                allowed_from=("pending", "running"),
            )
            if not transitioned:
                current = cls.get(tenant_id=tenant_id, account_id=account_id, job_id=job_id)
                if current.status != "canceled":
                    return current

        # Reissue termination for an already-canceled job so a client can safely retry
        # after a lost response or broker publication failure.
        celery_app.control.revoke(job_id, terminate=True, signal="SIGTERM")
        response = cls.get(tenant_id=tenant_id, account_id=account_id, job_id=job_id)
        cls.release_active_job(tenant_id=tenant_id, account_id=account_id, job_id=job_id)
        return response

    @staticmethod
    def release_active_job(*, tenant_id: str, account_id: str, job_id: str) -> bool:
        released = redis_client.eval(
            _RELEASE_ACTIVE_JOB_SCRIPT,
            1,
            _active_job_key(tenant_id=tenant_id, account_id=account_id),
            job_id,
        )
        return bool(released)

    @staticmethod
    def set_status(
        *,
        tenant_id: str,
        account_id: str,
        job_id: str,
        status: Literal["pending", "running", "completed", "failed", "canceled"],
        result: KnowledgeFSInitialSourcePreviewResponse | None = None,
    ) -> None:
        response = KnowledgeFSInitialSourcePreviewJobResponse(job_id=job_id, result=result, status=status)
        redis_client.setex(
            _job_key(tenant_id=tenant_id, account_id=account_id, job_id=job_id),
            _JOB_TTL_SECONDS,
            json.dumps(response.model_dump(mode="json", by_alias=True), separators=(",", ":")),
        )

    @staticmethod
    def transition_status(
        *,
        tenant_id: str,
        account_id: str,
        job_id: str,
        status: Literal["pending", "running", "completed", "failed", "canceled"],
        allowed_from: tuple[Literal["pending", "running", "completed", "failed", "canceled"], ...],
        result: KnowledgeFSInitialSourcePreviewResponse | None = None,
    ) -> bool:
        response = KnowledgeFSInitialSourcePreviewJobResponse(job_id=job_id, result=result, status=status)
        serialized = json.dumps(response.model_dump(mode="json", by_alias=True), separators=(",", ":"))
        transitioned = redis_client.eval(
            _TRANSITION_STATUS_SCRIPT,
            1,
            _job_key(tenant_id=tenant_id, account_id=account_id, job_id=job_id),
            serialized,
            _JOB_TTL_SECONDS,
            *allowed_from,
        )
        return bool(transitioned)


__all__ = [
    "KnowledgeFSInitialSourcePreviewJobAlreadyRunningError",
    "KnowledgeFSInitialSourcePreviewJobNotFoundError",
    "KnowledgeFSInitialSourcePreviewJobService",
]
