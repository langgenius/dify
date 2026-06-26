import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest

from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_download_task_cache import (
    WorkflowRunArchiveDownloadTask,
    WorkflowRunArchiveDownloadTaskCache,
    build_archive_download_id,
    build_pending_archive_download_task,
)
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveNotFoundError,
    create_workflow_run_archive_download_task,
    list_workflow_run_archives,
)


class FakeTaskCache:
    created_task: WorkflowRunArchiveDownloadTask | None
    saved_task: WorkflowRunArchiveDownloadTask | None
    existing_task: WorkflowRunArchiveDownloadTask | None
    create_result: bool

    def __init__(
        self,
        *,
        create_result: bool = True,
        existing_task: WorkflowRunArchiveDownloadTask | None = None,
    ) -> None:
        self.created_task = None
        self.saved_task = None
        self.existing_task = existing_task
        self.create_result = create_result

    def create_if_absent(self, task: WorkflowRunArchiveDownloadTask) -> bool:
        self.created_task = task
        return self.create_result

    def get(self, *, tenant_id: str, download_id: str) -> WorkflowRunArchiveDownloadTask | None:
        return self.existing_task

    def save(self, task: WorkflowRunArchiveDownloadTask) -> None:
        self.saved_task = task


def _bundle(*, shard: str, bundle_id: str, archive_bytes: int) -> WorkflowRunArchiveBundle:
    return cast(
        WorkflowRunArchiveBundle,
        SimpleNamespace(shard=shard, bundle_id=bundle_id, archive_bytes=archive_bytes),
    )


def test_list_workflow_run_archives_aggregates_month_rows() -> None:
    latest = datetime.datetime(2026, 6, 25, 8, 0)
    previous = datetime.datetime(2026, 6, 24, 8, 0)
    session = MagicMock()
    session.execute.return_value = [
        SimpleNamespace(
            year=2025,
            month=3,
            bundle_count=2,
            workflow_run_count=100,
            row_count=900,
            archive_bytes=4096,
            latest_archived_at=latest,
        ),
        SimpleNamespace(
            year=2025,
            month=2,
            bundle_count=1,
            workflow_run_count=20,
            row_count=180,
            archive_bytes=1024,
            latest_archived_at=previous,
        ),
    ]

    result = list_workflow_run_archives(session, "tenant-1")

    assert result.summary.archived_month_count == 2
    assert result.summary.workflow_run_count == 120
    assert result.summary.archive_bytes == 5120
    assert result.summary.latest_archived_at == latest
    assert result.months[0].year == 2025
    assert result.months[0].month == 3
    assert result.months[0].bundle_count == 2


def test_create_workflow_run_archive_download_task_creates_stable_pending_task() -> None:
    session = MagicMock()
    session.scalars.return_value = [
        _bundle(shard="01-of-02", bundle_id="bundle-b", archive_bytes=2048),
        _bundle(shard="00-of-02", bundle_id="bundle-a", archive_bytes=1024),
    ]
    cache = FakeTaskCache()

    task = create_workflow_run_archive_download_task(
        session,
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
    )

    assert task.download_id == build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("01-of-02", "bundle-b"), ("00-of-02", "bundle-a")],
    )
    assert task.requested_by == "account-1"
    assert task.bundle_ids == ["bundle-b", "bundle-a"]
    assert task.archive_bytes == 3072
    assert cache.created_task == task


def test_create_workflow_run_archive_download_task_returns_existing_task_when_cache_key_exists() -> None:
    session = MagicMock()
    session.scalars.return_value = [_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024)]
    existing_task = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        archive_bytes=1024,
        download_id="existing-download",
    )
    cache = FakeTaskCache(create_result=False, existing_task=existing_task)

    task = create_workflow_run_archive_download_task(
        session,
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
    )

    assert task == existing_task
    assert cache.saved_task is None


def test_create_workflow_run_archive_download_task_rejects_missing_month() -> None:
    session = MagicMock()
    session.scalars.return_value = []

    with pytest.raises(WorkflowRunArchiveNotFoundError):
        create_workflow_run_archive_download_task(
            session,
            tenant_id="tenant-1",
            requested_by="account-1",
            year=2025,
            month=3,
            cache=cast(WorkflowRunArchiveDownloadTaskCache, FakeTaskCache()),
        )
