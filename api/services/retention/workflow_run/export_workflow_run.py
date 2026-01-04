"""
Workflow Run Export Service.

This service handles exporting workflow run data including node executions,
supporting both archived (from storage) and non-archived (from DB) runs.
"""

import io
import json
import logging
import tarfile
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageNotConfiguredError,
    get_archive_storage,
    get_export_storage,
)
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository

logger = logging.getLogger(__name__)


class WorkflowRunExportError(Exception):
    """Exception raised when export fails."""

    pass


class WorkflowRunExportService:
    """
    Service for exporting workflow run data.

    Handles both archived and non-archived workflow runs:
    - Non-archived runs: Data is fetched from the database
    - Archived runs: Data is fetched from storage
    """

    EXPORTED_TABLES = [
        "workflow_app_logs",
        "workflow_node_executions",
        "workflow_node_execution_offload",
        "workflow_pauses",
        "workflow_pause_reasons",
        "workflow_trigger_logs",
    ]
    ARCHIVE_SCHEMA_VERSION = "1.0"
    ARCHIVE_BUNDLE_NAME = f"archive.v{ARCHIVE_SCHEMA_VERSION}.tar"

    def __init__(self):
        self.workflow_run_repo: APIWorkflowRunRepository | None = None

    def export(
        self,
        tenant_id: str,
        run_id: str,
    ) -> bytes:
        """
        Export a workflow run as a ZIP file.

        Args:
            tenant_id: Tenant ID
            run_id: Workflow run ID

        Returns:
            ZIP file bytes containing all workflow run data

        Raises:
            WorkflowRunExportError: If export fails
        """
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        repo = self._get_workflow_run_repo()

        with session_maker() as session:
            run = repo.get_workflow_run_by_id_without_tenant(run_id)

            if not run:
                raise WorkflowRunExportError(f"Workflow run {run_id} not found")

            if run.tenant_id != tenant_id:
                raise WorkflowRunExportError(f"Workflow run {run_id} does not belong to tenant {tenant_id}")

            if run.is_archived:
                return self._export_from_s3(session, run)
            return self._export_from_db(session, run)

    def export_to_storage(
        self,
        tenant_id: str,
        run_id: str,
        task_id: str | None = None,
    ) -> dict[str, str | int]:
        """
        Export a workflow run and upload the ZIP to archive storage.

        Returns:
            Dict containing task_id, storage_key, checksum, and size_bytes.
        """
        data = self.export(tenant_id=tenant_id, run_id=run_id)

        task_id = task_id or str(uuid4())
        storage_key = f"exports/workflow_runs/tenant_id={tenant_id}/workflow_run_id={run_id}/task_id={task_id}.zip"

        storage = get_export_storage()
        checksum = storage.put_object(storage_key, data)

        return {
            "task_id": task_id,
            "storage_key": storage_key,
            "checksum": checksum,
            "size_bytes": len(data),
        }

    def _export_from_db(
        self,
        session: Session,
        run: WorkflowRun,
    ) -> bytes:
        """
        Export workflow run data from the database.

        Args:
            session: Database session
            run: WorkflowRun model instance

        Returns:
            ZIP file bytes
        """
        zip_buffer = io.BytesIO()
        table_data = self._collect_db_table_data(session, run)

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # Add workflow run metadata
            run_data = self._row_to_dict(run)
            zf.writestr(
                "workflow_run.json",
                json.dumps(run_data, indent=2, default=str),
            )

            # Extract and add each table's data
            table_stats = {}
            for table_name in self.EXPORTED_TABLES:
                records = table_data.get(table_name, [])
                table_stats[table_name] = {"row_count": len(records)}

                if records:
                    zf.writestr(
                        f"{table_name}.json",
                        json.dumps(records, indent=2, default=str),
                    )

            manifest = {
                "schema_version": "1.0",
                "workflow_run_id": run.id,
                "tenant_id": run.tenant_id,
                "app_id": run.app_id,
                "workflow_id": run.workflow_id,
                "created_at": run.created_at.isoformat() if run.created_at else None,
                "exported_at": datetime.now(UTC).isoformat(),
                "source": "database",
                "tables": table_stats,
            }
            zf.writestr(
                "manifest.json",
                json.dumps(manifest, indent=2),
            )

        zip_buffer.seek(0)
        return zip_buffer.read()

    def _export_from_s3(
        self,
        session: Session,
        run: WorkflowRun,
    ) -> bytes:
        """
        Export workflow run data from storage.

        Args:
            run: WorkflowRun model instance

        Returns:
            ZIP file bytes
        """
        try:
            storage = get_archive_storage()
        except ArchiveStorageNotConfiguredError as e:
            raise WorkflowRunExportError(f"Archive storage not configured: {e}")

        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # Add workflow run metadata from DB
            run_data = self._row_to_dict(run)
            zf.writestr(
                "workflow_run.json",
                json.dumps(run_data, indent=2, default=str),
            )

            created_at = run.created_at
            prefix = (
                f"{run.tenant_id}/app_id={run.app_id}/year={created_at.strftime('%Y')}/"
                f"month={created_at.strftime('%m')}/workflow_run_id={run.id}"
            )
            archive_key = f"{prefix}/{self.ARCHIVE_BUNDLE_NAME}"
            try:
                archive_data = storage.get_object(archive_key)
            except FileNotFoundError:
                raise WorkflowRunExportError(f"Archive bundle not found: {archive_key}")

            with tarfile.open(fileobj=io.BytesIO(archive_data), mode="r") as tar:
                try:
                    fileobj = tar.extractfile("manifest.json")
                except KeyError as e:
                    raise WorkflowRunExportError("manifest.json missing from archive bundle") from e
                if fileobj is None:
                    raise WorkflowRunExportError("manifest.json missing from archive bundle")
                manifest = json.loads(fileobj.read().decode("utf-8"))

                # Download and add each archived table's data
                tables = manifest.get("tables", {})
                for table_name, info in tables.items():
                    row_count = info.get("row_count", 0)
                    if row_count == 0:
                        continue

                    member_path = f"{table_name}.jsonl.gz"
                    try:
                        fileobj = tar.extractfile(member_path)
                    except KeyError:
                        logger.warning("Table data not found: %s", member_path)
                        continue
                    if fileobj is None:
                        logger.warning("Table data not found: %s", member_path)
                        continue
                    data = fileobj.read()
                    records = ArchiveStorage.deserialize_from_jsonl_gz(data)
                    zf.writestr(
                        f"{table_name}.json",
                        json.dumps(records, indent=2, default=str),
                    )

            # Add DB-resident tables (workflow_app_logs)
            table_data = self._collect_db_table_data(session, run)
            app_logs = table_data.get("workflow_app_logs", [])
            if app_logs:
                zf.writestr(
                    "workflow_app_logs.json",
                    json.dumps(app_logs, indent=2, default=str),
                )
            # Update manifest tables info
            tables["workflow_app_logs"] = {"row_count": len(app_logs)}

            # Update manifest with export info
            manifest["exported_at"] = datetime.now(UTC).isoformat()
            manifest["source"] = "archive"
            zf.writestr(
                "manifest.json",
                json.dumps(manifest, indent=2),
            )

        zip_buffer.seek(0)
        return zip_buffer.read()

    def _collect_db_table_data(
        self,
        session: Session,
        run: WorkflowRun,
    ) -> dict[str, list[dict[str, Any]]]:
        """
        Collect all DB-resident tables for a workflow run in a single pass.
        """
        repo = self._get_workflow_run_repo()
        table_data: dict[str, list[dict[str, Any]]] = {}

        run_context: DifyAPISQLAlchemyWorkflowNodeExecutionRepository.RunContext = {
            "run_id": run.id,
            "tenant_id": run.tenant_id,
            "app_id": run.app_id,
            "workflow_id": run.workflow_id,
            "triggered_from": run.triggered_from,
        }

        node_exec_records = DifyAPISQLAlchemyWorkflowNodeExecutionRepository.get_by_run(session, run_context)
        node_exec_ids = [record.id for record in node_exec_records]
        offload_records = DifyAPISQLAlchemyWorkflowNodeExecutionRepository.get_offloads_by_execution_ids(
            session,
            node_exec_ids,
        )
        table_data["workflow_node_executions"] = [self._row_to_dict(row) for row in node_exec_records]
        table_data["workflow_node_execution_offload"] = [self._row_to_dict(row) for row in offload_records]

        pause_records = repo.get_pause_records_by_run_id(session, run.id)
        pause_ids = [pause.id for pause in pause_records]
        pause_reason_records = repo.get_pause_reason_records_by_run_id(session, pause_ids)
        table_data["workflow_pauses"] = [self._row_to_dict(row) for row in pause_records]
        table_data["workflow_pause_reasons"] = [self._row_to_dict(row) for row in pause_reason_records]

        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        trigger_records = trigger_repo.list_by_run_id(run.id)
        table_data["workflow_trigger_logs"] = [self._row_to_dict(row) for row in trigger_records]

        app_logs = repo.get_app_logs_by_run_id(session, run.id)
        table_data["workflow_app_logs"] = [self._row_to_dict(row) for row in app_logs]

        return table_data

    @staticmethod
    def _row_to_dict(row: Any) -> dict[str, Any]:
        mapper = inspect(row).mapper
        return {str(column.name): getattr(row, mapper.get_property_by_column(column).key) for column in mapper.columns}

    def _get_workflow_run_repo(self) -> APIWorkflowRunRepository:
        if self.workflow_run_repo is not None:
            return self.workflow_run_repo

        self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
            sessionmaker(bind=db.engine, expire_on_commit=False)
        )
        return self.workflow_run_repo


