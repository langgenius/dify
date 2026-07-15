"""
Maintain V2 workflow-run archive bundles.

Archive V2 keeps object-store manifests as the recoverable bundle source of truth. This maintenance module still
discovers delete/restore targets by listing `manifest.json` objects and uses object-store marker files for
delete/restore state. The separate database bundle index is intended for console listing and download jobs, not as the
source of truth for destructive maintenance.

Each bundle is processed in its own database transaction. A failed bundle leaves source rows unchanged unless the
transaction has already committed; marker handling makes the next run able to reconcile the common committed-but-marker
not-updated case.
"""

import datetime
import io
import json
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, TypedDict, cast

import pyarrow.parquet as pq
import sqlalchemy as sa
from sqlalchemy import delete, func, inspect, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from libs.archive_storage import ArchiveStorage, ArchiveStorageNotConfiguredError, get_archive_storage
from models.trigger import WorkflowTriggerLog
from models.workflow import (
    WorkflowAppLog,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)
from services.retention.workflow_run.constants import (
    ARCHIVE_BUNDLE_DELETE_STARTED_MARKER_NAME,
    ARCHIVE_BUNDLE_DELETED_MARKER_NAME,
    ARCHIVE_BUNDLE_FORMAT,
    ARCHIVE_BUNDLE_MANIFEST_NAME,
    ARCHIVE_BUNDLE_RESTORE_STARTED_MARKER_NAME,
    ARCHIVE_BUNDLE_RESTORED_MARKER_NAME,
    ARCHIVE_BUNDLE_SCHEMA_VERSION,
)

logger = logging.getLogger(__name__)

_ARCHIVE_ROOT_PREFIX = "workflow-runs/v2/"
_CHUNK_SIZE = 5_000


class TableManifestEntry(TypedDict):
    row_count: int
    checksum: str
    size_bytes: int
    object_key: str


class BundleManifest(TypedDict):
    schema_version: str
    archive_format: str
    tenant_id: str
    tenant_prefix: str
    year: int
    month: int
    shard: str
    bundle_id: str
    object_prefix: str
    workflow_run_count: int
    workflow_node_execution_count: int
    min_created_at: str
    max_created_at: str
    min_run_id: str
    max_run_id: str
    archived_at: str
    tables: dict[str, TableManifestEntry]
    run_ids: list[str]


@dataclass(frozen=True)
class BundleReference:
    """Object-store reference for one V2 archive bundle."""

    object_prefix: str
    manifest_key: str
    manifest: BundleManifest


@dataclass
class BundleOperationResult:
    """Result for one V2 bundle delete or restore operation."""

    bundle_id: str
    tenant_id: str
    object_prefix: str
    success: bool = False
    table_counts: dict[str, int] = field(default_factory=dict)
    archive_bytes: int = 0
    elapsed_time: float = 0.0
    validation_time: float = 0.0
    error: str | None = None

    @property
    def run_count(self) -> int:
        return self.table_counts.get("workflow_runs", 0)

    @property
    def row_count(self) -> int:
        return sum(self.table_counts.values())


@dataclass
class BundleOperationSummary:
    """Aggregate metrics for a V2 bundle maintenance command."""

    operation: str
    bundles_processed: int = 0
    bundles_succeeded: int = 0
    bundles_failed: int = 0
    rows_processed: int = 0
    runs_processed: int = 0
    archive_bytes: int = 0
    elapsed_time: float = 0.0
    validation_time: float = 0.0
    table_counts: dict[str, int] = field(default_factory=dict)
    results: list[BundleOperationResult] = field(default_factory=list)

    @property
    def runs_per_second(self) -> float:
        if self.elapsed_time <= 0:
            return 0.0
        return self.runs_processed / self.elapsed_time

    @property
    def rows_per_second(self) -> float:
        if self.elapsed_time <= 0:
            return 0.0
        return self.rows_processed / self.elapsed_time

    @property
    def bytes_per_second(self) -> float:
        if self.elapsed_time <= 0:
            return 0.0
        return self.archive_bytes / self.elapsed_time


