"""
Restore Archived Workflow Run Service.

This service restores archived workflow run data from S3-compatible storage
back to the database.
"""

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

import click
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from extensions.ext_database import db
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageNotConfiguredError,
    get_archive_storage,
)
from libs.retention_utils import build_workflow_run_prefix
from models.trigger import WorkflowTriggerLog
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
)
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory

logger = logging.getLogger(__name__)


# Mapping of table names to SQLAlchemy models
TABLE_MODELS = {
    "workflow_node_executions": WorkflowNodeExecutionModel,
    "workflow_node_execution_offload": WorkflowNodeExecutionOffload,
    "workflow_pauses": WorkflowPause,
    "workflow_pause_reasons": WorkflowPauseReason,
    "workflow_trigger_logs": WorkflowTriggerLog,
}


@dataclass
class RestoreResult:
    """Result of restoring a single workflow run."""

    run_id: str
    tenant_id: str
    success: bool
    restored_counts: dict[str, int]
    error: str | None = None
    elapsed_time: float = 0.0


class WorkflowRunRestore:
    """
    Restore archived workflow run data from storage to database.

    This service reads archived data from storage and restores it to the
    database tables. It handles idempotency by skipping records that already
    exist in the database.
    """

    def __init__(self, dry_run: bool = False):
        """
        Initialize the restore service.

        Args:
            dry_run: If True, only preview without making changes
        """
        self.dry_run = dry_run
        self.workflow_run_repo: APIWorkflowRunRepository | None = None

    def restore(
        self,
        tenant_id: str,
        workflow_run_id: str,
    ) -> RestoreResult:
        """
        Restore a single workflow run's archived data.

        Args:
            tenant_id: Tenant ID
            workflow_run_id: Workflow run ID to restore

        Returns:
            RestoreResult with statistics about the operation
        """
        start_time = time.time()
        result = RestoreResult(
            run_id=workflow_run_id,
            tenant_id=tenant_id,
            success=False,
            restored_counts={},
        )

        click.echo(
            click.style(
                f"{'[DRY RUN] ' if self.dry_run else ''}Starting restore for "
                f"workflow run {workflow_run_id} (tenant={tenant_id})",
                fg="white",
            )
        )

        try:
            storage = get_archive_storage()
        except ArchiveStorageNotConfiguredError as e:
            result.error = str(e)
            click.echo(click.style(f"Archive storage not configured: {e}", fg="red"))
            return result

        repo = self._get_workflow_run_repo()
        run = repo.get_workflow_run_by_id_without_tenant(workflow_run_id)
        if not run:
            result.error = f"Workflow run {workflow_run_id} not found"
            click.echo(click.style(result.error, fg="red"))
            return result

        if run.tenant_id != tenant_id:
            result.error = f"Workflow run {workflow_run_id} does not belong to tenant {tenant_id}"
            click.echo(click.style(result.error, fg="red"))
            return result

        if not run.is_archived:
            result.error = f"Workflow run {workflow_run_id} is not archived"
            click.echo(click.style(result.error, fg="yellow"))
            return result

        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)

        with session_maker() as session:
            try:
                prefix = build_workflow_run_prefix(
                    tenant_id=run.tenant_id,
                    app_id=run.app_id,
                    created_at=run.created_at,
                    run_id=run.id,
                )
                # Load manifest
                manifest_key = f"{prefix}/manifest.json"
                try:
                    manifest_data = storage.get_object(manifest_key)
                    manifest = json.loads(manifest_data.decode("utf-8"))
                except FileNotFoundError:
                    result.error = f"Manifest not found: {manifest_key}"
                    click.echo(click.style(result.error, fg="red"))
                    return result

                # Restore each table
                tables = manifest.get("tables", {})
                for table_name, info in tables.items():
                    row_count = info.get("row_count", 0)
                    if row_count == 0:
                        result.restored_counts[table_name] = 0
                        continue

                    table_key = f"{prefix}/table={table_name}/data.jsonl.gz"

                    if self.dry_run:
                        click.echo(
                            click.style(
                                f"  [DRY RUN] Would restore {row_count} records to {table_name}",
                                fg="yellow",
                            )
                        )
                        result.restored_counts[table_name] = row_count
                        continue

                    try:
                        data = storage.get_object(table_key)
                        records = ArchiveStorage.deserialize_from_jsonl_gz(data)
                        restored = self._restore_table_records(session, table_name, records)
                        result.restored_counts[table_name] = restored
                        click.echo(
                            click.style(
                                f"  Restored {restored}/{len(records)} records to {table_name}",
                                fg="green",
                            )
                        )
                    except FileNotFoundError:
                        click.echo(
                            click.style(
                                f"  Warning: Table data not found: {table_key}",
                                fg="yellow",
                            )
                        )
                        result.restored_counts[table_name] = 0

                # Verify row counts match manifest
                manifest_total = sum(info.get("row_count", 0) for info in tables.values())
                restored_total = sum(result.restored_counts.values())

                if not self.dry_run:
                    # Note: restored count might be less than manifest count if records already exist
                    logger.info(
                        "Restore verification: manifest_total=%d, restored_total=%d",
                        manifest_total,
                        restored_total,
                    )

                    # Mark as not archived
                    repo.set_runs_archived(session, [run.id], archived=False)
                    session.commit()

                result.success = True
                click.echo(
                    click.style(
                        f"{'[DRY RUN] Would complete' if self.dry_run else 'Completed'} restore for "
                        f"workflow run {workflow_run_id}: restored={result.restored_counts}",
                        fg="green",
                    )
                )

            except Exception as e:
                logger.exception("Failed to restore workflow run %s", workflow_run_id)
                result.error = str(e)
                session.rollback()
                click.echo(click.style(f"Restore failed: {e}", fg="red"))

        result.elapsed_time = time.time() - start_time
        return result

    def _get_workflow_run_repo(self) -> APIWorkflowRunRepository:
        if self.workflow_run_repo is not None:
            return self.workflow_run_repo

        self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
            sessionmaker(bind=db.engine, expire_on_commit=False)
        )
        return self.workflow_run_repo

    def _restore_table_records(
        self,
        session: Session,
        table_name: str,
        records: list[dict[str, Any]],
    ) -> int:
        """
        Restore records to a table.

        Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.

        Args:
            session: Database session
            table_name: Name of the table
            records: List of record dictionaries

        Returns:
            Number of records actually inserted
        """
        if not records:
            return 0

        model = TABLE_MODELS.get(table_name)
        if not model:
            logger.warning("Unknown table: %s", table_name)
            return 0

        # Convert datetime strings back to datetime objects
        converted_records = []
        for record in records:
            converted = self._convert_datetime_fields(record, model)
            converted_records.append(converted)

        # Use INSERT ... ON CONFLICT DO NOTHING for idempotency
        stmt = pg_insert(model).values(converted_records)
        stmt = stmt.on_conflict_do_nothing(index_elements=["id"])

        result = session.execute(stmt)
        return cast(CursorResult, result).rowcount or 0

    def _convert_datetime_fields(
        self,
        record: dict[str, Any],
        model: type[DeclarativeBase] | Any,
    ) -> dict[str, Any]:
        """Convert ISO datetime strings to datetime objects."""
        from sqlalchemy import DateTime

        result = dict(record)

        for column in model.__table__.columns:
            if isinstance(column.type, DateTime):
                value = result.get(column.key)
                if isinstance(value, str):
                    try:
                        result[column.key] = datetime.fromisoformat(value)
                    except ValueError:
                        pass

        return result

    def restore_batch(
        self,
        tenant_id: str,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        limit: int = 100,
    ) -> list[RestoreResult]:
        """
        Restore multiple workflow runs by time range.

        Args:
            tenant_id: Tenant ID
            start_date: Optional start date filter
            end_date: Optional end date filter
            limit: Maximum number of runs to restore

        Returns:
            List of RestoreResult objects
        """
        results = []
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        repo = self._get_workflow_run_repo()

        if start_date is None or end_date is None:
            raise ValueError("start_date and end_date are required for batch restore.")

        with session_maker() as session:
            runs = repo.get_archived_runs_by_time_range(
                session=session,
                tenant_ids=[tenant_id],
                start_date=start_date,
                end_date=end_date,
                limit=limit,
            )

        click.echo(
            click.style(
                f"Found {len(runs)} archived workflow runs to restore",
                fg="white",
            )
        )

        for run in runs:
            result = self.restore(tenant_id=run.tenant_id, workflow_run_id=run.id)
            results.append(result)

        return results