class WorkflowRunExportTaskService:
    """
    Service for workflow run export task status tracking.
    """

    TASK_STATUS_TTL_SECONDS = 7 * 24 * 3600
    EXPORT_SIGNED_URL_EXPIRE_SECONDS = 3600
    PUBLIC_TASK_STATUS_FIELDS = {
        "task_id",
        "status",
        "presigned_url",
        "presigned_url_expires_at",
    }

    def __init__(self, redis=redis_client, storage_provider=get_export_storage):
        self._redis = redis
        self._storage_provider = storage_provider

    @staticmethod
    def _task_key(task_id: str) -> str:
        return f"workflow_run_export:task:{task_id}"

    @staticmethod
    def _run_key(tenant_id: str, app_id: str, run_id: str) -> str:
        return f"workflow_run_export:run:{tenant_id}:{app_id}:{run_id}"

    def _save_task_status(self, task_id: str, data: dict[str, Any]) -> None:
        self._redis.set(
            self._task_key(task_id),
            json.dumps(data, default=str),
            ex=self.TASK_STATUS_TTL_SECONDS,
        )

    def set_task_status(self, task_id: str, status: str, payload: dict | None = None) -> None:
        data: dict[str, Any] = {
            "task_id": task_id,
            "status": status,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        if payload:
            data.update(payload)
        if data.get("presigned_url") and not data.get("presigned_url_expires_at"):
            data["presigned_url_expires_at"] = (
                datetime.now(UTC) + timedelta(seconds=self.EXPORT_SIGNED_URL_EXPIRE_SECONDS)
            ).isoformat()
        self._save_task_status(task_id, data)

    @staticmethod
    def _parse_iso_datetime(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _is_presigned_url_expired(self, status: dict[str, Any]) -> bool:
        expires_at = self._parse_iso_datetime(status.get("presigned_url_expires_at"))
        if expires_at:
            return expires_at <= datetime.now(UTC)
        return True

    def _refresh_presigned_url(self, task_id: str, status: dict[str, Any]) -> dict[str, Any]:
        if status.get("status") != "success":
            return status
        storage_key = status.get("storage_key")
        if not storage_key:
            return status
        if status.get("presigned_url") and not self._is_presigned_url_expired(status):
            return status

        try:
            storage = self._storage_provider()
            presigned_url = storage.generate_presigned_url(
                storage_key,
                expires_in=self.EXPORT_SIGNED_URL_EXPIRE_SECONDS,
            )
        except Exception:
            return status

        status["presigned_url"] = presigned_url
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=self.EXPORT_SIGNED_URL_EXPIRE_SECONDS)
        status["presigned_url_expires_at"] = expires_at.isoformat()
        status["updated_at"] = now.isoformat()
        self._save_task_status(task_id, status)
        return status

    def get_task_status(self, task_id: str) -> dict[str, Any] | None:
        raw = self._redis.get(self._task_key(task_id))
        if not raw:
            return None
        try:
            status = json.loads(raw)
        except Exception:
            return None
        return self._refresh_presigned_url(task_id, status)

    def get_public_task_status(self, task_id: str) -> dict[str, Any] | None:
        status = self.get_task_status(task_id)
        if not status:
            return None
        return {key: status[key] for key in self.PUBLIC_TASK_STATUS_FIELDS if key in status}

    def reserve_task_for_run(self, tenant_id: str, app_id: str, run_id: str, task_id: str) -> str:
        """
        Record the export task id for a workflow run if not already set.

        Returns the existing task id if one was already recorded, otherwise the provided task_id.
        """
        key = self._run_key(tenant_id, app_id, run_id)
        if self._redis.setnx(key, task_id):
            self._redis.expire(key, self.TASK_STATUS_TTL_SECONDS)
            return task_id

        existing = self._redis.get(key)
        if existing:
            return existing.decode() if isinstance(existing, bytes) else str(existing)
        return task_id

    def get_task_id_for_run(self, tenant_id: str, app_id: str, run_id: str) -> str | None:
        key = self._run_key(tenant_id, app_id, run_id)
        existing = self._redis.get(key)
        if not existing:
            return None
        return existing.decode() if isinstance(existing, bytes) else str(existing)
