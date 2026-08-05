import datetime
from contextlib import nullcontext

import pytest

from services.retention.workflow_run.archive_download_task_cache import (
    ARCHIVE_DOWNLOAD_FORMAT_VERSION,
    ARCHIVE_DOWNLOAD_TASK_LOCK_TIMEOUT_SECONDS,
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    WorkflowRunArchiveDownloadTaskCache,
    build_archive_download_id,
    build_pending_archive_download_task,
)


class FakeRedis:
    store: dict[str, tuple[int | datetime.timedelta, str]]

    def __init__(self) -> None:
        self.store = {}
        self.lock_calls: list[tuple[str, float | None, float | None]] = []

    def get(self, name: str | bytes) -> bytes | str | None:
        key = name.decode("utf-8") if isinstance(name, bytes) else name
        item = self.store.get(key)
        return item[1] if item else None

    def setex(self, name: str | bytes, time: int | datetime.timedelta, value: str) -> object:
        key = name.decode("utf-8") if isinstance(name, bytes) else name
        self.store[key] = (time, value)
        return True

    def delete(self, *names: str | bytes) -> object:
        deleted = 0
        for name in names:
            key = name.decode("utf-8") if isinstance(name, bytes) else name
            if self.store.pop(key, None) is not None:
                deleted += 1
        return deleted

    def lock(
        self,
        name: str,
        timeout: float | None = None,
        blocking_timeout: float | None = None,
    ):
        self.lock_calls.append((name, timeout, blocking_timeout))
        return nullcontext()


def test_build_pending_archive_download_task_sets_ephemeral_payload() -> None:
    now = datetime.datetime(2026, 6, 25, 8, 0, tzinfo=datetime.UTC)

    task = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a", "bundle-b"],
        archive_bytes=1024,
        ttl_seconds=3600,
        download_id="download-1",
        now=now,
    )

    assert task.status == WorkflowRunArchiveDownloadStatus.PENDING
    assert task.bundle_count == 2
    assert task.expires_at == now + datetime.timedelta(seconds=3600)


def test_build_archive_download_id_is_stable_for_same_bundle_set() -> None:
    first = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("01-of-02", "bundle-b"), ("00-of-02", "bundle-a")],
    )
    second = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-02", "bundle-a"), ("01-of-02", "bundle-b")],
    )

    assert first == second
    assert len(first) == 32


def test_build_archive_download_id_changes_when_content_or_format_changes() -> None:
    base = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-01", "bundle-a")],
    )
    changed_bundle = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-01", "bundle-b")],
    )
    changed_format = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-01", "bundle-a")],
        download_format_version=f"{ARCHIVE_DOWNLOAD_FORMAT_VERSION}-next",
    )

    assert base != changed_bundle
    assert base != changed_format


def test_build_archive_download_id_rejects_empty_bundle_refs() -> None:
    with pytest.raises(ValueError, match="bundle_refs must not be empty"):
        build_archive_download_id(tenant_id="tenant-1", year=2025, month=3, bundle_refs=[])


def test_archive_download_task_cache_round_trips_with_ttl() -> None:
    redis = FakeRedis()
    cache = WorkflowRunArchiveDownloadTaskCache(redis)
    task = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        archive_bytes=1024,
        ttl_seconds=3600,
        download_id="download-1",
    )

    cache.save(task)
    restored = cache.get(tenant_id="tenant-1", download_id="download-1")

    assert restored == task
    ttl, _ = redis.store["workflow_run_archive_download:tenant-1:download-1"]
    assert isinstance(ttl, int)
    assert 0 < ttl <= 3600


def test_archive_download_task_cache_uses_per_download_lock() -> None:
    redis = FakeRedis()
    cache = WorkflowRunArchiveDownloadTaskCache(redis)

    with cache.lock(tenant_id="tenant-1", download_id="download-1"):
        pass

    assert redis.lock_calls == [
        (
            "workflow_run_archive_download:tenant-1:download-1:lock",
            ARCHIVE_DOWNLOAD_TASK_LOCK_TIMEOUT_SECONDS,
            ARCHIVE_DOWNLOAD_TASK_LOCK_TIMEOUT_SECONDS,
        )
    ]


def test_archive_download_task_cache_delete_removes_entry() -> None:
    redis = FakeRedis()
    cache = WorkflowRunArchiveDownloadTaskCache(redis)
    task = WorkflowRunArchiveDownloadTask(
        download_id="download-1",
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=[],
        bundle_count=0,
        archive_bytes=0,
        status=WorkflowRunArchiveDownloadStatus.FAILED,
        error="failed",
        created_at=datetime.datetime.now(datetime.UTC),
        updated_at=datetime.datetime.now(datetime.UTC),
        expires_at=datetime.datetime.now(datetime.UTC) + datetime.timedelta(seconds=3600),
    )
    cache.save(task)

    cache.delete(tenant_id="tenant-1", download_id="download-1")

    assert cache.get(tenant_id="tenant-1", download_id="download-1") is None


def test_archive_download_task_cache_ignores_malformed_json() -> None:
    redis = FakeRedis()
    cache = WorkflowRunArchiveDownloadTaskCache(redis)
    redis.setex("workflow_run_archive_download:tenant-1:download-1", 3600, "{")

    assert cache.get(tenant_id="tenant-1", download_id="download-1") is None
