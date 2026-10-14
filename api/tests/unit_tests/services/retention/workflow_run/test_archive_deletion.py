"""Archive deletion uses real tenant-scoped catalog rows and leaves live workflow data intact."""

import datetime
import json
import logging
import threading
from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from typing import override
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from graphon.enums import WorkflowExecutionStatus
from libs.archive_storage import ArchiveStorage, ArchiveStorageError
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun, WorkflowRunArchiveBundle, WorkflowType
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from services.retention.workflow_run.archive_deletion import WorkflowRunArchiveDeleter
from services.retention.workflow_run.archive_deletion_task import WorkflowRunArchiveDeletionStatus
from services.retention.workflow_run.archive_download_preparation import (
    WorkflowRunArchiveDownloadPreparer,
    build_archive_download_month_prefix,
)
from services.retention.workflow_run.archive_download_task import (
    WorkflowRunArchiveDownloadStatus,
    build_archive_download_id,
    build_pending_archive_download_task,
)
from services.retention.workflow_run.archive_download_task_cache import WorkflowRunArchiveDownloadTaskCache
from services.retention.workflow_run.archive_month_lock import WorkflowRunArchiveMonthLease

TENANT_ID = "1251fe32-c0c7-4fe2-a7bd-a8105267faf5"
OTHER_TENANT_ID = "2251fe32-c0c7-4fe2-a7bd-a8105267faf5"


class MemoryStorage(ArchiveStorage):
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.fail_key: str | None = None

    @override
    def get_object(self, key: str) -> bytes:
        try:
            return self.objects[key]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    @override
    def list_objects(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))

    @override
    def delete_object(self, key: str) -> None:
        if key == self.fail_key:
            raise ArchiveStorageError("storage unavailable")
        self.deleted.append(key)
        self.objects.pop(key, None)

    @override
    def put_object(self, key: str, data: bytes) -> str:
        self.objects[key] = data
        return "checksum"


def _bundle(*, tenant_id: str = TENANT_ID, month: int = 3, bundle_id: str = "bundle-a") -> WorkflowRunArchiveBundle:
    return WorkflowRunArchiveBundle(
        tenant_id=tenant_id,
        year=2025,
        month=month,
        shard="00-of-01",
        bundle_id=bundle_id,
        workflow_run_count=1,
        row_count=7,
        archive_bytes=512,
        archived_at=datetime.datetime(2026, 6, 25),
    )


def _put_bundle(storage: MemoryStorage, bundle: WorkflowRunArchiveBundle) -> str:
    prefix = (
        f"workflow-runs/v2/tenant_prefix={bundle.tenant_id[0]}/tenant_id={bundle.tenant_id}/"
        f"year={bundle.year:04d}/month={bundle.month:02d}/shard={bundle.shard}/bundle={bundle.bundle_id}/"
    )
    storage.objects[f"{prefix}manifest.json"] = json.dumps(
        {
            "tenant_id": bundle.tenant_id,
            "year": bundle.year,
            "month": bundle.month,
            "shard": bundle.shard,
            "bundle_id": bundle.bundle_id,
            "object_prefix": prefix.rstrip("/"),
        }
    ).encode()
    storage.objects[f"{prefix}workflow_runs.parquet"] = b"runs"
    storage.objects[f"{prefix}workflow_node_executions.parquet"] = b"nodes"
    storage.objects[f"{prefix}.deleted"] = b"marker"
    return prefix


def _deleter(
    repository: WorkflowRunArchiveBundleQueryRepository,
    archive: MemoryStorage,
    downloads: MemoryStorage,
    lease: WorkflowRunArchiveMonthLease,
) -> WorkflowRunArchiveDeleter:
    return WorkflowRunArchiveDeleter(
        bundles=repository,
        archive_storage_provider=lambda: archive,
        download_storage_provider=lambda: downloads,
        month_lock=lambda **_kwargs: nullcontext(lease),
    )


