"""Permanently delete requested archive files without changing live workflow-run data."""

import logging
import re
from collections.abc import Callable
from uuid import UUID

from libs.archive_storage import ArchiveStorage, ArchiveStorageError
from services.retention.workflow_run.archive_bundle_index import (
    ARCHIVE_BUNDLE_ROOT_PREFIX,
    decode_archive_bundle_manifest,
)
from services.retention.workflow_run.archive_deletion_task import (
    WorkflowRunArchiveDeletionStatus,
    WorkflowRunArchiveDeletionTask,
)
from services.retention.workflow_run.archive_download_preparation import build_archive_download_month_prefix
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveBundleRecord,
    WorkflowRunArchiveBundleStore,
)
from services.retention.workflow_run.archive_month_lock import (
    WorkflowRunArchiveMonthBusyError,
    WorkflowRunArchiveMonthLease,
    WorkflowRunArchiveMonthLock,
)
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_MANIFEST_NAME

logger = logging.getLogger(__name__)


class WorkflowRunArchiveDeleter:
    """Delete only durably requested DB bundle identities; redelivery and partial storage failures are retryable."""

    def __init__(
        self,
        *,
        bundles: WorkflowRunArchiveBundleStore,
        archive_storage_provider: Callable[[], ArchiveStorage],
        download_storage_provider: Callable[[], ArchiveStorage],
        month_lock: WorkflowRunArchiveMonthLock,
    ) -> None:
        self._bundles = bundles
        self._archive_storage_provider = archive_storage_provider
        self._download_storage_provider = download_storage_provider
        self._month_lock = month_lock

    def delete(self, *, tenant_id: str, year: int, month: int) -> WorkflowRunArchiveDeletionTask:
        """Keep all requested indexes until archive objects and temporary downloads are successfully removed."""
        try:
            # Tenant and immutable bundle paths are reconstructed from scoped DB rows, never task-supplied keys.
            UUID(tenant_id)
            if not 1 <= year <= 9999 or not 1 <= month <= 12:
                raise ValueError("Invalid workflow run archive month")
            with self._month_lock(tenant_id=tenant_id, year=year, month=month) as lease:
                return self._delete_locked(tenant_id=tenant_id, year=year, month=month, lease=lease)
        except Exception as exc:
            logger.exception(
                "Failed to delete workflow run archive month: tenant=%s year=%s month=%s", tenant_id, year, month
            )
            self._bundles.set_deletion_status(
                tenant_id, year=year, month=month, status=WorkflowRunArchiveDeletionStatus.FAILED
            )
            if isinstance(exc, WorkflowRunArchiveMonthBusyError):
                raise
            return WorkflowRunArchiveDeletionTask(
                year, month, WorkflowRunArchiveDeletionStatus.FAILED, "Failed to delete archive files. Please retry."
            )

    def _delete_locked(
        self, *, tenant_id: str, year: int, month: int, lease: WorkflowRunArchiveMonthLease
    ) -> WorkflowRunArchiveDeletionTask:
        lease.assert_owned()
        records = self._bundles.list_for_tenant_month(tenant_id, year=year, month=month)
        requested = [record for record in records if record.deletion_status is not None]
        if not requested:
            return WorkflowRunArchiveDeletionTask(year, month, WorkflowRunArchiveDeletionStatus.COMPLETED)
        self._bundles.set_deletion_status(
            tenant_id, year=year, month=month, status=WorkflowRunArchiveDeletionStatus.PROCESSING
        )
        archive_storage = self._archive_storage_provider()
        for record in requested:
            lease.assert_owned()
            prefix = _bundle_prefix(tenant_id=tenant_id, record=record)
            logger.info("Permanently deleting workflow run archive bundle: tenant=%s prefix=%s", tenant_id, prefix)
            self._delete_bundle(archive_storage, tenant_id=tenant_id, record=record, prefix=prefix)

        # The month lease serializes ZIP uploads with this cleanup, including interrupted upload workers.
        # Remove ZIPs before the last durable marker disappears.
        download_storage = self._download_storage_provider()
        download_prefix = build_archive_download_month_prefix(tenant_id=tenant_id, year=year, month=month)
        for key in _list_scoped_objects(download_storage, download_prefix):
            lease.assert_owned()
            download_storage.delete_object(key)
        if _list_scoped_objects(download_storage, download_prefix):
            raise ArchiveStorageError("Temporary workflow run archive downloads could not be deleted")

        lease.assert_owned()
        self._bundles.remove_deleted_bundles(tenant_id, catalog_ids=[record.catalog_id for record in requested])
        logger.info("Deleted workflow run archive month: tenant=%s year=%s month=%s", tenant_id, year, month)
        return WorkflowRunArchiveDeletionTask(year, month, WorkflowRunArchiveDeletionStatus.COMPLETED)

    @staticmethod
    def _delete_bundle(
        storage: ArchiveStorage, *, tenant_id: str, record: WorkflowRunArchiveBundleRecord, prefix: str
    ) -> None:
        keys = _list_scoped_objects(storage, prefix)
        manifest_key = f"{prefix}{ARCHIVE_BUNDLE_MANIFEST_NAME}"
        if manifest_key in keys:
            try:
                manifest = decode_archive_bundle_manifest(storage.get_object(manifest_key))
            except FileNotFoundError:
                # Another delivery may have completed this same immutable bundle.
                manifest = None
            if manifest is not None:
                expected = (tenant_id, record.year, record.month, record.shard, record.bundle_id, prefix.rstrip("/"))
                actual = (
                    manifest["tenant_id"],
                    manifest["year"],
                    manifest["month"],
                    manifest["shard"],
                    manifest["bundle_id"],
                    manifest["object_prefix"],
                )
                if actual != expected:
                    raise ValueError("Archive manifest identity does not match the requested bundle")
        for key in keys:
            if key != manifest_key:
                storage.delete_object(key)
        if any(key != manifest_key for key in _list_scoped_objects(storage, prefix)):
            raise ArchiveStorageError("Workflow run archive objects could not be deleted")
        # Preserve the manifest until its payloads have been removed, including on a partially failed attempt.
        storage.delete_object(manifest_key)
        if _list_scoped_objects(storage, prefix):
            raise ArchiveStorageError("Workflow run archive manifest could not be deleted")


def _bundle_prefix(*, tenant_id: str, record: WorkflowRunArchiveBundleRecord) -> str:
    if not re.fullmatch(r"\d{2}-of-\d{2}", record.shard) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", record.bundle_id):
        raise ValueError("Invalid workflow run archive bundle identity")
    return (
        f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix={tenant_id[0].lower()}/tenant_id={tenant_id}/"
        f"year={record.year:04d}/month={record.month:02d}/shard={record.shard}/bundle={record.bundle_id}/"
    )


def _list_scoped_objects(storage: ArchiveStorage, prefix: str) -> list[str]:
    keys = storage.list_objects(prefix)
    if any(not key.startswith(prefix) for key in keys):
        raise ValueError("Archive storage returned an object outside the requested bundle")
    return keys
