"""Redis-backed temporary state for workflow-run archive downloads."""

import datetime
import hashlib
import json
import logging
from collections.abc import Sequence
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from extensions.ext_redis import RedisClientWrapper, redis_client

logger = logging.getLogger(__name__)

ARCHIVE_DOWNLOAD_FORMAT_VERSION = "v1"
DEFAULT_ARCHIVE_DOWNLOAD_TASK_TTL_SECONDS = 24 * 60 * 60
_CACHE_KEY_PREFIX = "workflow_run_archive_download"


class WorkflowRunArchiveDownloadStatus(StrEnum):
    """Lifecycle state for an asynchronous archive download request."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class WorkflowRunArchiveDownloadTask(BaseModel):
    """Temporary Redis payload for a monthly archive download request."""

    model_config = ConfigDict(extra="forbid")

    download_id: str
    tenant_id: str
    requested_by: str
    year: int = Field(ge=1)
    month: int = Field(ge=1, le=12)
    bundle_ids: list[str]
    bundle_count: int = Field(ge=0)
    archive_bytes: int = Field(ge=0)
    status: WorkflowRunArchiveDownloadStatus
    file_name: str | None = None
    storage_key: str | None = None
    file_size_bytes: int | None = Field(default=None, ge=0)
    celery_task_id: str | None = None
    error: str | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    expires_at: datetime.datetime
    started_at: datetime.datetime | None = None
    finished_at: datetime.datetime | None = None


class WorkflowRunArchiveDownloadTaskCache:
    """Store ephemeral archive download task state in Redis with a TTL."""

    _redis: RedisClientWrapper

    def __init__(self, redis: RedisClientWrapper = redis_client) -> None:
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

    def create_if_absent(self, task: WorkflowRunArchiveDownloadTask) -> bool:
        ttl_seconds = self._ttl_seconds(task.expires_at)
        result = self._redis.set(
            self._cache_key(tenant_id=task.tenant_id, download_id=task.download_id),
            task.model_dump_json(),
            ex=ttl_seconds,
            nx=True,
        )
        return bool(result)

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


def build_pending_archive_download_task(
    *,
    tenant_id: str,
    requested_by: str,
    year: int,
    month: int,
    bundle_ids: Sequence[str],
    archive_bytes: int,
    download_id: str,
    ttl_seconds: int = DEFAULT_ARCHIVE_DOWNLOAD_TASK_TTL_SECONDS,
    now: datetime.datetime | None = None,
) -> WorkflowRunArchiveDownloadTask:
    """Create the Redis payload stored when the console starts an archive download."""
    created_at = now or datetime.datetime.now(datetime.UTC)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=datetime.UTC)
    normalized_bundle_ids = list(bundle_ids)
    return WorkflowRunArchiveDownloadTask(
        download_id=download_id,
        tenant_id=tenant_id,
        requested_by=requested_by,
        year=year,
        month=month,
        bundle_ids=normalized_bundle_ids,
        bundle_count=len(normalized_bundle_ids),
        archive_bytes=archive_bytes,
        status=WorkflowRunArchiveDownloadStatus.PENDING,
        created_at=created_at,
        updated_at=created_at,
        expires_at=created_at + datetime.timedelta(seconds=ttl_seconds),
    )


def build_archive_download_id(
    *,
    tenant_id: str,
    year: int,
    month: int,
    bundle_refs: Sequence[tuple[str, str]],
    download_format_version: str = ARCHIVE_DOWNLOAD_FORMAT_VERSION,
) -> str:
    """Build a stable id for the exact archive download content."""
    if not bundle_refs:
        raise ValueError("bundle_refs must not be empty")
    normalized_refs = sorted(f"{shard}:{bundle_id}" for shard, bundle_id in bundle_refs)
    payload = json.dumps(
        {
            "tenant_id": tenant_id,
            "year": year,
            "month": month,
            "bundle_refs": normalized_refs,
            "download_format_version": download_format_version,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