def test_archive_deletion_removes_only_requested_files_indexes_and_downloads(
    sqlite_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
    month_lease: WorkflowRunArchiveMonthLease,
) -> None:
    caplog.set_level(logging.INFO, logger="services.retention.workflow_run.archive_deletion")
    archive, downloads = MemoryStorage(), MemoryStorage()
    target, other_tenant, other_month = _bundle(), _bundle(tenant_id=OTHER_TENANT_ID), _bundle(month=2)
    target_prefix = _put_bundle(archive, target)
    _put_bundle(archive, other_tenant)
    _put_bundle(archive, other_month)
    index_key = target_prefix.rsplit("bundle=", 1)[0] + "index.json"
    archive.objects[index_key] = b'{"run_ids":["run-1"]}'
    target_download = build_archive_download_month_prefix(tenant_id=TENANT_ID, year=2025, month=3) + "download.zip"
    other_download = build_archive_download_month_prefix(tenant_id=OTHER_TENANT_ID, year=2025, month=3) + "download.zip"
    downloads.objects.update({target_download: b"target", other_download: b"other"})
    run = WorkflowRun(
        id="run-1",
        tenant_id=TENANT_ID,
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED,
        outputs="{}",
        error=None,
        elapsed_time=0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime.datetime(2025, 3, 15),
        finished_at=datetime.datetime(2025, 3, 15),
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([target, other_tenant, other_month, run])
    repository = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory)
    writes: list[str] = []

    def record_writes(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if statement.lower().startswith(("delete ", "update ", "insert ")):
            writes.append(statement.lower())

    engine = sqlite_session_factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", record_writes)
    try:
        repository.request_deletion(TENANT_ID, year=2025, month=3)
        result = _deleter(repository, archive, downloads, month_lease).delete(tenant_id=TENANT_ID, year=2025, month=3)
    finally:
        event.remove(engine, "before_cursor_execute", record_writes)

    assert result.status == WorkflowRunArchiveDeletionStatus.COMPLETED
    assert not archive.list_objects(target_prefix)
    assert archive.deleted[-1] == target_prefix + "manifest.json"
    assert archive.objects[index_key] == b'{"run_ids":["run-1"]}'
    assert downloads.objects == {other_download: b"other"}
    assert writes
    assert all("workflow_run_archive_bundles" in statement for statement in writes)
    with sqlite_session_factory() as session:
        assert session.get(WorkflowRun, "run-1") is not None
        assert {bundle.id for bundle in session.scalars(select(WorkflowRunArchiveBundle))} == {
            other_tenant.id,
            other_month.id,
        }
    completed = [
        record.__dict__.get("attributes", {})
        for record in caplog.records
        if record.__dict__.get("attributes", {}).get("event") == "workflow_run_archive.deletion_completed"
    ]
    assert completed == [
        {
            "audit": True,
            "event": "workflow_run_archive.deletion_completed",
            "tenant_id": TENANT_ID,
            "year": 2025,
            "month": 3,
            "bundle_count": 1,
        }
    ]


@pytest.mark.parametrize("failure_stage", ["archive", "download"])
def test_failed_storage_delete_keeps_indexes_and_can_retry_partial_deletion(
    sqlite_session_factory: sessionmaker[Session],
    failure_stage: str,
    caplog: pytest.LogCaptureFixture,
    month_lease: WorkflowRunArchiveMonthLease,
) -> None:
    caplog.set_level(logging.INFO, logger="services.retention.workflow_run.archive_deletion")
    archive, downloads = MemoryStorage(), MemoryStorage()
    target = _bundle()
    prefix = _put_bundle(archive, target)
    download_key = build_archive_download_month_prefix(tenant_id=TENANT_ID, year=2025, month=3) + "download.zip"
    downloads.objects[download_key] = b"download"
    if failure_stage == "archive":
        archive.fail_key = prefix + "workflow_runs.parquet"
    else:
        downloads.fail_key = download_key
    with sqlite_session_factory.begin() as session:
        session.add(target)
    repository = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory)
    repository.request_deletion(TENANT_ID, year=2025, month=3)
    deleter = _deleter(repository, archive, downloads, month_lease)

    assert deleter.delete(tenant_id=TENANT_ID, year=2025, month=3).status == WorkflowRunArchiveDeletionStatus.FAILED
    records = repository.list_for_tenant_month(TENANT_ID, year=2025, month=3)
    assert len(records) == 1
    assert records[0].deletion_status == WorkflowRunArchiveDeletionStatus.FAILED
    if failure_stage == "archive":
        assert prefix + "manifest.json" in archive.objects
    assert download_key in downloads.objects
    assert not any(
        record.__dict__.get("attributes", {}).get("event") == "workflow_run_archive.deletion_completed"
        for record in caplog.records
    )
    failed = next(
        record.__dict__.get("attributes", {})
        for record in caplog.records
        if record.__dict__.get("attributes", {}).get("event") == "workflow_run_archive.deletion_failed"
    )
    assert (failed["tenant_id"], failed["year"], failed["month"]) == (TENANT_ID, 2025, 3)

    archive.fail_key = downloads.fail_key = None
    repository.request_deletion(TENANT_ID, year=2025, month=3)
    assert deleter.delete(tenant_id=TENANT_ID, year=2025, month=3).status == WorkflowRunArchiveDeletionStatus.COMPLETED
    assert not repository.list_for_tenant_month(TENANT_ID, year=2025, month=3)
    assert not archive.list_objects(prefix)
    assert not downloads.objects
    assert deleter.delete(tenant_id=TENANT_ID, year=2025, month=3).status == WorkflowRunArchiveDeletionStatus.COMPLETED
    assert (
        sum(
            record.__dict__.get("attributes", {}).get("event") == "workflow_run_archive.deletion_completed"
            for record in caplog.records
        )
        == 1
    )