TABLE_MODELS: dict[str, Any] = {
    "workflow_runs": WorkflowRun,
    "workflow_app_logs": WorkflowAppLog,
    "workflow_node_executions": WorkflowNodeExecutionModel,
    "workflow_node_execution_offload": WorkflowNodeExecutionOffload,
    "workflow_pauses": WorkflowPause,
    "workflow_pause_reasons": WorkflowPauseReason,
    "workflow_trigger_logs": WorkflowTriggerLog,
}

ARCHIVED_TABLES = [
    "workflow_runs",
    "workflow_app_logs",
    "workflow_node_executions",
    "workflow_node_execution_offload",
    "workflow_pauses",
    "workflow_pause_reasons",
    "workflow_trigger_logs",
]

RESTORE_ORDER = [
    "workflow_runs",
    "workflow_app_logs",
    "workflow_node_executions",
    "workflow_node_execution_offload",
    "workflow_pauses",
    "workflow_pause_reasons",
    "workflow_trigger_logs",
]


class WorkflowRunBundleArchiveMaintenance:
    """
    Delete and restore V2 workflow-run archive bundles.

    Args:
        dry_run: Validate and report counts without changing source rows or object-store markers.
        strict_content_validation: Compare source-table content checksums against Parquet content before destructive
            delete and after restore. Keep enabled for real maintenance.
        stop_on_error: Stop batch processing after the first failed bundle.
    """

    dry_run: bool
    strict_content_validation: bool
    stop_on_error: bool

    def __init__(
        self,
        *,
        dry_run: bool = False,
        strict_content_validation: bool = True,
        stop_on_error: bool = True,
    ) -> None:
        self.dry_run = dry_run
        self.strict_content_validation = strict_content_validation
        self.stop_on_error = stop_on_error

    def delete_batch(
        self,
        *,
        tenant_ids: Sequence[str] | None,
        start_date: datetime.datetime,
        end_date: datetime.datetime,
        limit: int,
    ) -> BundleOperationSummary:
        """Validate and delete source rows for archived V2 bundles in the requested created_at window."""
        return self._process_batch(
            operation="delete",
            tenant_ids=tenant_ids,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
        )

    def restore_batch(
        self,
        *,
        tenant_ids: Sequence[str] | None,
        start_date: datetime.datetime,
        end_date: datetime.datetime,
        limit: int,
    ) -> BundleOperationSummary:
        """Restore source rows for deleted V2 bundles in the requested created_at window."""
        return self._process_batch(
            operation="restore",
            tenant_ids=tenant_ids,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
        )

    def _process_batch(
        self,
        *,
        operation: str,
        tenant_ids: Sequence[str] | None,
        start_date: datetime.datetime,
        end_date: datetime.datetime,
        limit: int,
    ) -> BundleOperationSummary:
        start_time = time.time()
        summary = BundleOperationSummary(operation=operation)
        if tenant_ids is not None and not tenant_ids:
            return summary

        storage = self._get_archive_storage()
        bundle_refs = self._list_bundle_refs(
            storage,
            operation=operation,
            tenant_ids=tenant_ids,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
        )

        logger.info("Found %s V2 archive bundles for %s", len(bundle_refs), operation)
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        for bundle_ref in bundle_refs:
            with session_maker() as session:
                if operation == "delete":
                    result = self._delete_bundle(session, storage, bundle_ref)
                elif operation == "restore":
                    result = self._restore_bundle(session, storage, bundle_ref)
                else:
                    raise ValueError(f"Unsupported operation: {operation}")

            self._merge_result(summary, result)
            if not result.success and self.stop_on_error:
                logger.error("Stopping V2 bundle %s after failure: %s", operation, result.error)
                break

        summary.elapsed_time = time.time() - start_time
        return summary

    def _list_bundle_refs(
        self,
        storage: ArchiveStorage,
        *,
        operation: str,
        tenant_ids: Sequence[str] | None,
        start_date: datetime.datetime,
        end_date: datetime.datetime,
        limit: int,
    ) -> list[BundleReference]:
        start_date = self._to_naive_utc(start_date)
        end_date = self._to_naive_utc(end_date)
        manifest_keys = self._list_manifest_keys(storage, tenant_ids)
        refs: list[BundleReference] = []
        for manifest_key in manifest_keys:
            manifest_data = self._get_checked_object(storage, manifest_key)
            object_prefix = manifest_key.removesuffix(f"/{ARCHIVE_BUNDLE_MANIFEST_NAME}")
            manifest = self._load_and_validate_manifest(manifest_data, object_prefix=object_prefix)
            min_created_at = self._parse_manifest_datetime(manifest["min_created_at"])
            max_created_at = self._parse_manifest_datetime(manifest["max_created_at"])
            if max_created_at < start_date or min_created_at >= end_date:
                continue
            if tenant_ids and manifest["tenant_id"] not in tenant_ids:
                continue
            if operation == "delete" and self._is_deleted(storage, object_prefix):
                continue
            if operation == "restore" and not self._is_deleted(storage, object_prefix):
                continue
            refs.append(BundleReference(object_prefix=object_prefix, manifest_key=manifest_key, manifest=manifest))

        refs.sort(
            key=lambda ref: (
                self._parse_manifest_datetime(ref.manifest["min_created_at"]),
                ref.manifest["tenant_id"],
                ref.manifest["bundle_id"],
            )
        )
        return refs[:limit]

    @staticmethod
    def _list_manifest_keys(storage: ArchiveStorage, tenant_ids: Sequence[str] | None) -> list[str]:
        keys: list[str] = []
        if tenant_ids:
            prefixes = [
                f"{_ARCHIVE_ROOT_PREFIX}tenant_prefix={tenant_id[0].lower()}/tenant_id={tenant_id}/"
                for tenant_id in tenant_ids
            ]
        else:
            prefixes = [_ARCHIVE_ROOT_PREFIX]
        for prefix in prefixes:
            keys.extend(storage.list_objects(prefix))
        return sorted(key for key in keys if key.endswith(f"/{ARCHIVE_BUNDLE_MANIFEST_NAME}"))

    def _delete_bundle(
        self,
        session: Session,
        storage: ArchiveStorage,
        bundle_ref: BundleReference,
    ) -> BundleOperationResult:
        start_time = time.time()
        result = self._new_result(bundle_ref.manifest)
        try:
            validation_start = time.time()
            manifest, table_records, archive_bytes = self._validate_archive_object(storage, bundle_ref)
            result.table_counts = self._manifest_table_counts(manifest)
            result.archive_bytes = archive_bytes

            self._lock_workflow_runs(session, manifest["run_ids"])
            if self._is_delete_started(storage, bundle_ref.object_prefix) and self._live_counts_match(
                session, manifest, expected_present=False
            ):
                result.validation_time = time.time() - validation_start
                if not self.dry_run:
                    self._mark_deleted(storage, bundle_ref.object_prefix)
                    self._delete_marker(storage, bundle_ref.object_prefix, ARCHIVE_BUNDLE_DELETE_STARTED_MARKER_NAME)
                result.success = True
                return result

            self._validate_live_counts(session, manifest, expected_present=True)
            if self.strict_content_validation:
                self._validate_live_content(session, table_records)
            result.validation_time = time.time() - validation_start

            if not self.dry_run:
                self._put_marker(storage, bundle_ref.object_prefix, ARCHIVE_BUNDLE_DELETE_STARTED_MARKER_NAME)
                deleted_counts = self._delete_bundle_rows(session, table_records)
                if deleted_counts != result.table_counts:
                    raise ValueError(
                        f"Deleted row count mismatch: expected={result.table_counts}, actual={deleted_counts}"
                    )
                self._validate_live_counts(session, manifest, expected_present=False)
                session.commit()
                self._mark_deleted(storage, bundle_ref.object_prefix)
                self._delete_marker(storage, bundle_ref.object_prefix, ARCHIVE_BUNDLE_DELETE_STARTED_MARKER_NAME)
                self._delete_marker(storage, bundle_ref.object_prefix, ARCHIVE_BUNDLE_RESTORED_MARKER_NAME)
            result.success = True
        except Exception as e:
            session.rollback()
            result.error = str(e)
            logger.exception("Failed to delete V2 archive bundle %s", bundle_ref.object_prefix)
        result.elapsed_time = time.time() - start_time
        return result

    def _restore_bundle(
        self,
        session: Session,
        storage: ArchiveStorage,
        bundle_ref: BundleReference,
    ) -> BundleOperationResult:
        start_time = time.time()
        result = self._new_result(bundle_ref.manifest)
        try:
            validation_start = time.time()
            manifest, table_records, archive_bytes = self._validate_archive_object(storage, bundle_ref)
            result.table_counts = self._manifest_table_counts(manifest)
            result.archive_bytes = archive_bytes

            if self._live_counts_match(session, manifest, expected_present=True):
                if self.strict_content_validation:
                    self._validate_live_content(session, table_records)
                result.validation_time = time.time() - validation_start
                if not self.dry_run:
                    self._mark_restored(storage, bundle_ref.object_prefix)
                result.success = True
                return result

            self._validate_live_counts(session, manifest, expected_present=False)
            result.validation_time = time.time() - validation_start

            if not self.dry_run:
                self._put_marker(storage, bundle_ref.object_prefix, ARCHIVE_BUNDLE_RESTORE_STARTED_MARKER_NAME)
                restored_counts = self._restore_bundle_rows(session, table_records)
                if restored_counts != result.table_counts:
                    self._validate_live_counts(session, manifest, expected_present=True)
                self._validate_live_counts(session, manifest, expected_present=True)
                if self.strict_content_validation:
                    self._validate_live_content(session, table_records)
                session.commit()
                self._mark_restored(storage, bundle_ref.object_prefix)
            result.success = True
        except Exception as e:
            session.rollback()
            result.error = str(e)
            logger.exception("Failed to restore V2 archive bundle %s", bundle_ref.object_prefix)
        result.elapsed_time = time.time() - start_time
        return result

    @staticmethod
    def _new_result(manifest: BundleManifest) -> BundleOperationResult:
        return BundleOperationResult(
            bundle_id=manifest["bundle_id"],
            tenant_id=manifest["tenant_id"],
            object_prefix=manifest["object_prefix"],
        )

    def _validate_archive_object(
        self,
        storage: ArchiveStorage,
        bundle_ref: BundleReference,
    ) -> tuple[BundleManifest, dict[str, list[dict[str, Any]]], int]:
        manifest = bundle_ref.manifest
        table_records: dict[str, list[dict[str, Any]]] = {}
        total_size = len(storage.get_object(bundle_ref.manifest_key))
        for table_name in ARCHIVED_TABLES:
            info = manifest["tables"][table_name]
            payload = self._get_checked_object(storage, info["object_key"])
            total_size += len(payload)
            if len(payload) != info["size_bytes"]:
                raise ValueError(
                    f"Archive object size mismatch for {info['object_key']}: "
                    f"expected={info['size_bytes']}, actual={len(payload)}"
                )
            checksum = ArchiveStorage.compute_checksum(payload)
            if checksum != info["checksum"]:
                raise ValueError(
                    f"Archive object checksum mismatch for {info['object_key']}: "
                    f"expected={info['checksum']}, actual={checksum}"
                )
            records = self._deserialize_parquet(payload)
            if len(records) != info["row_count"]:
                raise ValueError(
                    f"Parquet row count mismatch for {info['object_key']}: "
                    f"expected={info['row_count']}, actual={len(records)}"
                )
            table_records[table_name] = records
        return manifest, table_records, total_size

    @staticmethod
    def _get_checked_object(storage: ArchiveStorage, object_key: str) -> bytes:
        if not storage.object_exists(object_key):
            raise FileNotFoundError(f"Archive object not found: {object_key}")
        return storage.get_object(object_key)

    @staticmethod
    def _load_and_validate_manifest(
        manifest_data: bytes,
        *,
        object_prefix: str,
    ) -> BundleManifest:
        loaded = json.loads(manifest_data)
        if not isinstance(loaded, dict):
            raise ValueError("manifest.json must be an object")
        required_fields = {
            "schema_version",
            "archive_format",
            "tenant_id",
            "tenant_prefix",
            "year",
            "month",
            "shard",
            "bundle_id",
            "object_prefix",
            "workflow_run_count",
            "workflow_node_execution_count",
            "tables",
            "run_ids",
        }
        missing_fields = sorted(required_fields - set(loaded))
        if missing_fields:
            raise ValueError(f"manifest missing required fields: {', '.join(missing_fields)}")
        manifest = cast(BundleManifest, loaded)
        if manifest["schema_version"] != ARCHIVE_BUNDLE_SCHEMA_VERSION:
            raise ValueError(f"unsupported bundle schema_version: {manifest['schema_version']}")
        if manifest["archive_format"] != ARCHIVE_BUNDLE_FORMAT:
            raise ValueError(f"unsupported bundle archive_format: {manifest['archive_format']}")
        if manifest["object_prefix"] != object_prefix:
            raise ValueError("manifest object_prefix does not match object key")
        if manifest["tenant_id"][0].lower() != manifest["tenant_prefix"]:
            raise ValueError("manifest tenant_prefix does not match tenant_id")
        if len(manifest["run_ids"]) != manifest["workflow_run_count"]:
            raise ValueError("manifest run_ids count does not match workflow_run_count")

        tables = manifest["tables"]
        if not isinstance(tables, dict):
            raise ValueError("manifest tables must be an object")
        for table_name in ARCHIVED_TABLES:
            if table_name not in tables:
                raise ValueError(f"manifest missing table: {table_name}")
            info = tables[table_name]
            for key in ("row_count", "checksum", "size_bytes", "object_key"):
                if key not in info:
                    raise ValueError(f"manifest table {table_name} missing {key}")
            expected_key = f"{object_prefix}/{table_name}.parquet"
            if info["object_key"] != expected_key:
                raise ValueError(
                    f"manifest object_key mismatch for {table_name}: "
                    f"expected={expected_key}, actual={info['object_key']}"
                )
        return manifest

    @staticmethod
    def _deserialize_parquet(payload: bytes) -> list[dict[str, Any]]:
        table = pq.read_table(io.BytesIO(payload))
        return table.to_pylist()

    def _validate_live_counts(
        self,
        session: Session,
        manifest: BundleManifest,
        *,
        expected_present: bool,
    ) -> None:
        expected_counts = self._manifest_table_counts(manifest)
        actual_counts = self._count_live_rows(session, manifest["run_ids"])
        if not expected_present:
            expected_counts = dict.fromkeys(expected_counts, 0)
        if actual_counts != expected_counts:
            state = "present" if expected_present else "deleted"
            raise ValueError(
                f"Live row count mismatch for {state} bundle: expected={expected_counts}, actual={actual_counts}"
            )

    def _live_counts_match(self, session: Session, manifest: BundleManifest, *, expected_present: bool) -> bool:
        expected_counts = self._manifest_table_counts(manifest)
        if not expected_present:
            expected_counts = dict.fromkeys(expected_counts, 0)
        return self._count_live_rows(session, manifest["run_ids"]) == expected_counts

    @staticmethod
    def _manifest_table_counts(manifest: BundleManifest) -> dict[str, int]:
        return {table_name: manifest["tables"][table_name]["row_count"] for table_name in ARCHIVED_TABLES}

    def _count_live_rows(self, session: Session, run_ids: Sequence[str]) -> dict[str, int]:
        node_ids = self._select_ids_by_run_ids(session, WorkflowNodeExecutionModel, run_ids)
        pause_ids = self._select_ids_by_run_ids(session, WorkflowPause, run_ids)
        return {
            "workflow_runs": self._count_by_run_ids(session, WorkflowRun, run_ids),
            "workflow_app_logs": self._count_by_run_ids(session, WorkflowAppLog, run_ids),
            "workflow_node_executions": len(node_ids),
            "workflow_node_execution_offload": self._count_by_column(
                session, WorkflowNodeExecutionOffload, WorkflowNodeExecutionOffload.node_execution_id, node_ids
            ),
            "workflow_pauses": len(pause_ids),
            "workflow_pause_reasons": self._count_by_column(
                session, WorkflowPauseReason, WorkflowPauseReason.pause_id, pause_ids
            ),
            "workflow_trigger_logs": self._count_by_run_ids(session, WorkflowTriggerLog, run_ids),
        }

    def _validate_live_content(
        self,
        session: Session,
        table_records: dict[str, list[dict[str, Any]]],
    ) -> None:
        run_ids = [str(record["id"]) for record in table_records["workflow_runs"]]
        node_ids = [str(record["id"]) for record in table_records["workflow_node_executions"]]
        pause_ids = [str(record["id"]) for record in table_records["workflow_pauses"]]

        live_records = {
            "workflow_runs": self._load_records_by_run_ids(session, WorkflowRun, run_ids),
            "workflow_app_logs": self._load_records_by_run_ids(session, WorkflowAppLog, run_ids),
            "workflow_node_executions": self._load_records_by_run_ids(session, WorkflowNodeExecutionModel, run_ids),
            "workflow_node_execution_offload": self._load_records_by_column(
                session, WorkflowNodeExecutionOffload, WorkflowNodeExecutionOffload.node_execution_id, node_ids
            ),
            "workflow_pauses": self._load_records_by_run_ids(session, WorkflowPause, run_ids),
            "workflow_pause_reasons": self._load_records_by_column(
                session, WorkflowPauseReason, WorkflowPauseReason.pause_id, pause_ids
            ),
            "workflow_trigger_logs": self._load_records_by_run_ids(session, WorkflowTriggerLog, run_ids),
        }
        for table_name in ARCHIVED_TABLES:
            live_checksum = self._records_checksum(live_records[table_name])
            archive_checksum = self._records_checksum(table_records[table_name])
            if live_checksum != archive_checksum:
                raise ValueError(
                    f"Live/archive content checksum mismatch for {table_name}: "
                    f"expected={archive_checksum}, actual={live_checksum}"
                )

    def _delete_bundle_rows(
        self,
        session: Session,
        table_records: dict[str, list[dict[str, Any]]],
    ) -> dict[str, int]:
        run_ids = [str(record["id"]) for record in table_records["workflow_runs"]]
        node_ids = [str(record["id"]) for record in table_records["workflow_node_executions"]]
        pause_ids = [str(record["id"]) for record in table_records["workflow_pauses"]]

        deleted_counts = dict.fromkeys(ARCHIVED_TABLES, 0)
        deleted_counts["workflow_pause_reasons"] = self._delete_by_column(
            session, WorkflowPauseReason, WorkflowPauseReason.pause_id, pause_ids
        )
        deleted_counts["workflow_node_execution_offload"] = self._delete_by_column(
            session, WorkflowNodeExecutionOffload, WorkflowNodeExecutionOffload.node_execution_id, node_ids
        )
        deleted_counts["workflow_trigger_logs"] = self._delete_by_run_ids(session, WorkflowTriggerLog, run_ids)
        deleted_counts["workflow_app_logs"] = self._delete_by_run_ids(session, WorkflowAppLog, run_ids)
        deleted_counts["workflow_node_executions"] = self._delete_by_run_ids(
            session, WorkflowNodeExecutionModel, run_ids
        )
        deleted_counts["workflow_pauses"] = self._delete_by_run_ids(session, WorkflowPause, run_ids)
        deleted_counts["workflow_runs"] = self._delete_by_run_ids(session, WorkflowRun, run_ids)
        return deleted_counts

    def _restore_bundle_rows(
        self,
        session: Session,
        table_records: dict[str, list[dict[str, Any]]],
    ) -> dict[str, int]:
        restored_counts = dict.fromkeys(ARCHIVED_TABLES, 0)
        for table_name in RESTORE_ORDER:
            restored_counts[table_name] = self._restore_table_records(session, table_name, table_records[table_name])
        return restored_counts

    def _restore_table_records(
        self,
        session: Session,
        table_name: str,
        records: list[dict[str, Any]],
    ) -> int:
        if not records:
            return 0
        model = TABLE_MODELS[table_name]
        total = 0
        for chunk in self._chunks(records, _CHUNK_SIZE):
            converted = [self._prepare_insert_record(model, record) for record in chunk]
            stmt = pg_insert(cast(Any, model.__table__)).values(converted)
            stmt = stmt.on_conflict_do_nothing(index_elements=["id"])
            result = session.execute(stmt)
            total += cast(CursorResult, result).rowcount or 0
        return total

    def _prepare_insert_record(
        self,
        model: Any,
        record: dict[str, Any],
    ) -> dict[str, Any]:
        table = model.__table__
        columns_by_name = {column.name: column for column in table.columns}
        prepared = {key: value for key, value in record.items() if key in columns_by_name}
        for column_name, value in list(prepared.items()):
            column = columns_by_name[column_name]
            if value is None:
                continue
            if isinstance(column.type, sa.DateTime) and isinstance(value, str):
                prepared[column_name] = datetime.datetime.fromisoformat(value)
            elif isinstance(column.type, sa.JSON) and isinstance(value, str):
                prepared[column_name] = json.loads(value)
        return prepared

    @staticmethod
    def _row_to_dict(row: Any) -> dict[str, Any]:
        mapper = inspect(row).mapper
        return {str(column.name): getattr(row, mapper.get_property_by_column(column).key) for column in mapper.columns}

    @staticmethod
    def _normalize_record_for_checksum(record: dict[str, Any]) -> dict[str, Any]:
        def normalize(value: Any) -> Any:
            if isinstance(value, Enum):
                return value.value
            if isinstance(value, dict | list):
                return json.dumps(value, default=str, ensure_ascii=False)
            return value

        return {key: normalize(value) for key, value in record.items()}

    @classmethod
    def _records_checksum(cls, records: list[dict[str, Any]]) -> str:
        normalized = [cls._normalize_record_for_checksum(record) for record in records]
        normalized.sort(key=lambda record: json.dumps(record, sort_keys=True, default=str, ensure_ascii=False))
        payload = json.dumps(normalized, sort_keys=True, default=str, ensure_ascii=False, separators=(",", ":"))
        return ArchiveStorage.compute_checksum(payload.encode("utf-8"))

    @staticmethod
    def _lock_workflow_runs(session: Session, run_ids: Sequence[str]) -> None:
        for chunk in WorkflowRunBundleArchiveMaintenance._chunks(run_ids, _CHUNK_SIZE):
            list(session.scalars(select(WorkflowRun.id).where(WorkflowRun.id.in_(chunk)).with_for_update()))

    @staticmethod
    def _select_ids_by_run_ids(
        session: Session,
        model: Any,
        run_ids: Sequence[str],
    ) -> list[str]:
        if not run_ids:
            return []
        ids: list[str] = []
        for chunk in WorkflowRunBundleArchiveMaintenance._chunks(run_ids, _CHUNK_SIZE):
            ids.extend(
                str(row_id) for row_id in session.scalars(select(model.id).where(model.workflow_run_id.in_(chunk)))
            )
        return ids

    @staticmethod
    def _count_by_run_ids(
        session: Session,
        model: Any,
        run_ids: Sequence[str],
    ) -> int:
        return WorkflowRunBundleArchiveMaintenance._count_by_column(
            session, model, WorkflowRunBundleArchiveMaintenance._run_id_column(model), run_ids
        )

    @staticmethod
    def _count_by_column(
        session: Session,
        model: Any,
        column: Any,
        values: Sequence[str],
    ) -> int:
        if not values:
            return 0
        total = 0
        for chunk in WorkflowRunBundleArchiveMaintenance._chunks(values, _CHUNK_SIZE):
            total += session.scalar(select(func.count()).select_from(model).where(column.in_(chunk))) or 0
        return total

    def _load_records_by_run_ids(
        self,
        session: Session,
        model: Any,
        run_ids: Sequence[str],
    ) -> list[dict[str, Any]]:
        return self._load_records_by_column(session, model, self._run_id_column(model), run_ids)

    def _load_records_by_column(
        self,
        session: Session,
        model: Any,
        column: Any,
        values: Sequence[str],
    ) -> list[dict[str, Any]]:
        if not values:
            return []
        rows: list[Any] = []
        for chunk in self._chunks(values, _CHUNK_SIZE):
            rows.extend(session.scalars(select(model).where(column.in_(chunk))))
        return [self._row_to_dict(row) for row in rows]

    @staticmethod
    def _delete_by_run_ids(
        session: Session,
        model: Any,
        run_ids: Sequence[str],
    ) -> int:
        return WorkflowRunBundleArchiveMaintenance._delete_by_column(
            session, model, WorkflowRunBundleArchiveMaintenance._run_id_column(model), run_ids
        )

    @staticmethod
    def _run_id_column(model: Any) -> Any:
        if model is WorkflowRun:
            return WorkflowRun.id
        return model.workflow_run_id

    @staticmethod
    def _delete_by_column(
        session: Session,
        model: Any,
        column: Any,
        values: Sequence[str],
    ) -> int:
        if not values:
            return 0
        total = 0
        for chunk in WorkflowRunBundleArchiveMaintenance._chunks(values, _CHUNK_SIZE):
            result = session.execute(delete(model).where(column.in_(chunk)))
            total += cast(CursorResult, result).rowcount or 0
        return total

    @staticmethod
    def _is_deleted(storage: ArchiveStorage, object_prefix: str) -> bool:
        return storage.object_exists(f"{object_prefix}/{ARCHIVE_BUNDLE_DELETED_MARKER_NAME}")

    @staticmethod
    def _is_delete_started(storage: ArchiveStorage, object_prefix: str) -> bool:
        return storage.object_exists(f"{object_prefix}/{ARCHIVE_BUNDLE_DELETE_STARTED_MARKER_NAME}")

    @staticmethod
    def _mark_deleted(storage: ArchiveStorage, object_prefix: str) -> None:
        WorkflowRunBundleArchiveMaintenance._put_marker(storage, object_prefix, ARCHIVE_BUNDLE_DELETED_MARKER_NAME)

    @staticmethod
    def _mark_restored(storage: ArchiveStorage, object_prefix: str) -> None:
        WorkflowRunBundleArchiveMaintenance._delete_marker(storage, object_prefix, ARCHIVE_BUNDLE_DELETED_MARKER_NAME)
        WorkflowRunBundleArchiveMaintenance._delete_marker(
            storage, object_prefix, ARCHIVE_BUNDLE_RESTORE_STARTED_MARKER_NAME
        )
        WorkflowRunBundleArchiveMaintenance._put_marker(storage, object_prefix, ARCHIVE_BUNDLE_RESTORED_MARKER_NAME)

    @staticmethod
    def _put_marker(storage: ArchiveStorage, object_prefix: str, marker_name: str) -> None:
        payload = json.dumps({"created_at": datetime.datetime.now(datetime.UTC).isoformat()}).encode("utf-8")
        storage.put_object(f"{object_prefix}/{marker_name}", payload)

    @staticmethod
    def _delete_marker(storage: ArchiveStorage, object_prefix: str, marker_name: str) -> None:
        marker_key = f"{object_prefix}/{marker_name}"
        if storage.object_exists(marker_key):
            storage.delete_object(marker_key)

    @staticmethod
    def _parse_manifest_datetime(value: str) -> datetime.datetime:
        return WorkflowRunBundleArchiveMaintenance._to_naive_utc(datetime.datetime.fromisoformat(value))

    @staticmethod
    def _to_naive_utc(value: datetime.datetime) -> datetime.datetime:
        if value.tzinfo is None:
            return value
        return value.astimezone(datetime.UTC).replace(tzinfo=None)

    @staticmethod
    def _chunks(values: Sequence[Any], size: int) -> list[Sequence[Any]]:
        return [values[index : index + size] for index in range(0, len(values), size)]

    @staticmethod
    def _get_archive_storage() -> ArchiveStorage:
        try:
            return get_archive_storage()
        except ArchiveStorageNotConfiguredError as e:
            raise RuntimeError(f"Archive storage not configured: {e}") from e

    @staticmethod
    def _merge_result(summary: BundleOperationSummary, result: BundleOperationResult) -> None:
        summary.results.append(result)
        summary.bundles_processed += 1
        summary.validation_time += result.validation_time
        if result.success:
            summary.bundles_succeeded += 1
            summary.rows_processed += result.row_count
            summary.runs_processed += result.run_count
            summary.archive_bytes += result.archive_bytes
            for table_name, count in result.table_counts.items():
                summary.table_counts[table_name] = summary.table_counts.get(table_name, 0) + count
        else:
            summary.bundles_failed += 1
