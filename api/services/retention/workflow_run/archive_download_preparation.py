"""
Prepare monthly workflow-run archive downloads.

Console requests create a short-lived Redis task and Celery runs this module in the background. The DB bundle index is
the online lookup source: this preparer never lists archive storage, and it validates the indexed bundle set against the
stable download id before packaging archive Parquet objects into one user-facing CSV ZIP file.
"""

import datetime
import hashlib
import io
import logging
import zipfile
from collections.abc import Sequence
from typing import cast

import pyarrow.csv as pa_csv
import pyarrow.parquet as pq
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from libs.archive_storage import ArchiveStorage, get_archive_storage, get_export_storage
from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_bundle_index import (
    ARCHIVE_BUNDLE_ROOT_PREFIX,
    ArchiveBundleManifest,
    ArchiveBundleTableManifestEntry,
    decode_archive_bundle_manifest,
)
from services.retention.workflow_run.archive_download_task_cache import (
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    WorkflowRunArchiveDownloadTaskCache,
    build_archive_download_id,
)
from services.retention.workflow_run.constants import (
    ARCHIVE_BUNDLE_FORMAT,
    ARCHIVE_BUNDLE_MANIFEST_NAME,
    ARCHIVE_BUNDLE_SCHEMA_VERSION,
)

logger = logging.getLogger(__name__)

ARCHIVE_DOWNLOAD_ROOT_PREFIX = "workflow-runs/downloads/v1/"
ARCHIVE_DOWNLOAD_MIME_TYPE = "application/zip"


class WorkflowRunArchiveDownloadPreparer:
    """
    Build one ready-to-download CSV ZIP for a Redis archive download task.

    The output object is deterministic for a given `download_id`, so retrying a failed task overwrites the same
    temporary object instead of creating unbounded duplicate files. Source archive bundles are read from the archive
    bucket, while the prepared ZIP is written to the export bucket so object lifecycle policies can expire downloads
    without touching long-lived archives.
    """

    archive_storage: ArchiveStorage | None
    download_storage: ArchiveStorage | None
    cache: WorkflowRunArchiveDownloadTaskCache
    session_factory: sessionmaker[Session]

    def __init__(
        self,
        *,
        storage: ArchiveStorage | None = None,
        archive_storage: ArchiveStorage | None = None,
        download_storage: ArchiveStorage | None = None,
        cache: WorkflowRunArchiveDownloadTaskCache | None = None,
        session_factory: sessionmaker[Session] | None = None,
    ) -> None:
        self.archive_storage = archive_storage or storage
        self.download_storage = download_storage or storage
        self.cache = cache or WorkflowRunArchiveDownloadTaskCache()
        self.session_factory = session_factory or sessionmaker(bind=db.engine, expire_on_commit=False)

    def prepare(self, *, tenant_id: str, download_id: str) -> WorkflowRunArchiveDownloadTask | None:
        """Prepare a ZIP for an existing Redis task and persist terminal task state."""
        task = self.cache.get(tenant_id=tenant_id, download_id=download_id)
        if task is None:
            logger.info("Workflow run archive download task expired before preparation: %s", download_id)
            return None
        if task.status == WorkflowRunArchiveDownloadStatus.READY:
            return task
        if task.status == WorkflowRunArchiveDownloadStatus.FAILED:
            logger.info("Skipping failed workflow run archive download task: %s", download_id)
            return task

        processing_task = self._mark_processing(task)
        try:
            archive_storage = self.archive_storage or get_archive_storage()
            download_storage = self.download_storage or get_export_storage()
            bundles = self._get_task_bundles(processing_task)
            payload = self._build_zip_payload(archive_storage, processing_task, bundles)
            storage_key = build_archive_download_storage_key(processing_task)
            download_storage.put_object(storage_key, payload)
            return self._mark_ready(processing_task, storage_key=storage_key, file_size_bytes=len(payload))
        except Exception as exc:
            logger.exception("Failed to prepare workflow run archive download %s", download_id)
            return self._mark_failed(processing_task, error=str(exc))

    def _get_task_bundles(self, task: WorkflowRunArchiveDownloadTask) -> list[WorkflowRunArchiveBundle]:
        with self.session_factory() as session:
            return _list_task_bundles(session, task)

    def _build_zip_payload(
        self,
        storage: ArchiveStorage,
        task: WorkflowRunArchiveDownloadTask,
        bundles: Sequence[WorkflowRunArchiveBundle],
    ) -> bytes:
        zip_root = f"workflow-run-logs-{task.year:04d}-{task.month:02d}"
        csv_buffers: dict[str, io.BytesIO] = {}
        csv_headers_written: set[str] = set()

        for bundle in bundles:
            object_prefix = _build_archive_bundle_object_prefix(task, bundle)
            _, manifest = _load_and_validate_manifest(storage, task, bundle, object_prefix)
            for table_name in sorted(manifest["tables"]):
                entry = manifest["tables"][table_name]
                object_key = entry["object_key"]
                table_payload = storage.get_object(object_key)
                _validate_table_payload(object_key=object_key, entry=entry, payload=table_payload)
                csv_payload = _parquet_payload_to_csv(
                    table_payload,
                    include_header=table_name not in csv_headers_written,
                )
                if not csv_payload:
                    continue
                csv_buffers.setdefault(table_name, io.BytesIO()).write(csv_payload)
                csv_headers_written.add(table_name)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            for table_name, csv_buffer in sorted(csv_buffers.items()):
                archive.writestr(f"{zip_root}/{table_name}.csv", csv_buffer.getvalue())
        return buffer.getvalue()

    def _mark_processing(self, task: WorkflowRunArchiveDownloadTask) -> WorkflowRunArchiveDownloadTask:
        now = datetime.datetime.now(datetime.UTC)
        processing_task = task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.PROCESSING,
                "error": None,
                "updated_at": now,
                "started_at": task.started_at or now,
            }
        )
        self.cache.save(processing_task)
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
        self.cache.save(ready_task)
        return ready_task

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
        self.cache.save(failed_task)
        return failed_task


