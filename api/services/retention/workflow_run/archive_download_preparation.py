"""
Prepare monthly workflow-run archive downloads.

Console requests create a short-lived Redis task and Celery runs this module in the background. The DB bundle index is
the online lookup source: this preparer never lists archive storage, and it validates the indexed bundle set against the
stable download id before packaging archive Parquet objects into one user-facing CSV ZIP file.
"""

import datetime
import hashlib
import logging
import re
import tempfile
import uuid
import zipfile
from collections.abc import Callable, Sequence
from contextlib import ExitStack, closing
from functools import partial
from pathlib import Path
from typing import IO

import gevent
import gevent.monkey
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq

from core.helper.csv_sanitizer import CSVSanitizer
from libs.archive_storage import ArchiveStorage
from services.retention.workflow_run.archive_bundle_index import (
    ARCHIVE_BUNDLE_ROOT_PREFIX,
    ArchiveBundleManifest,
    ArchiveBundleTableManifestEntry,
    decode_archive_bundle_manifest,
)
from services.retention.workflow_run.archive_download_task import (
    MAX_ARCHIVE_DOWNLOAD_ATTEMPTS,
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    build_archive_download_id,
)
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveBundleQuery,
    WorkflowRunArchiveBundleRecord,
    WorkflowRunArchiveDownloadTaskStore,
)
from services.retention.workflow_run.archive_month_lock import WorkflowRunArchiveMonthLease, WorkflowRunArchiveMonthLock
from services.retention.workflow_run.constants import (
    ARCHIVE_BUNDLE_FORMAT,
    ARCHIVE_BUNDLE_MANIFEST_NAME,
    ARCHIVE_BUNDLE_SCHEMA_VERSION,
)

logger = logging.getLogger(__name__)

ARCHIVE_DOWNLOAD_ROOT_PREFIX = "workflow-runs/downloads/v1/"
_PARQUET_BATCH_SIZE = 128
_CSV_FORMULA_PREFIX_PATTERN = f"^[{re.escape(''.join(CSVSanitizer.FORMULA_CHARS))}]"


