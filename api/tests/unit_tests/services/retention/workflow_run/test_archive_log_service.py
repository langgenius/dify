import datetime
from contextlib import nullcontext

import pytest

from machinery.context import RequestContext
from services.retention.workflow_run.archive_download_task import (
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    build_archive_download_id,
    build_pending_archive_download_task,
)
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveBundleRecord,
    WorkflowRunArchiveDownloadNotReadyError,
    WorkflowRunArchiveDownloadTaskDispatcher,
    WorkflowRunArchiveDownloadTaskNotFoundError,
    WorkflowRunArchiveNotFoundError,
    WorkflowRunArchiveService,
)

_CONTEXT = RequestContext(
    request_id="request-1",
    trace_id="trace-1",
    account_id="account-1",
    active_workspace_id="tenant-1",
)


class FakeBundleQuery:
    def __init__(self, records: tuple[WorkflowRunArchiveBundleRecord, ...] = ()) -> None:
        self.records = records

    def list_for_tenant(self, tenant_id: str) -> tuple[WorkflowRunArchiveBundleRecord, ...]:
        assert tenant_id == "tenant-1"
        return self.records

    def list_for_tenant_month(
        self,
        tenant_id: str,
        *,
        year: int,
        month: int,
    ) -> tuple[WorkflowRunArchiveBundleRecord, ...]:
        assert tenant_id == "tenant-1"
        return tuple(record for record in self.records if record.year == year and record.month == month)


class FakeTaskStore:
    def __init__(
        self,
        tasks: dict[str, WorkflowRunArchiveDownloadTask] | None = None,
        *,
        fail_reads: bool = False,
    ) -> None:
        self.tasks = tasks or {}
        self.saved_tasks: list[WorkflowRunArchiveDownloadTask] = []
        self.fail_reads = fail_reads
        self.lock_calls: list[tuple[str, str]] = []

    def lock(self, *, tenant_id: str, download_id: str):
        self.lock_calls.append((tenant_id, download_id))
        return nullcontext()

    def get(self, *, tenant_id: str, download_id: str) -> WorkflowRunArchiveDownloadTask | None:
        if self.fail_reads:
            raise RuntimeError("cache unavailable")
        return self.tasks.get(download_id)

    def save(self, task: WorkflowRunArchiveDownloadTask) -> None:
        self.saved_tasks.append(task)
        self.tasks[task.download_id] = task


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
) -> WorkflowRunArchiveBundleRecord:
    return WorkflowRunArchiveBundleRecord(
        year=year,
        month=month,
        shard=shard,
        bundle_id=bundle_id,
        workflow_run_count=workflow_run_count,
        row_count=row_count,
        archive_bytes=archive_bytes,
        archived_at=archived_at or datetime.datetime(2026, 6, 25, 8, 0),
    )


def _service(
    *,
    records: tuple[WorkflowRunArchiveBundleRecord, ...] = (),
    tasks: FakeTaskStore | None = None,
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] | None = None,
    signed_urls: list[tuple[str, int, str]] | None = None,
    dispatcher: WorkflowRunArchiveDownloadTaskDispatcher | None = None,
) -> WorkflowRunArchiveService:
    task_store = tasks or FakeTaskStore()

    def dispatch(task: WorkflowRunArchiveDownloadTask) -> None:
        if dispatched_tasks is not None:
            dispatched_tasks.append(task)

    def sign(storage_key: str, *, expires_in: int, filename: str) -> str:
        if signed_urls is not None:
            signed_urls.append((storage_key, expires_in, filename))
        return "https://storage.example.com/archive.zip"

    return WorkflowRunArchiveService(
        bundles=FakeBundleQuery(records),
        tasks=task_store,
        dispatcher=dispatcher or dispatch,
        sign_download_url=sign,
    )


def test_list_archives_aggregates_month_rows_and_includes_cached_task() -> None:
    latest = datetime.datetime(2026, 6, 25, 8, 0)
    previous = datetime.datetime(2026, 6, 24, 8, 0)
    records = (
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
    )
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
    ).model_copy(update={"status": WorkflowRunArchiveDownloadStatus.READY})

    result = _service(records=records, tasks=FakeTaskStore({march_download_id: ready_task})).list_archives(_CONTEXT)

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


def test_list_archives_tolerates_unavailable_task_cache() -> None:
    result = _service(
        records=(_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024),),
        tasks=FakeTaskStore(fail_reads=True),
    ).list_archives(_CONTEXT)

    assert result.months[0].download_task is None


def test_create_download_creates_stable_pending_task() -> None:
    records = (
        _bundle(shard="00-of-02", bundle_id="bundle-a", archive_bytes=1024),
        _bundle(shard="01-of-02", bundle_id="bundle-b", archive_bytes=2048),
    )
    task_store = FakeTaskStore()
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] = []

    task = _service(records=records, tasks=task_store, dispatched_tasks=dispatched_tasks).create_download(
        _CONTEXT,
        year=2025,
        month=3,
    )

    assert task.download_id == build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-02", "bundle-a"), ("01-of-02", "bundle-b")],
    )
    assert task.requested_by == "account-1"
    assert task.bundle_ids == ["bundle-a", "bundle-b"]
    assert [(ref.shard, ref.bundle_id) for ref in task.bundle_refs] == [
        ("00-of-02", "bundle-a"),
        ("01-of-02", "bundle-b"),
    ]
    assert task.archive_bytes == 3072
    assert task_store.saved_tasks == dispatched_tasks
    assert task.celery_task_id is not None