def build_archive_download_file_name(task: WorkflowRunArchiveDownloadTask) -> str:
    """Return the browser download filename for one monthly archive."""
    return f"workflow-run-logs-{task.year:04d}-{task.month:02d}.zip"


def build_archive_download_storage_key(task: WorkflowRunArchiveDownloadTask) -> str:
    """Return the deterministic object-store key for a prepared download ZIP."""
    return (
        f"{ARCHIVE_DOWNLOAD_ROOT_PREFIX}tenant_prefix={task.tenant_id[0].lower()}/tenant_id={task.tenant_id}/"
        f"year={task.year:04d}/month={task.month:02d}/{task.download_id}.zip"
    )


def _list_task_bundles(session: Session, task: WorkflowRunArchiveDownloadTask) -> list[WorkflowRunArchiveBundle]:
    stmt = (
        select(WorkflowRunArchiveBundle)
        .where(
            WorkflowRunArchiveBundle.tenant_id == task.tenant_id,
            WorkflowRunArchiveBundle.year == task.year,
            WorkflowRunArchiveBundle.month == task.month,
        )
        .order_by(WorkflowRunArchiveBundle.shard, WorkflowRunArchiveBundle.bundle_id)
    )
    indexed_bundles = list(session.scalars(stmt))
    if task.bundle_refs:
        requested_refs = [(ref.shard, ref.bundle_id) for ref in task.bundle_refs]
    else:
        requested_bundle_ids = set(task.bundle_ids)
        requested_refs = [
            (bundle.shard, bundle.bundle_id)
            for bundle in indexed_bundles
            if bundle.bundle_id in requested_bundle_ids
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
    bundle: WorkflowRunArchiveBundle,
) -> str:
    return (
        f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix={task.tenant_id[0].lower()}/tenant_id={task.tenant_id}/"
        f"year={task.year:04d}/month={task.month:02d}/shard={bundle.shard}/bundle={bundle.bundle_id}"
    )


def _load_and_validate_manifest(
    storage: ArchiveStorage,
    task: WorkflowRunArchiveDownloadTask,
    bundle: WorkflowRunArchiveBundle,
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
    bundle: WorkflowRunArchiveBundle,
    manifest: ArchiveBundleManifest,
    object_prefix: str,
) -> None:
    if manifest["schema_version"] != ARCHIVE_BUNDLE_SCHEMA_VERSION:
        raise ValueError(f"unsupported archive bundle schema version: {manifest['schema_version']}")
    if manifest["archive_format"] != ARCHIVE_BUNDLE_FORMAT:
        raise ValueError(f"unsupported archive bundle format: {manifest['archive_format']}")
    expected_values = {
        "tenant_id": task.tenant_id,
        "year": task.year,
        "month": task.month,
        "shard": bundle.shard,
        "bundle_id": bundle.bundle_id,
        "object_prefix": object_prefix,
    }
    for key, expected_value in expected_values.items():
        if manifest[key] != expected_value:
            raise ValueError(f"manifest {key} mismatch: expected={expected_value}, actual={manifest[key]}")
    if not manifest["tables"]:
        raise ValueError("manifest tables must not be empty")
    for table_name, raw_entry in manifest["tables"].items():
        entry = cast(ArchiveBundleTableManifestEntry, raw_entry)
        expected_object_key = f"{object_prefix}/{table_name}.parquet"
        if entry["object_key"] != expected_object_key:
            raise ValueError(
                f"manifest object_key mismatch for {table_name}: "
                f"expected={expected_object_key}, actual={entry['object_key']}"
            )


def _validate_table_payload(
    *,
    object_key: str,
    entry: ArchiveBundleTableManifestEntry,
    payload: bytes,
) -> None:
    if len(payload) != entry["size_bytes"]:
        raise ValueError(f"archive object size mismatch for {object_key}")
    checksum = hashlib.md5(payload).hexdigest()
    if checksum != entry["checksum"]:
        raise ValueError(f"archive object checksum mismatch for {object_key}")


def _parquet_payload_to_csv(payload: bytes, *, include_header: bool) -> bytes:
    table = pq.read_table(io.BytesIO(payload))
    if table.num_columns == 0:
        return b""
    buffer = io.BytesIO()
    pa_csv.write_csv(
        table,
        buffer,
        write_options=pa_csv.WriteOptions(include_header=include_header),
    )
    return buffer.getvalue()
