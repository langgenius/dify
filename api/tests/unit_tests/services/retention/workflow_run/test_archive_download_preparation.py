import datetime
import hashlib
import io
import json
import zipfile
from contextlib import nullcontext
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pyarrow as pa
import pyarrow.parquet as pq
from sqlalchemy.orm import Session, sessionmaker

from libs.archive_storage import ArchiveStorage
from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_bundle_index import ARCHIVE_BUNDLE_ROOT_PREFIX, ArchiveBundleManifest
from services.retention.workflow_run.archive_download_preparation import (
    WorkflowRunArchiveDownloadPreparer,
    build_archive_download_storage_key,
)
from services.retention.workflow_run.archive_download_task_cache import (
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    WorkflowRunArchiveDownloadTaskCache,
    build_archive_download_id,
    build_pending_archive_download_task,
)
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_FORMAT, ARCHIVE_BUNDLE_SCHEMA_VERSION

TENANT_ID = "1251fe32-c0c7-4fe2-a7bd-a8105267faf5"
BUNDLE_ID = "bundle-a"
SHARD = "00-of-01"
OBJECT_PREFIX = (
    f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix=1/tenant_id={TENANT_ID}/"
    f"year=2025/month=03/shard={SHARD}/bundle={BUNDLE_ID}"
)
MANIFEST_KEY = f"{OBJECT_PREFIX}/manifest.json"


class FakeArchiveStorage:
    objects: dict[str, bytes]
    put_objects: dict[str, bytes]

    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = dict(objects)
        self.put_objects = {}

    def get_object(self, key: str) -> bytes:
        return self.objects[key]

    def put_object(self, key: str, data: bytes) -> str:
        self.put_objects[key] = data
        return hashlib.md5(data).hexdigest()


class FakeTaskCache:
    task: WorkflowRunArchiveDownloadTask | None
    saved_tasks: list[WorkflowRunArchiveDownloadTask]

    def __init__(self, task: WorkflowRunArchiveDownloadTask | None) -> None:
        self.task = task
        self.saved_tasks = []

    def get(self, *, tenant_id: str, download_id: str) -> WorkflowRunArchiveDownloadTask | None:
        if self.task and self.task.tenant_id == tenant_id and self.task.download_id == download_id:
            return self.task
        return None

    def lock(self, *, tenant_id: str, download_id: str):
        return nullcontext()

    def save(self, task: WorkflowRunArchiveDownloadTask) -> None:
        self.task = task
        self.saved_tasks.append(task)


def _object_prefix(bundle_id: str = BUNDLE_ID) -> str:
    return (
        f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix=1/tenant_id={TENANT_ID}/"
        f"year=2025/month=03/shard={SHARD}/bundle={bundle_id}"
    )


def _bundle(bundle_id: str = BUNDLE_ID) -> WorkflowRunArchiveBundle:
    return cast(WorkflowRunArchiveBundle, SimpleNamespace(shard=SHARD, bundle_id=bundle_id))


def _task(bundle_refs: list[tuple[str, str]] | None = None) -> WorkflowRunArchiveDownloadTask:
    refs = bundle_refs or [(SHARD, BUNDLE_ID)]
    return build_pending_archive_download_task(
        tenant_id=TENANT_ID,
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=[bundle_id for _, bundle_id in refs],
        bundle_refs=refs,
        archive_bytes=1024,
        download_id=build_archive_download_id(
            tenant_id=TENANT_ID,
            year=2025,
            month=3,
            bundle_refs=refs,
        ),
        now=datetime.datetime(2026, 6, 25, 8, 0, tzinfo=datetime.UTC),
    )


