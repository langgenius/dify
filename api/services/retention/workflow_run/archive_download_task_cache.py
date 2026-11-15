"""Redis-backed temporary state for workflow-run archive downloads."""

import datetime
import logging
from typing import Any

from extensions.ext_redis import RedisClientWrapper
from services.retention.workflow_run.archive_download_task import WorkflowRunArchiveDownloadTask

logger = logging.getLogger(__name__)

ARCHIVE_DOWNLOAD_TASK_LOCK_TIMEOUT_SECONDS = 30
_CACHE_KEY_PREFIX = "workflow_run_archive_download"


class WorkflowRunArchiveDownloadTaskCache:
    """Store ephemeral archive download task state in Redis with a TTL."""

    _redis: RedisClientWrapper

    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    def get(self, *, tenant_id: str, download_id: str) -> WorkflowRunArchiveDownloadTask | None:
        raw = self._redis.get(self._cache_key(tenant_id=tenant_id, download_id=download_id))
        if raw is None:
            return None
        data = raw.decode("utf-8") if isinstance(raw, bytes | bytearray) else raw
        try:
            return WorkflowRunArchiveDownloadTask.model_validate_json(data)
        except ValueError:
            logger.warning("Malformed workflow run archive download task cache entry: %s", download_id)
            return None

    def save(self, task: WorkflowRunArchiveDownloadTask) -> None:
        ttl_seconds = self._ttl_seconds(task.expires_at)
        self._redis.setex(
            self._cache_key(tenant_id=task.tenant_id, download_id=task.download_id),
            ttl_seconds,
            task.model_dump_json(),
        )

    def lock(self, *, tenant_id: str, download_id: str) -> Any:
        return self._redis.lock(
            f"{self._cache_key(tenant_id=tenant_id, download_id=download_id)}:lock",
            timeout=ARCHIVE_DOWNLOAD_TASK_LOCK_TIMEOUT_SECONDS,
            blocking_timeout=ARCHIVE_DOWNLOAD_TASK_LOCK_TIMEOUT_SECONDS,
        )

    def delete(self, *, tenant_id: str, download_id: str) -> None:
        self._redis.delete(self._cache_key(tenant_id=tenant_id, download_id=download_id))

    @staticmethod
    def _cache_key(*, tenant_id: str, download_id: str) -> str:
        return f"{_CACHE_KEY_PREFIX}:{tenant_id}:{download_id}"

    @staticmethod
    def _ttl_seconds(expires_at: datetime.datetime) -> int:
        expires_at_utc = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=datetime.UTC)
        remaining = expires_at_utc - datetime.datetime.now(datetime.UTC)
        return max(int(remaining.total_seconds()), 1)
