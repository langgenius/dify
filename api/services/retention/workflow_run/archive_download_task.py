"""Domain objects and builders for workflow-run archive downloads."""

import datetime
import hashlib
import json
from collections.abc import Sequence
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

ARCHIVE_DOWNLOAD_FORMAT_VERSION = "v1"
DEFAULT_ARCHIVE_DOWNLOAD_TASK_TTL_SECONDS = 24 * 60 * 60


class WorkflowRunArchiveDownloadStatus(StrEnum):
    """Lifecycle state for an asynchronous archive download request."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class WorkflowRunArchiveBundleRef(BaseModel):
    """Immutable object-store identity for one bundle included in a download task."""

    model_config = ConfigDict(extra="forbid")

    shard: str
    bundle_id: str


class WorkflowRunArchiveDownloadTask(BaseModel):
    """Temporary state for a monthly archive download request."""

    model_config = ConfigDict(extra="forbid")

    download_id: str
    tenant_id: str
    requested_by: str
    year: int = Field(ge=1)
    month: int = Field(ge=1, le=12)
    bundle_ids: list[str]
    bundle_refs: list[WorkflowRunArchiveBundleRef] = Field(default_factory=list)
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


def build_pending_archive_download_task(
    *,
    tenant_id: str,
    requested_by: str,
    year: int,
    month: int,
    bundle_ids: Sequence[str],
    bundle_refs: Sequence[tuple[str, str]] = (),
    archive_bytes: int,
    download_id: str,
    ttl_seconds: int = DEFAULT_ARCHIVE_DOWNLOAD_TASK_TTL_SECONDS,
    now: datetime.datetime | None = None,
) -> WorkflowRunArchiveDownloadTask:
    """Create the temporary state stored when the console starts an archive download."""
    created_at = now or datetime.datetime.now(datetime.UTC)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=datetime.UTC)
    normalized_bundle_ids = list(bundle_ids)
    normalized_bundle_refs = [
        WorkflowRunArchiveBundleRef(shard=shard, bundle_id=bundle_id) for shard, bundle_id in bundle_refs
    ]
    return WorkflowRunArchiveDownloadTask(
        download_id=download_id,
        tenant_id=tenant_id,
        requested_by=requested_by,
        year=year,
        month=month,
        bundle_ids=normalized_bundle_ids,
        bundle_refs=normalized_bundle_refs,
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
