import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest

from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_download_task_cache import (
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    WorkflowRunArchiveDownloadTaskCache,
    build_archive_download_id,
    build_pending_archive_download_task,
)
from services.retention.workflow_run.archive_log_service import (
    ArchiveDownloadTaskDispatcher,
    WorkflowRunArchiveDownloadNotReadyError,
    WorkflowRunArchiveNotFoundError,
    create_workflow_run_archive_download_task,
    get_ready_workflow_run_archive_download_task,
    list_workflow_run_archives,
)


class FakeTaskCache:
    created_task: WorkflowRunArchiveDownloadTask | None
    saved_task: WorkflowRunArchiveDownloadTask | None
    existing_task: WorkflowRunArchiveDownloadTask | None
    tasks_by_download_id: dict[str, WorkflowRunArchiveDownloadTask]
    create_result: bool

    def __init__(
        self,
        *,
        create_result: bool = True,
        existing_task: WorkflowRunArchiveDownloadTask | None = None,
        tasks_by_download_id: dict[str, WorkflowRunArchiveDownloadTask] | None = None,
    ) -> None:
        self.created_task = None
        self.saved_task = None
        self.existing_task = existing_task
        self.tasks_by_download_id = tasks_by_download_id or {}
        self.create_result = create_result

    def create_if_absent(self, task: WorkflowRunArchiveDownloadTask) -> bool:
        self.created_task = task
        return self.create_result

    def get(self, *, tenant_id: str, download_id: str) -> WorkflowRunArchiveDownloadTask | None:
        if self.tasks_by_download_id:
            return self.tasks_by_download_id.get(download_id)
        return self.existing_task

    def save(self, task: WorkflowRunArchiveDownloadTask) -> None:
        self.saved_task = task


def _bundle(
    *,
    shard: str,
    bundle_id: str,
    archive_bytes: int,
    year: int = 2025,
    month: int = 3,
    workflow_run_count: int = 1,
    row_count: int = 9,
    archived_at: datetime.datetime | None = None,
) -> WorkflowRunArchiveBundle:
    return cast(
        WorkflowRunArchiveBundle,
        SimpleNamespace(
            year=year,
            month=month,
            shard=shard,
            bundle_id=bundle_id,
            workflow_run_count=workflow_run_count,
            row_count=row_count,
            archive_bytes=archive_bytes,
            archived_at=archived_at or datetime.datetime(2026, 6, 25, 8, 0),
        ),
    )


def _fake_dispatcher(dispatched_tasks: list[WorkflowRunArchiveDownloadTask]) -> ArchiveDownloadTaskDispatcher:
    def dispatch(
        task: WorkflowRunArchiveDownloadTask,
        cache: WorkflowRunArchiveDownloadTaskCache,
    ) -> WorkflowRunArchiveDownloadTask:
        dispatched_tasks.append(task)
        return task.model_copy(update={"celery_task_id": "celery-task-1"})

    return dispatch


def test_list_workflow_run_archives_aggregates_month_rows() -> None:
    latest = datetime.datetime(2026, 6, 25, 8, 0)
    previous = datetime.datetime(2026, 6, 24, 8, 0)
    session = MagicMock()
    march_download_id = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-01", "bundle-a"), ("00-of-01", "bundle-b")],
    )
    ready_task = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a", "bundle-b"],
        bundle_refs=[("00-of-01", "bundle-a"), ("00-of-01", "bundle-b")],
        archive_bytes=4096,
        download_id=march_download_id,
    ).model_copy(
        update={
            "status": WorkflowRunArchiveDownloadStatus.READY,
            "file_name": "workflow-run-logs-2025-03.zip",
            "storage_key": "workflow-run-archive-downloads/tenant-1/2025/03/download.zip",
            "file_size_bytes": 8192,
        }
    )
    cache = FakeTaskCache(tasks_by_download_id={march_download_id: ready_task})
    session.scalars.return_value = [
        _bundle(
            year=2025,
            month=3,
            shard="00-of-01",
            bundle_id="bundle-a",
            workflow_run_count=40,
            row_count=360,
            archive_bytes=1024,
            archived_at=previous,
        ),
        _bundle(
            year=2025,
            month=3,
            shard="00-of-01",
            bundle_id="bundle-b",
            workflow_run_count=60,
            row_count=540,
            archive_bytes=3072,
            archived_at=latest,
        ),
        _bundle(
            year=2025,
            month=2,
            shard="00-of-01",
            bundle_id="bundle-c",
            workflow_run_count=20,
            row_count=180,
            archive_bytes=1024,
            archived_at=previous,
        ),
    ]

    result = list_workflow_run_archives(session, "tenant-1", cache=cast(WorkflowRunArchiveDownloadTaskCache, cache))

    assert result.summary.archived_month_count == 2
    assert result.summary.workflow_run_count == 120
    assert result.summary.archive_bytes == 5120
    assert result.summary.latest_archived_at == latest
    assert result.months[0].year == 2025
    assert result.months[0].month == 3
    assert result.months[0].bundle_count == 2
    assert result.months[0].workflow_run_count == 100
    assert result.months[0].row_count == 900
    assert result.months[0].download_task == ready_task
    assert result.months[1].download_task is None


