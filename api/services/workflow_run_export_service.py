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

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageNotConfiguredError,
    build_workflow_run_prefix,
    get_archive_storage,
)
from models.trigger import WorkflowTriggerLog
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)

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
        "workflow_node_executions",
        "workflow_node_execution_offload",
        "workflow_pauses",
        "workflow_pause_reasons",
        "workflow_trigger_logs",
    ]

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

        with session_maker() as session:
            run = session.get(WorkflowRun, run_id)

            if not run:
                raise WorkflowRunExportError(f"Workflow run {run_id} not found")

            if run.tenant_id != tenant_id:
                raise WorkflowRunExportError(
                    f"Workflow run {run_id} does not belong to tenant {tenant_id}"
                )

            if run.is_archived:
                return self._export_from_r2(run, include_manifest)
            else:
                return self._export_from_db(session, run, include_manifest)

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
                records = self._extract_table_data(session, run.id, table_name)
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
                    "exported_at": datetime.utcnow().isoformat(),
                    "source": "database",
                    "tables": table_stats,
                }
                zf.writestr(
                    "manifest.json",
                    json.dumps(manifest, indent=2),
                )

        zip_buffer.seek(0)
        return zip_buffer.read()

    def _export_from_r2(
        self,
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

            # Download and add each table's data
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

            # Add manifest if requested
            if include_manifest:
                # Update manifest with export info
                manifest["exported_at"] = datetime.utcnow().isoformat()
                manifest["source"] = "archive"
                zf.writestr(
                    "manifest.json",
                    json.dumps(manifest, indent=2),
                )

        zip_buffer.seek(0)
        return zip_buffer.read()

    def _extract_table_data(
        self,
        session: Session,
        run_id: str,
        table_name: str,
    ) -> list[dict[str, Any]]:
        """Extract records from a table for the given workflow run."""
        records: list[dict[str, Any]] = []

        if table_name == "workflow_node_executions":
            stmt = select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.workflow_run_id == run_id
            )
            for row in session.scalars(stmt):
                records.append(self._model_to_dict(row))

        elif table_name == "workflow_node_execution_offload":
            node_exec_stmt = select(WorkflowNodeExecutionModel.id).where(
                WorkflowNodeExecutionModel.workflow_run_id == run_id
            )
            node_exec_ids = list(session.scalars(node_exec_stmt))

            if node_exec_ids:
                stmt = select(WorkflowNodeExecutionOffload).where(
                    WorkflowNodeExecutionOffload.node_execution_id.in_(node_exec_ids)
                )
                for row in session.scalars(stmt):
                    records.append(self._model_to_dict(row))

        elif table_name == "workflow_pauses":
            stmt = select(WorkflowPause).where(WorkflowPause.workflow_run_id == run_id)
            for row in session.scalars(stmt):
                records.append(self._model_to_dict(row))

        elif table_name == "workflow_pause_reasons":
            pause_stmt = select(WorkflowPause.id).where(WorkflowPause.workflow_run_id == run_id)
            pause_ids = list(session.scalars(pause_stmt))

            if pause_ids:
                stmt = select(WorkflowPauseReason).where(
                    WorkflowPauseReason.pause_id.in_(pause_ids)
                )
                for row in session.scalars(stmt):
                    records.append(self._model_to_dict(row))

        elif table_name == "workflow_trigger_logs":
            stmt = select(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id == run_id)
            for row in session.scalars(stmt):
                records.append(self._model_to_dict(row))

        return records

    def _model_to_dict(self, model: Any) -> dict[str, Any]:
        """Convert a SQLAlchemy model to a dictionary."""
        result = {}
        for column in model.__table__.columns:
            attr_name = column.key
            value = getattr(model, attr_name)
            if isinstance(value, datetime):
                value = value.isoformat()
            result[attr_name] = value
        return result