def _manifest_bytes(table_payloads: dict[str, bytes], *, bundle_id: str = BUNDLE_ID) -> bytes:
    object_prefix = _object_prefix(bundle_id)
    manifest = ArchiveBundleManifest(
        schema_version=ARCHIVE_BUNDLE_SCHEMA_VERSION,
        archive_format=ARCHIVE_BUNDLE_FORMAT,
        tenant_id=TENANT_ID,
        tenant_prefix="1",
        year=2025,
        month=3,
        shard=SHARD,
        bundle_id=bundle_id,
        object_prefix=object_prefix,
        workflow_run_count=2,
        workflow_node_execution_count=0,
        min_created_at="2025-03-01T00:00:00+00:00",
        max_created_at="2025-03-02T00:00:00+00:00",
        min_run_id="run-a",
        max_run_id="run-b",
        archived_at="2026-06-25T08:00:00+00:00",
        tables={
            table_name: {
                "row_count": 1,
                "checksum": hashlib.md5(payload).hexdigest(),
                "size_bytes": len(payload),
                "object_key": f"{object_prefix}/{table_name}.parquet",
            }
            for table_name, payload in table_payloads.items()
        },
        run_ids=["run-a", "run-b"],
    )
    return json.dumps(manifest).encode("utf-8")


def _preparer(
    *,
    storage: FakeArchiveStorage | None = None,
    archive_storage: FakeArchiveStorage | None = None,
    download_storage: FakeArchiveStorage | None = None,
    cache: FakeTaskCache,
    bundles: list[WorkflowRunArchiveBundle] | None = None,
) -> WorkflowRunArchiveDownloadPreparer:
    source_storage = archive_storage or storage
    target_storage = download_storage or storage
    assert source_storage is not None
    assert target_storage is not None
    session = MagicMock()
    session.scalars.return_value = bundles or [_bundle()]
    session_factory = MagicMock()
    session_factory.return_value.__enter__.return_value = session
    return WorkflowRunArchiveDownloadPreparer(
        archive_storage=cast(ArchiveStorage, source_storage),
        download_storage=cast(ArchiveStorage, target_storage),
        cache=cast(WorkflowRunArchiveDownloadTaskCache, cache),
        session_factory=cast(sessionmaker[Session], session_factory),
    )


def _parquet_bytes(records: list[dict[str, object]]) -> bytes:
    buffer = io.BytesIO()
    pq.write_table(pa.Table.from_pylist(records), buffer)
    return buffer.getvalue()


def test_prepare_workflow_run_archive_download_builds_csv_zip_and_marks_ready() -> None:
    bundle_refs = [(SHARD, "bundle-a"), (SHARD, "bundle-b")]
    task = _task(bundle_refs)
    first_bundle_payloads = {
        "workflow_app_logs": _parquet_bytes([{"id": "log-a", "workflow_run_id": "run-a"}]),
        "workflow_runs": _parquet_bytes([{"id": "run-a", "status": "succeeded", "error": "=1+1"}]),
    }
    second_bundle_payloads = {
        "workflow_app_logs": _parquet_bytes([{"id": "log-b", "workflow_run_id": "run-b"}]),
        "workflow_runs": _parquet_bytes([{"id": "run-b", "status": "failed", "error": "safe"}]),
    }
    archive_storage = FakeArchiveStorage(
        {
            f"{_object_prefix('bundle-a')}/manifest.json": _manifest_bytes(
                first_bundle_payloads,
                bundle_id="bundle-a",
            ),
            **{
                f"{_object_prefix('bundle-a')}/{table}.parquet": payload
                for table, payload in first_bundle_payloads.items()
            },
            f"{_object_prefix('bundle-b')}/manifest.json": _manifest_bytes(
                second_bundle_payloads,
                bundle_id="bundle-b",
            ),
            **{
                f"{_object_prefix('bundle-b')}/{table}.parquet": payload
                for table, payload in second_bundle_payloads.items()
            },
        }
    )
    download_storage = FakeArchiveStorage({})
    cache = FakeTaskCache(task)
    preparer = _preparer(
        archive_storage=archive_storage,
        download_storage=download_storage,
        cache=cache,
        bundles=[_bundle("bundle-a"), _bundle("bundle-b")],
    )

    result = preparer.prepare(tenant_id=TENANT_ID, download_id=task.download_id)

    assert result is not None
    assert result.status == WorkflowRunArchiveDownloadStatus.READY
    assert result.storage_key == build_archive_download_storage_key(task)
    assert result.file_name == "workflow-run-logs-2025-03.zip"
    assert cache.saved_tasks[0].status == WorkflowRunArchiveDownloadStatus.PROCESSING
    assert cache.saved_tasks[-1].status == WorkflowRunArchiveDownloadStatus.READY
    assert archive_storage.put_objects == {}

    archive_payload = download_storage.put_objects[result.storage_key]
    with zipfile.ZipFile(io.BytesIO(archive_payload)) as archive:
        names = set(archive.namelist())
        assert names == {
            "workflow-run-logs-2025-03/workflow_app_logs.csv",
            "workflow-run-logs-2025-03/workflow_runs.csv",
        }
        workflow_runs_csv = archive.read("workflow-run-logs-2025-03/workflow_runs.csv").decode("utf-8")
        assert workflow_runs_csv.count('"id","status","error"') == 1
        assert '"run-a","succeeded","\'=1+1"' in workflow_runs_csv
        assert '"run-b","failed","safe"' in workflow_runs_csv


