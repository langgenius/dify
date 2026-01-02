"""
Restore Archived Workflow Run Service.

This service restores archived workflow run data from S3-compatible storage
back to the database.
"""

import io
import json
import logging
import tarfile
import time
from collections.abc import Callable
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

    ARCHIVE_SCHEMA_VERSION = "1.0"
    ARCHIVE_BUNDLE_NAME = f"archive.v{ARCHIVE_SCHEMA_VERSION}.tar"

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
                archive_key = self._get_archive_key(prefix)
                try:
                    archive_data = storage.get_object(archive_key)
                except FileNotFoundError:
                    result.error = f"Archive bundle not found: {archive_key}"
                    click.echo(click.style(result.error, fg="red"))
                    return result

                with tarfile.open(fileobj=io.BytesIO(archive_data), mode="r") as tar:
                    try:
                        manifest = self._load_manifest_from_tar(tar)
                    except ValueError as e:
                        result.error = f"Archive bundle invalid: {e}"
                        click.echo(click.style(result.error, fg="red"))
                        return result

                    tables = manifest.get("tables", {})
                    schema_version = self._resolve_schema_version(manifest)
                    self._validate_schema_version(schema_version)
                    for table_name, info in tables.items():
                        row_count = info.get("row_count", 0)
                        if row_count == 0:
                            result.restored_counts[table_name] = 0
                            continue

                        if self.dry_run:
                            click.echo(
                                click.style(
                                    f"  [DRY RUN] Would restore {row_count} records to {table_name}",
                                    fg="yellow",
                                )
                            )
                            result.restored_counts[table_name] = row_count
                            continue

                        member_path = self._get_table_member_path(table_name)
                        try:
                            fileobj = tar.extractfile(member_path)
                        except KeyError:
                            click.echo(
                                click.style(
                                    f"  Warning: Table data not found in archive: {member_path}",
                                    fg="yellow",
                                )
                            )
                            result.restored_counts[table_name] = 0
                            continue
                        if fileobj is None:
                            click.echo(
                                click.style(
                                    f"  Warning: Table data not found in archive: {member_path}",
                                    fg="yellow",
                                )
                            )
                            result.restored_counts[table_name] = 0
                            continue

                        data = fileobj.read()
                        records = ArchiveStorage.deserialize_from_jsonl_gz(data)
                        restored = self._restore_table_records(
                            session,
                            table_name,
                            records,
                            schema_version=schema_version,
                        )
                        result.restored_counts[table_name] = restored
                        click.echo(
                            click.style(
                                f"  Restored {restored}/{len(records)} records to {table_name}",
                                fg="green",
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

    def _get_archive_key(self, prefix: str, *, bundle_name: str | None = None) -> str:
        bundle = bundle_name or self.ARCHIVE_BUNDLE_NAME
        return f"{prefix}/{bundle}"

    @staticmethod
    def _get_table_member_path(table_name: str) -> str:
        return f"{table_name}.jsonl.gz"

    @staticmethod
    def _load_manifest_from_tar(tar: tarfile.TarFile) -> dict[str, Any]:
        try:
            fileobj = tar.extractfile("manifest.json")
        except KeyError as e:
            raise ValueError("manifest.json missing from archive bundle") from e
        if fileobj is None:
            raise ValueError("manifest.json missing from archive bundle")
        return json.loads(fileobj.read().decode("utf-8"))

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

    def _resolve_schema_version(self, manifest: dict[str, Any]) -> str:
        schema_version = manifest.get("schema_version")
        if not schema_version:
            logger.warning("Manifest missing schema_version; defaulting to 1.0")
            return "1.0"
        return str(schema_version)

    def _validate_schema_version(self, schema_version: str) -> None:
        if schema_version not in SCHEMA_MAPPERS:
            raise ValueError(f"Unsupported schema_version {schema_version}. Add a mapping before restoring.")

    def _apply_schema_mapping(
        self,
        table_name: str,
        schema_version: str,
        record: dict[str, Any],
    ) -> dict[str, Any]:
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
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        limit: int | None = None,
    ) -> list[RestoreResult]:
        """
        Restore multiple workflow runs by time range.

        Args:
            tenant_ids: Optional tenant IDs
            start_date: Optional start date filter
            end_date: Optional end date filter
            limit: Maximum number of runs to restore (default: 100)

        Returns:
            List of RestoreResult objects
        """
        results: list[RestoreResult] = []
        if tenant_ids is not None and not tenant_ids:
            return results
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        repo = self._get_workflow_run_repo()

        effective_limit = limit if limit is not None else 100

        with session_maker() as session:
            runs = repo.get_archived_runs_by_time_range(
                session=session,
                tenant_ids=tenant_ids,
                start_date=start_date,
                end_date=end_date,
                limit=effective_limit,
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

    def restore_by_run_id(
        self,
        run_id: str,
    ) -> RestoreResult:
        """
        Restore a single workflow run by run ID.
        """
        repo = self._get_workflow_run_repo()
        run = repo.get_workflow_run_by_id_without_tenant(run_id)

        if not run:
            click.echo(click.style(f"Workflow run {run_id} not found", fg="red"))
            return RestoreResult(
                run_id=run_id,
                tenant_id="",
                success=False,
                restored_counts={},
                error=f"Workflow run {run_id} not found",
            )

        return self.restore(tenant_id=run.tenant_id, workflow_run_id=run_id)