class WorkflowRunArchiveDownloadPreparer:
    """
    Build one ready-to-download CSV ZIP for a Redis archive download task.

    A renewable month lease serializes attempts and deletion. Each execution has a unique ZIP key and may only
    publish its own task state, so a worker that loses its lease cannot overwrite a newer result. Parquet objects
    and the ZIP use temporary disk files; only one Arrow batch and bounded transfer buffers stay in memory. The
    export bucket lifecycle expires interrupted attempts without touching long-lived archives.
    """

    _archive_storage_provider: Callable[[], ArchiveStorage]
    _download_storage_provider: Callable[[], ArchiveStorage]
    cache: WorkflowRunArchiveDownloadTaskStore
    _bundles: WorkflowRunArchiveBundleQuery

    def __init__(
        self,
        *,
        archive_storage_provider: Callable[[], ArchiveStorage],
        download_storage_provider: Callable[[], ArchiveStorage],
        bundles: WorkflowRunArchiveBundleQuery,
        cache: WorkflowRunArchiveDownloadTaskStore,
        month_lock: WorkflowRunArchiveMonthLock,
    ) -> None:
        self._archive_storage_provider = archive_storage_provider
        self._download_storage_provider = download_storage_provider
        self._bundles = bundles
        self.cache = cache
        self._month_lock = month_lock

    def prepare(
        self, *, tenant_id: str, download_id: str, celery_task_id: str
    ) -> WorkflowRunArchiveDownloadTask | None:
        """Run or recover a matching queued claim under the month lease, up to the persisted attempt limit.

        Terminal or superseded messages are no-ops. A busy month raises for bounded Celery retry. After claiming,
        ordinary failures persist FAILED; process death leaves PROCESSING recoverable by late-ack redelivery.
        """
        task = self.cache.get(tenant_id=tenant_id, download_id=download_id)
        if task is None:
            logger.info("Workflow run archive download task expired before preparation: %s", download_id)
            return None
        if task.celery_task_id != celery_task_id or task.status not in (
            WorkflowRunArchiveDownloadStatus.PENDING,
            WorkflowRunArchiveDownloadStatus.PROCESSING,
        ):
            return task
        with self._month_lock(tenant_id=tenant_id, year=task.year, month=task.month) as lease:
            lease.assert_owned()
            with self.cache.lock(tenant_id=tenant_id, download_id=download_id):
                current = self.cache.get(tenant_id=tenant_id, download_id=download_id)
                if (
                    current is None
                    or current.celery_task_id != celery_task_id
                    or current.status
                    not in (
                        WorkflowRunArchiveDownloadStatus.PENDING,
                        WorkflowRunArchiveDownloadStatus.PROCESSING,
                    )
                ):
                    return current
                processing_task = self._mark_processing(current)
            if processing_task.status == WorkflowRunArchiveDownloadStatus.FAILED:
                return processing_task
            try:
                return self._prepare_claimed(processing_task, lease)
            except Exception as exc:
                logger.exception(
                    "Failed to prepare workflow run archive download: tenant=%s download_id=%s execution_id=%s",
                    tenant_id,
                    download_id,
                    processing_task.execution_id,
                )
                return self._mark_failed(processing_task, error=str(exc))

    def _prepare_claimed(
        self, task: WorkflowRunArchiveDownloadTask, lease: WorkflowRunArchiveMonthLease
    ) -> WorkflowRunArchiveDownloadTask:
        """Build and upload this execution's ZIP; publish only while its cache claim and month lease remain owned.

        The caller holds the month lease. Temporary files are removed on return or exception; a rejected upload is
        deleted by its unique execution key and can never delete another attempt's published ZIP.
        """
        bundles = self._get_task_bundles(task)
        archive_storage = self._archive_storage_provider()
        download_storage = self._download_storage_provider()
        with tempfile.TemporaryDirectory(prefix="workflow-run-archive-") as directory:
            zip_path = Path(directory) / "archive.zip"
            self._build_zip_file(archive_storage, task, bundles, zip_path=zip_path, lease=lease)
            file_size = zip_path.stat().st_size
            storage_key = build_archive_download_storage_key(task)
            self._assert_execution_owned(task, lease)
            try:
                download_storage.upload_file(storage_key, str(zip_path))
                # Deletion may be requested during upload; it waits for this lease before cleaning the month.
                self._get_task_bundles(task)
                self._assert_execution_owned(task, lease)
                result = self._mark_ready(task, storage_key=storage_key, file_size_bytes=file_size)
                if result.storage_key != storage_key:
                    download_storage.delete_object(storage_key)
                return result
            except Exception:
                download_storage.delete_object(storage_key)
                raise

    def _assert_execution_owned(
        self, task: WorkflowRunArchiveDownloadTask, lease: WorkflowRunArchiveMonthLease
    ) -> None:
        """Require a live month lease and the exact PROCESSING execution; raise before publishing stale work."""
        lease.assert_owned()
        current = self.cache.get(tenant_id=task.tenant_id, download_id=task.download_id)
        if (
            current is None
            or current.status != WorkflowRunArchiveDownloadStatus.PROCESSING
            or current.celery_task_id != task.celery_task_id
            or current.execution_id != task.execution_id
        ):
            raise RuntimeError("Workflow run archive download execution was superseded or expired")

    def _get_task_bundles(self, task: WorkflowRunArchiveDownloadTask) -> list[WorkflowRunArchiveBundleRecord]:
        indexed_bundles = self._bundles.list_for_tenant_month(
            task.tenant_id,
            year=task.year,
            month=task.month,
        )
        return _select_task_bundles(indexed_bundles, task)

    def _build_zip_file(
        self,
        storage: ArchiveStorage,
        task: WorkflowRunArchiveDownloadTask,
        bundles: Sequence[WorkflowRunArchiveBundleRecord],
        *,
        zip_path: Path,
        lease: WorkflowRunArchiveMonthLease,
    ) -> None:
        """Write ordered monthly CSV entries directly into a disk ZIP, using one temporary Parquet file.

        Indexed manifests and checksums must validate. On failure the caller removes the partial files; source
        archives stay unchanged. CSV headers, bundle row order and formula escaping match the existing export.
        """
        tables: dict[str, list[ArchiveBundleTableManifestEntry]] = {}
        for bundle in bundles:
            self._assert_execution_owned(task, lease)
            object_prefix = _build_archive_bundle_object_prefix(task, bundle)
            _, manifest = _load_and_validate_manifest(storage, task, bundle, object_prefix)
            for table_name, entry in manifest["tables"].items():
                tables.setdefault(table_name, []).append(entry)

        zip_root = f"workflow-run-logs-{task.year:04d}-{task.month:02d}"
        parquet_path = zip_path.with_suffix(".parquet")
        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            for table_name, entries in sorted(tables.items()):
                with ExitStack() as outputs:
                    output: IO[bytes] | None = None
                    header_written = False
                    for entry in entries:
                        self._assert_execution_owned(task, lease)
                        _download_parquet(storage, entry, parquet_path)
                        if len(_run_archive_cpu_work(lambda: pq.read_schema(parquet_path))) > 0:
                            if output is None:
                                output = outputs.enter_context(
                                    archive.open(f"{zip_root}/{table_name}.csv", mode="w", force_zip64=True)
                                )
                            wrote_csv = _run_archive_cpu_work(
                                partial(
                                    _append_parquet_csv,
                                    parquet_path,
                                    output,
                                    include_header=not header_written,
                                )
                            )
                            header_written = header_written or wrote_csv
        parquet_path.unlink(missing_ok=True)

    def _mark_processing(self, task: WorkflowRunArchiveDownloadTask) -> WorkflowRunArchiveDownloadTask:
        """With the cache lock and month lease held, persist a new execution or terminalize an exhausted claim."""
        now = datetime.datetime.now(datetime.UTC)
        if task.attempt_count >= MAX_ARCHIVE_DOWNLOAD_ATTEMPTS:
            failed = task.model_copy(
                update={
                    "status": WorkflowRunArchiveDownloadStatus.FAILED,
                    "error": "Archive download preparation was interrupted too many times. Please retry.",
                    "updated_at": now,
                    "finished_at": now,
                }
            )
            self.cache.save(failed)
            logger.warning(
                "Workflow run archive download attempt limit reached: tenant=%s download_id=%s attempts=%s",
                task.tenant_id,
                task.download_id,
                task.attempt_count,
            )
            return failed
        processing_task = task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.PROCESSING,
                "execution_id": uuid.uuid4().hex,
                "attempt_count": task.attempt_count + 1,
                "error": None,
                "updated_at": now,
                "started_at": now,
                "finished_at": None,
            }
        )
        self.cache.save(processing_task)
        logger.info(
            "Preparing workflow run archive download: tenant=%s download_id=%s execution_id=%s attempt=%s "
            "previous_status=%s",
            processing_task.tenant_id,
            processing_task.download_id,
            processing_task.execution_id,
            processing_task.attempt_count,
            task.status,
        )
        return processing_task

    def _mark_ready(
        self,
        task: WorkflowRunArchiveDownloadTask,
        *,
        storage_key: str,
        file_size_bytes: int,
    ) -> WorkflowRunArchiveDownloadTask:
        now = datetime.datetime.now(datetime.UTC)
        ready_task = task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.READY,
                "file_name": build_archive_download_file_name(task),
                "storage_key": storage_key,
                "file_size_bytes": file_size_bytes,
                "error": None,
                "updated_at": now,
                "finished_at": now,
            }
        )
        return self._save_terminal_task(task, ready_task)

    def _mark_failed(self, task: WorkflowRunArchiveDownloadTask, *, error: str) -> WorkflowRunArchiveDownloadTask:
        now = datetime.datetime.now(datetime.UTC)
        failed_task = task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.FAILED,
                "error": error,
                "updated_at": now,
                "finished_at": now,
            }
        )
        return self._save_terminal_task(task, failed_task)

    def _save_terminal_task(
        self,
        processing_task: WorkflowRunArchiveDownloadTask,
        terminal_task: WorkflowRunArchiveDownloadTask,
    ) -> WorkflowRunArchiveDownloadTask:
        with self.cache.lock(tenant_id=processing_task.tenant_id, download_id=processing_task.download_id):
            current = self.cache.get(
                tenant_id=processing_task.tenant_id,
                download_id=processing_task.download_id,
            )
            if (
                current is None
                or current.status != WorkflowRunArchiveDownloadStatus.PROCESSING
                or current.celery_task_id != processing_task.celery_task_id
                or current.execution_id != processing_task.execution_id
            ):
                return current or terminal_task
            self.cache.save(terminal_task)
            return terminal_task


