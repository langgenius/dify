"""
Restore Archived Workflow Run Service.

This service restores archived workflow run data from S3-compatible storage
back to the database.
"""

import io
import json
import logging
import time
import zipfile
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
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
from models.trigger import WorkflowTriggerLog
from models.workflow import (
    WorkflowAppLog,
    WorkflowArchiveLog,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_NAME

logger = logging.getLogger(__name__)


# Mapping of table names to SQLAlchemy models
TABLE_MODELS = {
    "workflow_runs": WorkflowRun,
    "workflow_app_logs": WorkflowAppLog,
    "workflow_node_executions": WorkflowNodeExecutionModel,
    "workflow_node_execution_offload": WorkflowNodeExecutionOffload,
    "workflow_pauses": WorkflowPause,
    "workflow_pause_reasons": WorkflowPauseReason,
    "workflow_trigger_logs": WorkflowTriggerLog,
}

SchemaMapper = Callable[[dict[str, Any]], dict[str, Any]]

SCHEMA_MAPPERS: dict[str, dict[str, SchemaMapper]] = {
    "1.0": {},
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

    def __init__(self, dry_run: bool = False, workers: int = 1):
        """
        Initialize the restore service.

        Args:
            dry_run: If True, only preview without making changes
            workers: Number of concurrent workflow runs to restore
        """
        self.dry_run = dry_run
        if workers < 1:
            raise ValueError("workers must be at least 1")
        self.workers = workers
        self.workflow_run_repo: APIWorkflowRunRepository | None = None

    def _restore_from_run(
        self,
        run: WorkflowRun | WorkflowArchiveLog,
        *,
        session_maker: sessionmaker,
    ) -> RestoreResult:
        start_time = time.time()
        run_id = run.workflow_run_id if isinstance(run, WorkflowArchiveLog) else run.id
        created_at = run.run_created_at if isinstance(run, WorkflowArchiveLog) else run.created_at
        result = RestoreResult(
            run_id=run_id,
            tenant_id=run.tenant_id,
            success=False,
            restored_counts={},
        )

        if not self.dry_run:
            click.echo(
                click.style(
                    f"Starting restore for workflow run {run_id} (tenant={run.tenant_id})",
                    fg="white",
                )
            )

        try:
            storage = get_archive_storage()
        except ArchiveStorageNotConfiguredError as e:
            result.error = str(e)
            click.echo(click.style(f"Archive storage not configured: {e}", fg="red"))
            result.elapsed_time = time.time() - start_time
            return result

        prefix = (
            f"{run.tenant_id}/app_id={run.app_id}/year={created_at.strftime('%Y')}/"
            f"month={created_at.strftime('%m')}/workflow_run_id={run_id}"
        )
        archive_key = f"{prefix}/{ARCHIVE_BUNDLE_NAME}"
        try:
            archive_data = storage.get_object(archive_key)
        except FileNotFoundError:
            result.error = f"Archive bundle not found: {archive_key}"
            click.echo(click.style(result.error, fg="red"))
            result.elapsed_time = time.time() - start_time
            return result

        with session_maker() as session:
            try:
                with zipfile.ZipFile(io.BytesIO(archive_data), mode="r") as archive:
                    try:
                        manifest = self._load_manifest_from_zip(archive)
                    except ValueError as e:
                        result.error = f"Archive bundle invalid: {e}"
                        click.echo(click.style(result.error, fg="red"))
                        return result

                    tables = manifest.get("tables", {})
                    schema_version = self._get_schema_version(manifest)
                    for table_name, info in tables.items():
                        row_count = info.get("row_count", 0)
                        if row_count == 0:
                            result.restored_counts[table_name] = 0
                            continue

                        if self.dry_run:
                            result.restored_counts[table_name] = row_count
                            continue

                        member_path = f"{table_name}.jsonl"
                        try:
                            data = archive.read(member_path)
                        except KeyError:
                            click.echo(
                                click.style(
                                    f"  Warning: Table data not found in archive: {member_path}",
                                    fg="yellow",
                                )
                            )
                            result.restored_counts[table_name] = 0
                            continue

                        records = ArchiveStorage.deserialize_from_jsonl(data)
                        restored = self._restore_table_records(
                            session,
                            table_name,
                            records,
                            schema_version=schema_version,
                        )
                        result.restored_counts[table_name] = restored
                        if not self.dry_run:
                            click.echo(
                                click.style(
                                    f"  Restored {restored}/{len(records)} records to {table_name}",
                                    fg="white",
                                )
                            )

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

                    # Delete the archive log record after successful restore
                    repo = self._get_workflow_run_repo()
                    repo.delete_archive_log_by_run_id(session, run_id)

                    session.commit()

                result.success = True
                if not self.dry_run:
                    click.echo(
                        click.style(
                            f"Completed restore for workflow run {run_id}: restored={result.restored_counts}",
                            fg="green",
                        )
                    )

            except Exception as e:
                logger.exception("Failed to restore workflow run %s", run_id)
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

    @staticmethod
    def _load_manifest_from_zip(archive: zipfile.ZipFile) -> dict[str, Any]:
        try:
            data = archive.read("manifest.json")
        except KeyError as e:
            raise ValueError("manifest.json missing from archive bundle") from e
        return json.loads(data.decode("utf-8"))

    def _restore_table_records(
        self,
        session: Session,
        table_name: str,
        records: list[dict[str, Any]],
        *,
        schema_version: str,
    ) -> int:
        """
        Restore records to a table.

        Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.

        Args:
            session: Database session
            table_name: Name of the table
            records: List of record dictionaries
            schema_version: Archived schema version from manifest

        Returns:
            Number of records actually inserted
        """
        if not records:
            return 0

        model = TABLE_MODELS.get(table_name)
        if not model:
            logger.warning("Unknown table: %s", table_name)
            return 0

        column_names, required_columns, non_nullable_with_default = self._get_model_column_info(model)
        unknown_fields: set[str] = set()

        # Apply schema mapping, filter to current columns, then convert datetimes
        converted_records = []
        for record in records:
            mapped = self._apply_schema_mapping(table_name, schema_version, record)
            unknown_fields.update(set(mapped.keys()) - column_names)
            filtered = {key: value for key, value in mapped.items() if key in column_names}
            for key in non_nullable_with_default:
                if key in filtered and filtered[key] is None:
                    filtered.pop(key)
            missing_required = [key for key in required_columns if key not in filtered or filtered.get(key) is None]
            if missing_required:
                missing_cols = ", ".join(sorted(missing_required))
                raise ValueError(
                    f"Missing required columns for {table_name} (schema_version={schema_version}): {missing_cols}"
                )
            converted = self._convert_datetime_fields(filtered, model)
            converted_records.append(converted)
        if unknown_fields:
            logger.warning(
                "Dropped unknown columns for %s (schema_version=%s): %s",
                table_name,
                schema_version,
                ", ".join(sorted(unknown_fields)),
            )

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

    def _get_schema_version(self, manifest: dict[str, Any]) -> str:
        schema_version = manifest.get("schema_version")
        if not schema_version:
            logger.warning("Manifest missing schema_version; defaulting to 1.0")
            schema_version = "1.0"
        schema_version = str(schema_version)
        if schema_version not in SCHEMA_MAPPERS:
            raise ValueError(f"Unsupported schema_version {schema_version}. Add a mapping before restoring.")
        return schema_version

    def _apply_schema_mapping(
        self,
        table_name: str,
        schema_version: str,
        record: dict[str, Any],
    ) -> dict[str, Any]:
        # Keep hook for forward/backward compatibility when schema evolves.
        mapper = SCHEMA_MAPPERS.get(schema_version, {}).get(table_name)
        if mapper is None:
            return dict(record)
        return mapper(record)

    def _get_model_column_info(
        self,
        model: type[DeclarativeBase] | Any,
    ) -> tuple[set[str], set[str], set[str]]:
        columns = list(model.__table__.columns)
        column_names = {column.key for column in columns}
        required_columns = {
            column.key
            for column in columns
            if not column.nullable
            and column.default is None
            and column.server_default is None
            and not column.autoincrement
        }
        non_nullable_with_default = {
            column.key
            for column in columns
            if not column.nullable
            and (column.default is not None or column.server_default is not None or column.autoincrement)
        }
        return column_names, required_columns, non_nullable_with_default

    def restore_batch(
        self,
        tenant_ids: list[str] | None,
        start_date: datetime,
        end_date: datetime,
        limit: int = 100,
    ) -> list[RestoreResult]:
        """
        Restore multiple workflow runs by time range.

        Args:
            tenant_ids: Optional tenant IDs
            start_date: Start date filter
            end_date: End date filter
            limit: Maximum number of runs to restore (default: 100)

        Returns:
            List of RestoreResult objects
        """
        results: list[RestoreResult] = []
        if tenant_ids is not None and not tenant_ids:
            return results
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        repo = self._get_workflow_run_repo()

        with session_maker() as session:
            archive_logs = repo.get_archived_logs_by_time_range(
                session=session,
                tenant_ids=tenant_ids,
                start_date=start_date,
                end_date=end_date,
                limit=limit,
            )

        click.echo(
            click.style(
                f"Found {len(archive_logs)} archived workflow runs to restore",
                fg="white",
            )
        )

        def _restore_with_session(archive_log: WorkflowArchiveLog) -> RestoreResult:
            return self._restore_from_run(
                archive_log,
                session_maker=session_maker,
            )

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            results = list(executor.map(_restore_with_session, archive_logs))

        total_counts: dict[str, int] = {}
        for result in results:
            for table_name, count in result.restored_counts.items():
                total_counts[table_name] = total_counts.get(table_name, 0) + count
        success_count = sum(1 for result in results if result.success)

        if self.dry_run:
            click.echo(
                click.style(
                    f"[DRY RUN] Would restore {len(results)} workflow runs: totals={total_counts}",
                    fg="yellow",
                )
            )
        else:
            click.echo(
                click.style(
                    f"Restored {success_count}/{len(results)} workflow runs: totals={total_counts}",
                    fg="green",
                )
            )

        return results

    def restore_by_run_id(
        self,
        run_id: str,
    ) -> RestoreResult:
        """
        Restore a single workflow run by run ID.
        """
        repo = self._get_workflow_run_repo()
        archive_log = repo.get_archived_log_by_run_id(run_id)

        if not archive_log:
            click.echo(click.style(f"Workflow run archive {run_id} not found", fg="red"))
            return RestoreResult(
                run_id=run_id,
                tenant_id="",
                success=False,
                restored_counts={},
                error=f"Workflow run archive {run_id} not found",
            )

        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        result = self._restore_from_run(archive_log, session_maker=session_maker)
        if self.dry_run and result.success:
            click.echo(
                click.style(
                    f"[DRY RUN] Would restore workflow run {run_id}: totals={result.restored_counts}",
                    fg="yellow",
                )
            )
        return result