def test_prepare_workflow_run_archive_download_marks_failed_on_checksum_mismatch() -> None:
    task = _task()
    table_payloads = {"workflow_runs": _parquet_bytes([{"id": "run-a", "status": "succeeded"}])}
    manifest_data = json.loads(_manifest_bytes(table_payloads).decode("utf-8"))
    manifest_data["tables"]["workflow_runs"]["checksum"] = "bad-checksum"
    storage = FakeArchiveStorage(
        {
            MANIFEST_KEY: json.dumps(manifest_data).encode("utf-8"),
            f"{OBJECT_PREFIX}/workflow_runs.parquet": table_payloads["workflow_runs"],
        }
    )
    cache = FakeTaskCache(task)
    preparer = _preparer(storage=storage, cache=cache)

    result = preparer.prepare(tenant_id=TENANT_ID, download_id=task.download_id)

    assert result is not None
    assert result.status == WorkflowRunArchiveDownloadStatus.FAILED
    assert "checksum mismatch" in (result.error or "")
    assert storage.put_objects == {}


def test_prepare_workflow_run_archive_download_skips_duplicate_worker() -> None:
    task = _task().model_copy(update={"celery_task_id": "celery-task-1"})
    storage = FakeArchiveStorage({})
    cache = FakeTaskCache(task)
    preparer = _preparer(storage=storage, cache=cache, bundles=[])
    nested_results: list[WorkflowRunArchiveDownloadTask | None] = []
    preparer._get_task_bundles = MagicMock(return_value=[])

    def build_payload(*_args: object) -> bytes:
        nested_results.append(preparer.prepare(tenant_id=TENANT_ID, download_id=task.download_id))
        return b"zip"

    preparer._build_zip_payload = MagicMock(side_effect=build_payload)

    result = preparer.prepare(tenant_id=TENANT_ID, download_id=task.download_id)

    assert result is not None
    assert result.status == WorkflowRunArchiveDownloadStatus.READY
    assert nested_results[0] is not None
    assert nested_results[0].status == WorkflowRunArchiveDownloadStatus.PROCESSING
    preparer._build_zip_payload.assert_called_once()


def test_failed_worker_cannot_overwrite_ready_task() -> None:
    processing_task = _task().model_copy(
        update={"status": WorkflowRunArchiveDownloadStatus.PROCESSING, "celery_task_id": "celery-task-1"}
    )
    ready_task = processing_task.model_copy(update={"status": WorkflowRunArchiveDownloadStatus.READY})
    cache = FakeTaskCache(ready_task)
    preparer = _preparer(storage=FakeArchiveStorage({}), cache=cache)

    result = preparer._mark_failed(processing_task, error="late failure")

    assert result == ready_task
    assert cache.task == ready_task
    assert cache.saved_tasks == []