def build_archive_download_file_name(task: WorkflowRunArchiveDownloadTask) -> str:
    """Return the browser download filename for one monthly archive."""
    return f"workflow-run-logs-{task.year:04d}-{task.month:02d}.zip"


def build_archive_download_storage_key(task: WorkflowRunArchiveDownloadTask) -> str:
    """Require a claimed execution and return its isolated ZIP key under the monthly deletion prefix."""
    if not task.execution_id:
        raise ValueError("execution_id is required before archive upload")
    prefix = build_archive_download_month_prefix(tenant_id=task.tenant_id, year=task.year, month=task.month)
    return f"{prefix}{task.download_id}/{task.execution_id}.zip"


def build_archive_download_month_prefix(*, tenant_id: str, year: int, month: int) -> str:
    return (
        f"{ARCHIVE_DOWNLOAD_ROOT_PREFIX}tenant_prefix={tenant_id[0].lower()}/tenant_id={tenant_id}/"
        f"year={year:04d}/month={month:02d}/"
    )


def _select_task_bundles(
    indexed_bundles: Sequence[WorkflowRunArchiveBundleRecord],
    task: WorkflowRunArchiveDownloadTask,
) -> list[WorkflowRunArchiveBundleRecord]:
    if any(bundle.deletion_status is not None for bundle in indexed_bundles):
        raise ValueError("This workflow run archive is being permanently deleted.")
    if task.bundle_refs:
        requested_refs = [(ref.shard, ref.bundle_id) for ref in task.bundle_refs]
    else:
        requested_bundle_ids = set(task.bundle_ids)
        requested_refs = [
            (bundle.shard, bundle.bundle_id) for bundle in indexed_bundles if bundle.bundle_id in requested_bundle_ids
        ]

    bundle_by_ref = {(bundle.shard, bundle.bundle_id): bundle for bundle in indexed_bundles}
    missing_refs = [ref for ref in requested_refs if ref not in bundle_by_ref]
    if missing_refs:
        raise ValueError(f"archive bundle index is missing requested bundles: {missing_refs}")

    bundles = [bundle_by_ref[ref] for ref in requested_refs]
    if len(bundles) != task.bundle_count:
        raise ValueError(f"archive bundle count changed: expected={task.bundle_count}, actual={len(bundles)}")

    download_id = build_archive_download_id(
        tenant_id=task.tenant_id,
        year=task.year,
        month=task.month,
        bundle_refs=requested_refs,
    )
    if download_id != task.download_id:
        raise ValueError("archive download id no longer matches indexed bundle set")

    return bundles