def test_deletion_requires_durable_request_and_never_deletes_new_active_bundles(
    sqlite_session_factory: sessionmaker[Session],
    month_lease: WorkflowRunArchiveMonthLease,
) -> None:
    archive, downloads = MemoryStorage(), MemoryStorage()
    target, new_bundle = _bundle(), _bundle(bundle_id="new-bundle")
    prefix = _put_bundle(archive, target)
    new_prefix = _put_bundle(archive, new_bundle)
    with sqlite_session_factory.begin() as session:
        session.add(target)
    repository = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory)
    deleter = _deleter(repository, archive, downloads, month_lease)
    deleter.delete(tenant_id=TENANT_ID, year=2025, month=3)
    assert not archive.deleted
    repository.request_deletion(TENANT_ID, year=2025, month=3)
    with sqlite_session_factory.begin() as session:
        session.add(new_bundle)

    deleter.delete(tenant_id=TENANT_ID, year=2025, month=3)

    assert not archive.list_objects(prefix)
    assert archive.list_objects(new_prefix)
    assert [record.bundle_id for record in repository.list_for_tenant_month(TENANT_ID, year=2025, month=3)] == [
        "new-bundle"
    ]


def test_manifest_mismatch_fails_without_deleting_objects(
    sqlite_session_factory: sessionmaker[Session], month_lease: WorkflowRunArchiveMonthLease
) -> None:
    archive, downloads = MemoryStorage(), MemoryStorage()
    target = _bundle()
    prefix = _put_bundle(archive, target)
    manifest = json.loads(archive.objects[prefix + "manifest.json"])
    manifest["tenant_id"] = OTHER_TENANT_ID
    archive.objects[prefix + "manifest.json"] = json.dumps(manifest).encode()
    with sqlite_session_factory.begin() as session:
        session.add(target)
    repository = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory)
    repository.request_deletion(TENANT_ID, year=2025, month=3)

    result = _deleter(repository, archive, downloads, month_lease).delete(tenant_id=TENANT_ID, year=2025, month=3)

    assert result.status == WorkflowRunArchiveDeletionStatus.FAILED
    assert not archive.deleted
    assert repository.list_for_tenant_month(TENANT_ID, year=2025, month=3)


