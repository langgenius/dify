"""
Workflow Run Export Service.

This service handles exporting workflow run data including node executions,
supporting both archived (from storage) and non-archived (from DB) runs.
"""

import io
import json
import logging
import zipfile
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageNotConfiguredError,
    build_workflow_run_prefix,
    get_archive_storage,
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

    def __init__(self):
        self.workflow_run_repo: APIWorkflowRunRepository | None = None

    def export(
        self,
        tenant_id: str,
        run_id: str,
        include_manifest: bool = True,
    ) -> bytes:
        """
        Export a workflow run as a ZIP file.

        Args:
            tenant_id: Tenant ID
            run_id: Workflow run ID
            include_manifest: Whether to include the manifest file in the export

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
                return self._export_from_s3(session, run, include_manifest)
            return self._export_from_db(session, run, include_manifest)

    def export_to_storage(
        self,
        tenant_id: str,
        run_id: str,
        include_manifest: bool = True,
        task_id: str | None = None,
    ) -> dict[str, str | int]:
        """
        Export a workflow run and upload the ZIP to archive storage.

        Returns:
            Dict containing task_id, storage_key, checksum, and size_bytes.
        """
        data = self.export(tenant_id=tenant_id, run_id=run_id, include_manifest=include_manifest)

        task_id = task_id or str(uuid4())
        storage_key = f"exports/workflow_runs/tenant_id={tenant_id}/workflow_run_id={run_id}/task_id={task_id}.zip"

        storage = get_archive_storage()
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
        include_manifest: bool,
    ) -> bytes:
        """
        Export workflow run data from the database.

        Args:
            session: Database session
            run: WorkflowRun model instance
            include_manifest: Whether to include a generated manifest

        Returns:
            ZIP file bytes
        """
        zip_buffer = io.BytesIO()
        table_data = self._collect_db_table_data(session, run.id)

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # Add workflow run metadata
            run_data = run.to_dict()
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

            # Add manifest if requested
            if include_manifest:
                manifest = {
                    "schema_version": "1.0",
                    "workflow_run_id": run.id,
                    "tenant_id": run.tenant_id,
                    "app_id": run.app_id,
                    "workflow_id": run.workflow_id,
                    "created_at": run.created_at.isoformat() if run.created_at else None,
                    "exported_at": datetime.now(datetime.UTC).isoformat(),
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
        include_manifest: bool,
    ) -> bytes:
        """
        Export workflow run data from storage.

        Args:
            run: WorkflowRun model instance
            include_manifest: Whether to include the manifest file

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
            run_data = run.to_dict()
            zf.writestr(
                "workflow_run.json",
                json.dumps(run_data, indent=2, default=str),
            )

            # Load manifest
            prefix = build_workflow_run_prefix(
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                created_at=run.created_at,
                run_id=run.id,
            )
            manifest_key = f"{prefix}/manifest.json"
            try:
                manifest_data = storage.get_object(manifest_key)
                manifest = json.loads(manifest_data.decode("utf-8"))
            except FileNotFoundError:
                raise WorkflowRunExportError(f"Archived manifest not found: {manifest_key}")

            # Download and add each archived table's data
            tables = manifest.get("tables", {})
            for table_name, info in tables.items():
                row_count = info.get("row_count", 0)
                if row_count == 0:
                    continue

                table_key = f"{prefix}/table={table_name}/data.jsonl.gz"
                try:
                    data = storage.get_object(table_key)
                    records = ArchiveStorage.deserialize_from_jsonl_gz(data)
                    zf.writestr(
                        f"{table_name}.json",
                        json.dumps(records, indent=2, default=str),
                    )
                except FileNotFoundError:
                    logger.warning("Table data not found: %s", table_key)

            # Add DB-resident tables (workflow_app_logs)
            table_data = self._collect_db_table_data(session, run.id)
            app_logs = table_data.get("workflow_app_logs", [])
            if app_logs:
                zf.writestr(
                    "workflow_app_logs.json",
                    json.dumps(app_logs, indent=2, default=str),
                )
            # Update manifest tables info
            tables["workflow_app_logs"] = {"row_count": len(app_logs)}

            # Add manifest if requested
            if include_manifest:
                # Update manifest with export info
                manifest["exported_at"] = datetime.now(datetime.UTC).isoformat()
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
        run_id: str,
    ) -> dict[str, list[dict[str, Any]]]:
        """
        Collect all DB-resident tables for a workflow run in a single pass.
        """
        repo = self._get_workflow_run_repo()
        table_data: dict[str, list[dict[str, Any]]] = {}

        node_exec_records = DifyAPISQLAlchemyWorkflowNodeExecutionRepository.get_by_run_id(session, run_id)
        node_exec_ids = [record.id for record in node_exec_records]
        offload_records = DifyAPISQLAlchemyWorkflowNodeExecutionRepository.get_offloads_by_execution_ids(
            session,
            node_exec_ids,
        )
        table_data["workflow_node_executions"] = [self._model_to_dict(row) for row in node_exec_records]
        table_data["workflow_node_execution_offload"] = [self._model_to_dict(row) for row in offload_records]

        pause_records = repo.get_pause_records_by_run_id(session, run_id)
        pause_ids = [pause.id for pause in pause_records]
        pause_reason_records = repo.get_pause_reason_records_by_run_id(session, pause_ids)
        table_data["workflow_pauses"] = [self._model_to_dict(row) for row in pause_records]
        table_data["workflow_pause_reasons"] = [self._model_to_dict(row) for row in pause_reason_records]

        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        trigger_records = trigger_repo.list_by_run_id(run_id)
        table_data["workflow_trigger_logs"] = [self._model_to_dict(row) for row in trigger_records]

        app_logs = repo.get_app_logs_by_run_id(session, run_id)
        table_data["workflow_app_logs"] = [self._model_to_dict(row) for row in app_logs]

        return table_data

    def _model_to_dict(self, model: Any) -> dict[str, Any]:
        """Convert a SQLAlchemy model to a dictionary."""
        result = {}
        for column in model.__table__.columns:
            attr_name = column.key
            value = getattr(model, attr_name, None)
            if value is None and attr_name == "type" and hasattr(model, "type_"):
                value = model.type_
            if isinstance(value, datetime):
                value = value.isoformat()
            result[attr_name] = value
        return result

    def _get_workflow_run_repo(self) -> APIWorkflowRunRepository:
        if self.workflow_run_repo is not None:
            return self.workflow_run_repo

        self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
            sessionmaker(bind=db.engine, expire_on_commit=False)
        )
        return self.workflow_run_repo