def _build_archive_bundle_object_prefix(
    task: WorkflowRunArchiveDownloadTask,
    bundle: WorkflowRunArchiveBundleRecord,
) -> str:
    return (
        f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix={task.tenant_id[0].lower()}/tenant_id={task.tenant_id}/"
        f"year={task.year:04d}/month={task.month:02d}/shard={bundle.shard}/bundle={bundle.bundle_id}"
    )


def _load_and_validate_manifest(
    storage: ArchiveStorage,
    task: WorkflowRunArchiveDownloadTask,
    bundle: WorkflowRunArchiveBundleRecord,
    object_prefix: str,
) -> tuple[bytes, ArchiveBundleManifest]:
    manifest_key = f"{object_prefix}/{ARCHIVE_BUNDLE_MANIFEST_NAME}"
    manifest_data = storage.get_object(manifest_key)
    manifest = decode_archive_bundle_manifest(manifest_data)
    _validate_manifest(task=task, bundle=bundle, manifest=manifest, object_prefix=object_prefix)
    return manifest_data, manifest


def _validate_manifest(
    *,
    task: WorkflowRunArchiveDownloadTask,
    bundle: WorkflowRunArchiveBundleRecord,
    manifest: ArchiveBundleManifest,
    object_prefix: str,
) -> None:
    if manifest["schema_version"] != ARCHIVE_BUNDLE_SCHEMA_VERSION:
        raise ValueError(f"unsupported archive bundle schema version: {manifest['schema_version']}")
    if manifest["archive_format"] != ARCHIVE_BUNDLE_FORMAT:
        raise ValueError(f"unsupported archive bundle format: {manifest['archive_format']}")
    if manifest["tenant_id"] != task.tenant_id:
        raise ValueError(f"manifest tenant_id mismatch: expected={task.tenant_id}, actual={manifest['tenant_id']}")
    if manifest["year"] != task.year:
        raise ValueError(f"manifest year mismatch: expected={task.year}, actual={manifest['year']}")
    if manifest["month"] != task.month:
        raise ValueError(f"manifest month mismatch: expected={task.month}, actual={manifest['month']}")
    if manifest["shard"] != bundle.shard:
        raise ValueError(f"manifest shard mismatch: expected={bundle.shard}, actual={manifest['shard']}")
    if manifest["bundle_id"] != bundle.bundle_id:
        raise ValueError(f"manifest bundle_id mismatch: expected={bundle.bundle_id}, actual={manifest['bundle_id']}")
    if manifest["object_prefix"] != object_prefix:
        raise ValueError(
            f"manifest object_prefix mismatch: expected={object_prefix}, actual={manifest['object_prefix']}"
        )
    if not manifest["tables"]:
        raise ValueError("manifest tables must not be empty")
    for table_name, raw_entry in manifest["tables"].items():
        entry = raw_entry
        expected_object_key = f"{object_prefix}/{table_name}.parquet"
        if entry["object_key"] != expected_object_key:
            raise ValueError(
                f"manifest object_key mismatch for {table_name}: "
                f"expected={expected_object_key}, actual={entry['object_key']}"
            )