def test_lost_month_lease_keeps_durable_index_for_retry(
    sqlite_session_factory: sessionmaker[Session], month_lease: WorkflowRunArchiveMonthLease
) -> None:
    archive, downloads = MemoryStorage(), MemoryStorage()
    target = _bundle()
    prefix = _put_bundle(archive, target)
    with sqlite_session_factory.begin() as session:
        session.add(target)
    repository = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory)
    repository.request_deletion(TENANT_ID, year=2025, month=3)
    deleter = WorkflowRunArchiveDeleter(
        bundles=repository,
        archive_storage_provider=lambda: archive,
        download_storage_provider=lambda: downloads,
        month_lock=lambda **_kwargs: nullcontext(month_lease),
    )

    with patch.object(month_lease, "assert_owned", side_effect=[None, None, RuntimeError("lease lost")]):
        result = deleter.delete(tenant_id=TENANT_ID, year=2025, month=3)

    assert result.status == WorkflowRunArchiveDeletionStatus.FAILED
    assert not archive.list_objects(prefix)
    records = repository.list_for_tenant_month(TENANT_ID, year=2025, month=3)
    assert len(records) == 1
    assert records[0].deletion_status == WorkflowRunArchiveDeletionStatus.FAILED


def test_month_lease_lets_deletion_clean_zip_after_failed_upload_compensation(
    sqlite_session_factory: sessionmaker[Session],
    month_lease: WorkflowRunArchiveMonthLease,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive, downloads = MemoryStorage(), MemoryStorage()
    target = _bundle()
    _put_bundle(archive, target)
    with sqlite_session_factory.begin() as session:
        session.add(target)
    repository = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory)
    task = build_pending_archive_download_task(
        tenant_id=TENANT_ID,
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=[target.bundle_id],
        bundle_refs=[(target.shard, target.bundle_id)],
        archive_bytes=512,
        download_id=build_archive_download_id(
            tenant_id=TENANT_ID,
            year=2025,
            month=3,
            bundle_refs=[(target.shard, target.bundle_id)],
        ),
    )
    state = [task]
    redis, _commands = redis_transport
    cache = WorkflowRunArchiveDownloadTaskCache(redis=redis)
    monkeypatch.setattr(cache, "get", lambda **_kwargs: state[0])
    monkeypatch.setattr(cache, "save", lambda saved: state.__setitem__(0, saved))
    monkeypatch.setattr(cache, "lock", lambda **_kwargs: nullcontext())
    mutex = threading.Lock()
    deletion_waiting = threading.Event()

    @contextmanager
    def month_lock(*, tenant_id: str, year: int, month: int) -> Generator[WorkflowRunArchiveMonthLease]:
        assert (tenant_id, year, month) == (TENANT_ID, 2025, 3)
        if threading.current_thread() is not threading.main_thread():
            deletion_waiting.set()
        with mutex:
            yield month_lease

    deleter = WorkflowRunArchiveDeleter(
        bundles=repository,
        archive_storage_provider=lambda: archive,
        download_storage_provider=lambda: downloads,
        month_lock=month_lock,
    )
    deletion_results = []
    deletion_worker = threading.Thread(
        target=lambda: deletion_results.append(deleter.delete(tenant_id=TENANT_ID, year=2025, month=3))
    )
    original_put, original_delete = downloads.put_object, downloads.delete_object
    compensation_failed = False

    def upload(key: str, data: bytes) -> str:
        result = original_put(key, data)
        repository.request_deletion(TENANT_ID, year=2025, month=3)
        deletion_worker.start()
        assert deletion_waiting.wait(timeout=1)
        assert deletion_worker.is_alive()
        assert key in downloads.objects
        return result

    def fail_compensation_once(key: str) -> None:
        nonlocal compensation_failed
        if not compensation_failed:
            compensation_failed = True
            raise ArchiveStorageError("compensation failed")
        original_delete(key)

    downloads.put_object = upload
    downloads.delete_object = fail_compensation_once
    preparer = WorkflowRunArchiveDownloadPreparer(
        archive_storage_provider=lambda: archive,
        download_storage_provider=lambda: downloads,
        bundles=repository,
        cache=cache,
        month_lock=month_lock,
    )
    monkeypatch.setattr(preparer, "_build_zip_payload", lambda *_args: b"prepared ZIP")

    result = preparer.prepare(tenant_id=TENANT_ID, download_id=task.download_id)
    deletion_worker.join(timeout=5)

    assert result is not None
    assert result.status == WorkflowRunArchiveDownloadStatus.FAILED
    assert compensation_failed
    assert not deletion_worker.is_alive()
    assert deletion_results[0].status == WorkflowRunArchiveDeletionStatus.COMPLETED
    assert not downloads.objects
    assert not repository.list_for_tenant_month(TENANT_ID, year=2025, month=3)