def test_create_workflow_run_archive_download_task_creates_stable_pending_task() -> None:
    session = MagicMock()
    session.scalars.return_value = [
        _bundle(shard="01-of-02", bundle_id="bundle-b", archive_bytes=2048),
        _bundle(shard="00-of-02", bundle_id="bundle-a", archive_bytes=1024),
    ]
    cache = FakeTaskCache()
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] = []

    task = create_workflow_run_archive_download_task(
        session,
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
        dispatcher=_fake_dispatcher(dispatched_tasks),
    )

    assert task.download_id == build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("01-of-02", "bundle-b"), ("00-of-02", "bundle-a")],
    )
    assert task.requested_by == "account-1"
    assert task.bundle_ids == ["bundle-b", "bundle-a"]
    assert [(ref.shard, ref.bundle_id) for ref in task.bundle_refs] == [
        ("01-of-02", "bundle-b"),
        ("00-of-02", "bundle-a"),
    ]
    assert task.archive_bytes == 3072
    assert cache.created_task == dispatched_tasks[0]
    assert task.celery_task_id == "celery-task-1"


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
    ).model_copy(update={"celery_task_id": "celery-task-1"})
    cache = FakeTaskCache(create_result=False, existing_task=existing_task)
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] = []

    task = create_workflow_run_archive_download_task(
        session,
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
        dispatcher=_fake_dispatcher(dispatched_tasks),
    )

    assert task == existing_task
    assert cache.saved_task is None
    assert dispatched_tasks == []


def test_create_workflow_run_archive_download_task_retries_failed_cached_task() -> None:
    session = MagicMock()
    session.scalars.return_value = [_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024)]
    existing_task = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        bundle_refs=[("00-of-01", "bundle-a")],
        archive_bytes=1024,
        download_id=build_archive_download_id(
            tenant_id="tenant-1",
            year=2025,
            month=3,
            bundle_refs=[("00-of-01", "bundle-a")],
        ),
    ).model_copy(update={"status": WorkflowRunArchiveDownloadStatus.FAILED, "error": "failed"})
    cache = FakeTaskCache(create_result=False, existing_task=existing_task)
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] = []

    task = create_workflow_run_archive_download_task(
        session,
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
        dispatcher=_fake_dispatcher(dispatched_tasks),
    )

    assert task.status == WorkflowRunArchiveDownloadStatus.PENDING
    assert task.error is None
    assert task.celery_task_id == "celery-task-1"
    assert cache.saved_task == dispatched_tasks[0]


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
            dispatcher=_fake_dispatcher([]),
        )


def test_get_ready_workflow_run_archive_download_task_requires_ready_file() -> None:
    pending_task = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        archive_bytes=1024,
        download_id="download-1",
    )
    cache = FakeTaskCache(existing_task=pending_task)

    with pytest.raises(WorkflowRunArchiveDownloadNotReadyError):
        get_ready_workflow_run_archive_download_task(
            tenant_id="tenant-1",
            download_id="download-1",
            cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
        )

    ready_task = pending_task.model_copy(
        update={
            "status": WorkflowRunArchiveDownloadStatus.READY,
            "storage_key": "downloads/download-1.zip",
            "file_name": "workflow-run-logs-2025-03.zip",
        }
    )
    cache = FakeTaskCache(existing_task=ready_task)

    assert (
        get_ready_workflow_run_archive_download_task(
            tenant_id="tenant-1",
            download_id="download-1",
            cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
        )
        == ready_task
    )