def _download_parquet(storage: ArchiveStorage, entry: ArchiveBundleTableManifestEntry, path: Path) -> None:
    """Stream one indexed object to disk and verify its size and checksum before decoding; raise on corruption."""
    checksum = hashlib.md5()
    size = 0
    with path.open("wb") as output, closing(storage.get_object_stream(entry["object_key"])) as chunks:
        for chunk in chunks:
            size += len(chunk)
            if size > entry["size_bytes"]:
                raise ValueError(f"archive object size mismatch for {entry['object_key']}")
            checksum.update(chunk)
            output.write(chunk)
    if size != entry["size_bytes"]:
        raise ValueError(f"archive object size mismatch for {entry['object_key']}")
    if checksum.hexdigest() != entry["checksum"]:
        raise ValueError(f"archive object checksum mismatch for {entry['object_key']}")


def _append_parquet_csv(
    path: Path,
    output: IO[bytes],
    *,
    include_header: bool,
) -> bool:
    """Append bounded Arrow batches to an open ZIP entry, preserving CSV escaping and optional headers.

    The Parquet file is already verified. Return whether a CSV schema was written; leave the caller's output open.
    """
    with pq.ParquetFile(path, pre_buffer=False, buffer_size=64 * 1024) as parquet:
        if len(parquet.schema_arrow) == 0:
            return False
        with pa_csv.CSVWriter(
            output, parquet.schema_arrow, write_options=pa_csv.WriteOptions(include_header=include_header)
        ) as writer:
            for batch in parquet.iter_batches(batch_size=_PARQUET_BATCH_SIZE, use_threads=False):
                for column_index, field in enumerate(batch.schema):
                    if pa.types.is_string(field.type) or pa.types.is_large_string(field.type):
                        sanitized = pc.replace_substring_regex(  # pyrefly: ignore[missing-attribute]
                            batch.column(column_index),
                            pattern=_CSV_FORMULA_PREFIX_PATTERN,
                            replacement=r"'\0",
                            max_replacements=1,
                        )
                        batch = batch.set_column(column_index, field, sanitized)
                writer.write_batch(batch)
    return True


def _run_archive_cpu_work[T](work: Callable[[], T]) -> T:
    """Keep lease renewal responsive in gevent workers; storage I/O stays on the calling greenlet."""
    if gevent.monkey.is_module_patched("threading"):
        return gevent.get_hub().threadpool.apply(work)
    return work()