def test_create_download_returns_existing_queued_task() -> None:
    records = (_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024),)
    download_id = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-01", "bundle-a")],
    )
    existing = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        archive_bytes=1024,
        download_id=download_id,
    ).model_copy(update={"celery_task_id": "celery-task-1"})
    task_store = FakeTaskStore({download_id: existing})
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] = []

    result = _service(records=records, tasks=task_store, dispatched_tasks=dispatched_tasks).create_download(
        _CONTEXT,
        year=2025,
        month=3,
    )

    assert result == existing
    assert task_store.saved_tasks == []
    assert dispatched_tasks == []


def test_create_download_retries_failed_task() -> None:
    records = (_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024),)
    download_id = build_archive_download_id(
        tenant_id="tenant-1",
        year=2025,
        month=3,
        bundle_refs=[("00-of-01", "bundle-a")],
    )
    failed = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        bundle_refs=[("00-of-01", "bundle-a")],
        archive_bytes=1024,
        download_id=download_id,
    ).model_copy(update={"status": WorkflowRunArchiveDownloadStatus.FAILED, "error": "failed"})
    task_store = FakeTaskStore({download_id: failed})
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] = []

    task = _service(records=records, tasks=task_store, dispatched_tasks=dispatched_tasks).create_download(
        _CONTEXT,
        year=2025,
        month=3,
    )

    assert task.status == WorkflowRunArchiveDownloadStatus.PENDING
    assert task.error is None
    assert task.celery_task_id is not None
    assert task_store.saved_tasks == dispatched_tasks


def test_create_download_marks_matching_claim_failed_when_dispatch_fails() -> None:
    records = (_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024),)
    task_store = FakeTaskStore()

    def dispatch(_task: WorkflowRunArchiveDownloadTask) -> None:
        raise RuntimeError("broker unavailable")

    result = _service(records=records, tasks=task_store, dispatcher=dispatch).create_download(
        _CONTEXT,
        year=2025,
        month=3,
    )

    assert result.status == WorkflowRunArchiveDownloadStatus.FAILED
    assert result.error == "Failed to enqueue archive download task."
    assert result.finished_at is not None
    assert len(task_store.saved_tasks) == 2
    assert task_store.saved_tasks[0].status == WorkflowRunArchiveDownloadStatus.PENDING
    assert task_store.saved_tasks[1] == result
    assert task_store.lock_calls == [
        ("tenant-1", result.download_id),
        ("tenant-1", result.download_id),
    ]


def test_create_download_does_not_overwrite_newer_state_when_dispatch_fails() -> None:
    records = (_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024),)
    task_store = FakeTaskStore()

    def dispatch(task: WorkflowRunArchiveDownloadTask) -> None:
        task_store.tasks[task.download_id] = task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.READY,
                "storage_key": "downloads/archive.zip",
                "file_name": "archive.zip",
            }
        )
        raise RuntimeError("broker response lost")

    result = _service(records=records, tasks=task_store, dispatcher=dispatch).create_download(
        _CONTEXT,
        year=2025,
        month=3,
    )

    assert result.status == WorkflowRunArchiveDownloadStatus.READY
    assert len(task_store.saved_tasks) == 1
    assert task_store.lock_calls == [
        ("tenant-1", result.download_id),
        ("tenant-1", result.download_id),
    ]


def test_create_download_claims_dispatch_once() -> None:
    records = (_bundle(shard="00-of-01", bundle_id="bundle-a", archive_bytes=1024),)
    task_store = FakeTaskStore()
    dispatched_tasks: list[WorkflowRunArchiveDownloadTask] = []
    concurrent_results: list[WorkflowRunArchiveDownloadTask] = []

    def dispatch(task: WorkflowRunArchiveDownloadTask) -> None:
        dispatched_tasks.append(task)
        concurrent_results.append(service.create_download(_CONTEXT, year=2025, month=3))

    def sign_download_url(_storage_key: str, *, expires_in: int, filename: str) -> str:
        assert expires_in > 0
        assert filename
        return "unused"

    service = WorkflowRunArchiveService(
        bundles=FakeBundleQuery(records),
        tasks=task_store,
        dispatcher=dispatch,
        sign_download_url=sign_download_url,
    )

    result = service.create_download(_CONTEXT, year=2025, month=3)

    assert dispatched_tasks == [result]
    assert concurrent_results == [result]


def test_create_download_rejects_missing_month() -> None:
    with pytest.raises(WorkflowRunArchiveNotFoundError):
        _service().create_download(_CONTEXT, year=2025, month=3)


def test_get_download_rejects_missing_task() -> None:
    with pytest.raises(WorkflowRunArchiveDownloadTaskNotFoundError):
        _service().get_download(_CONTEXT, download_id="missing")


def test_get_download_url_requires_ready_file() -> None:
    pending = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        archive_bytes=1024,
        download_id="download-1",
    )

    with pytest.raises(WorkflowRunArchiveDownloadNotReadyError):
        _service(tasks=FakeTaskStore({pending.download_id: pending})).get_download_url(
            _CONTEXT,
            download_id=pending.download_id,
        )


def test_get_download_url_signs_ready_file_for_at_most_one_hour() -> None:
    ready = build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-a"],
        archive_bytes=1024,
        download_id="download-1",
        ttl_seconds=7200,
    ).model_copy(
        update={
            "status": WorkflowRunArchiveDownloadStatus.READY,
            "storage_key": "downloads/download-1.zip",
            "file_name": "workflow-run-logs-2025-03.zip",
        }
    )
    signed_urls: list[tuple[str, int, str]] = []

    url = _service(
        tasks=FakeTaskStore({ready.download_id: ready}),
        signed_urls=signed_urls,
    ).get_download_url(_CONTEXT, download_id=ready.download_id)

    assert url == "https://storage.example.com/archive.zip"
    assert signed_urls == [("downloads/download-1.zip", 3600, "workflow-run-logs-2025-03.zip")]
