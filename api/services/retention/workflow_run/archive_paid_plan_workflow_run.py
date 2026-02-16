"""
Archive Paid Plan Workflow Run Logs Service.

This service archives workflow run logs for paid plan users older than the configured
retention period (default: 90 days) to S3-compatible storage.

Archived tables:
- workflow_runs
- workflow_app_logs
- workflow_node_executions
- workflow_node_execution_offload
- workflow_pauses
- workflow_pause_reasons
- workflow_trigger_logs

"""

import datetime
import io
import json
import logging
import time
import zipfile
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import click
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.workflow.enums import WorkflowType
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageNotConfiguredError,
    get_archive_storage,
)
from models.workflow import WorkflowAppLog, WorkflowRun
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.billing_service import BillingService
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_NAME, ARCHIVE_SCHEMA_VERSION

logger = logging.getLogger(__name__)


@dataclass
class TableStats:
    """Statistics for a single archived table."""

    table_name: str
    row_count: int
    checksum: str
    size_bytes: int


@dataclass
class ArchiveResult:
    """Result of archiving a single workflow run."""

    run_id: str
    tenant_id: str
    success: bool
    tables: list[TableStats] = field(default_factory=list)
    error: str | None = None
    elapsed_time: float = 0.0


@dataclass
class ArchiveSummary:
    """Summary of the entire archive operation."""

    total_runs_processed: int = 0
    runs_archived: int = 0
    runs_skipped: int = 0
    runs_failed: int = 0
    total_elapsed_time: float = 0.0


class WorkflowRunArchiver:
    """
    Archive workflow run logs for paid plan users.

    Storage Layout:
    {tenant_id}/app_id={app_id}/year={YYYY}/month={MM}/workflow_run_id={run_id}/
        └── archive.v1.0.zip
            ├── manifest.json
            ├── workflow_runs.jsonl
            ├── workflow_app_logs.jsonl
            ├── workflow_node_executions.jsonl
            ├── workflow_node_execution_offload.jsonl
            ├── workflow_pauses.jsonl
            ├── workflow_pause_reasons.jsonl
            └── workflow_trigger_logs.jsonl
    """

    ARCHIVED_TYPE = [
        WorkflowType.WORKFLOW,
        WorkflowType.RAG_PIPELINE,
    ]
    ARCHIVED_TABLES = [
        "workflow_runs",
        "workflow_app_logs",
        "workflow_node_executions",
        "workflow_node_execution_offload",
        "workflow_pauses",
        "workflow_pause_reasons",
        "workflow_trigger_logs",
    ]

    start_from: datetime.datetime | None
    end_before: datetime.datetime

    def __init__(
        self,
        days: int = 90,
        batch_size: int = 100,
        start_from: datetime.datetime | None = None,
        end_before: datetime.datetime | None = None,
        workers: int = 1,
        tenant_ids: Sequence[str] | None = None,
        limit: int | None = None,
        dry_run: bool = False,
        delete_after_archive: bool = False,
        workflow_run_repo: APIWorkflowRunRepository | None = None,
    ):
        """
        Initialize the archiver.

        Args:
            days: Archive runs older than this many days
            batch_size: Number of runs to process per batch
            start_from: Optional start time (inclusive) for archiving
            end_before: Optional end time (exclusive) for archiving
            workers: Number of concurrent workflow runs to archive
            tenant_ids: Optional tenant IDs for grayscale rollout
            limit: Maximum number of runs to archive (None for unlimited)
            dry_run: If True, only preview without making changes
            delete_after_archive: If True, delete runs and related data after archiving
        """
        self.days = days
        self.batch_size = batch_size
        if start_from or end_before:
            if start_from is None or end_before is None:
                raise ValueError("start_from and end_before must be provided together")
            if start_from >= end_before:
                raise ValueError("start_from must be earlier than end_before")
            self.start_from = start_from.replace(tzinfo=datetime.UTC)
            self.end_before = end_before.replace(tzinfo=datetime.UTC)
        else:
            self.start_from = None
            self.end_before = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=days)
        if workers < 1:
            raise ValueError("workers must be at least 1")
        self.workers = workers
        self.tenant_ids = sorted(set(tenant_ids)) if tenant_ids else []
        self.limit = limit
        self.dry_run = dry_run
        self.delete_after_archive = delete_after_archive
        self.workflow_run_repo = workflow_run_repo

    def run(self) -> ArchiveSummary:
        """
        Main archiving loop.

        Returns:
            ArchiveSummary with statistics about the operation
        """
        summary = ArchiveSummary()
        start_time = time.time()

        click.echo(
            click.style(
                self._build_start_message(),
                fg="white",
            )
        )

        # Initialize archive storage (will raise if not configured)
        try:
            if not self.dry_run:
                storage = get_archive_storage()
            else:
                storage = None
        except ArchiveStorageNotConfiguredError as e:
            click.echo(click.style(f"Archive storage not configured: {e}", fg="red"))
            return summary

        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        repo = self._get_workflow_run_repo()

        def _archive_with_session(run: WorkflowRun) -> ArchiveResult:
            with session_maker() as session:
                return self._archive_run(session, storage, run)

        last_seen: tuple[datetime.datetime, str] | None = None
        archived_count = 0

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            while True:
                # Check limit
                if self.limit and archived_count >= self.limit:
                    click.echo(click.style(f"Reached limit of {self.limit} runs", fg="yellow"))
                    break

                # Fetch batch of runs
                runs = self._get_runs_batch(last_seen)

                if not runs:
                    break

                run_ids = [run.id for run in runs]
                with session_maker() as session:
                    archived_run_ids = repo.get_archived_run_ids(session, run_ids)

                last_seen = (runs[-1].created_at, runs[-1].id)

                # Filter to paid tenants only
                tenant_ids = {run.tenant_id for run in runs}
                paid_tenants = self._filter_paid_tenants(tenant_ids)

                runs_to_process: list[WorkflowRun] = []
                for run in runs:
                    summary.total_runs_processed += 1

                    # Skip non-paid tenants
                    if run.tenant_id not in paid_tenants:
                        summary.runs_skipped += 1
                        continue

                    # Skip already archived runs
                    if run.id in archived_run_ids:
                        summary.runs_skipped += 1
                        continue

                    # Check limit
                    if self.limit and archived_count + len(runs_to_process) >= self.limit:
                        break

                    runs_to_process.append(run)

                if not runs_to_process:
                    continue

                results = list(executor.map(_archive_with_session, runs_to_process))

                for run, result in zip(runs_to_process, results):
                    if result.success:
                        summary.runs_archived += 1
                        archived_count += 1
                        click.echo(
                            click.style(
                                f"{'[DRY RUN] Would archive' if self.dry_run else 'Archived'} "
                                f"run {run.id} (tenant={run.tenant_id}, "
                                f"tables={len(result.tables)}, time={result.elapsed_time:.2f}s)",
                                fg="green",
                            )
                        )
                    else:
                        summary.runs_failed += 1
                        click.echo(
                            click.style(
                                f"Failed to archive run {run.id}: {result.error}",
                                fg="red",
                            )
                        )

        summary.total_elapsed_time = time.time() - start_time
        click.echo(
            click.style(
                f"{'[DRY RUN] ' if self.dry_run else ''}Archive complete: "
                f"processed={summary.total_runs_processed}, archived={summary.runs_archived}, "
                f"skipped={summary.runs_skipped}, failed={summary.runs_failed}, "
                f"time={summary.total_elapsed_time:.2f}s",
                fg="white",
            )
        )

        return summary

    def _get_runs_batch(
        self,
        last_seen: tuple[datetime.datetime, str] | None,
    ) -> Sequence[WorkflowRun]:
        """Fetch a batch of workflow runs to archive."""
        repo = self._get_workflow_run_repo()
        return repo.get_runs_batch_by_time_range(
            start_from=self.start_from,
            end_before=self.end_before,
            last_seen=last_seen,
            batch_size=self.batch_size,
            run_types=self.ARCHIVED_TYPE,
            tenant_ids=self.tenant_ids or None,
        )

    def _build_start_message(self) -> str:
        range_desc = f"before {self.end_before.isoformat()}"
        if self.start_from:
            range_desc = f"between {self.start_from.isoformat()} and {self.end_before.isoformat()}"
        return (
            f"{'[DRY RUN] ' if self.dry_run else ''}Starting workflow run archiving "
            f"for runs {range_desc} "
            f"(batch_size={self.batch_size}, tenant_ids={','.join(self.tenant_ids) or 'all'})"
        )

    def _filter_paid_tenants(self, tenant_ids: set[str]) -> set[str]:
        """Filter tenant IDs to only include paid tenants."""
        if not dify_config.BILLING_ENABLED:
            # If billing is not enabled, treat all tenants as paid
            return tenant_ids

        if not tenant_ids:
            return set()

        try:
            bulk_info = BillingService.get_plan_bulk_with_cache(list(tenant_ids))
        except Exception:
            logger.exception("Failed to fetch billing plans for tenants")
            # On error, skip all tenants in this batch
            return set()

        # Filter to paid tenants (any plan except SANDBOX)
        paid = set()
        for tid, info in bulk_info.items():
            if info and info.get("plan") in (CloudPlan.PROFESSIONAL, CloudPlan.TEAM):
                paid.add(tid)

        return paid

    def _archive_run(
        self,
        session: Session,
        storage: ArchiveStorage | None,
        run: WorkflowRun,
    ) -> ArchiveResult:
        """Archive a single workflow run."""
        start_time = time.time()
        result = ArchiveResult(run_id=run.id, tenant_id=run.tenant_id, success=False)

        try:
            # Extract data from all tables
            table_data, app_logs, trigger_metadata = self._extract_data(session, run)

            if self.dry_run:
                # In dry run, just report what would be archived
                for table_name in self.ARCHIVED_TABLES:
                    records = table_data.get(table_name, [])
                    result.tables.append(
                        TableStats(
                            table_name=table_name,
                            row_count=len(records),
                            checksum="",
                            size_bytes=0,
                        )
                    )
                result.success = True
            else:
                if storage is None:
                    raise ArchiveStorageNotConfiguredError("Archive storage not configured")
                archive_key = self._get_archive_key(run)

                # Serialize tables for the archive bundle
                table_stats: list[TableStats] = []
                table_payloads: dict[str, bytes] = {}
                for table_name in self.ARCHIVED_TABLES:
                    records = table_data.get(table_name, [])
                    data = ArchiveStorage.serialize_to_jsonl(records)
                    table_payloads[table_name] = data
                    checksum = ArchiveStorage.compute_checksum(data)

                    table_stats.append(
                        TableStats(
                            table_name=table_name,
                            row_count=len(records),
                            checksum=checksum,
                            size_bytes=len(data),
                        )
                    )

                # Generate and upload archive bundle
                manifest = self._generate_manifest(run, table_stats)
                manifest_data = json.dumps(manifest, indent=2, default=str).encode("utf-8")
                archive_data = self._build_archive_bundle(manifest_data, table_payloads)
                storage.put_object(archive_key, archive_data)

                repo = self._get_workflow_run_repo()
                archived_log_count = repo.create_archive_logs(session, run, app_logs, trigger_metadata)
                session.commit()

                deleted_counts = None
                if self.delete_after_archive:
                    deleted_counts = repo.delete_runs_with_related(
                        [run],
                        delete_node_executions=self._delete_node_executions,
                        delete_trigger_logs=self._delete_trigger_logs,
                    )

                logger.info(
                    "Archived workflow run %s: tables=%s, archived_logs=%s, deleted=%s",
                    run.id,
                    {s.table_name: s.row_count for s in table_stats},
                    archived_log_count,
                    deleted_counts,
                )

                result.tables = table_stats
                result.success = True

        except Exception as e:
            logger.exception("Failed to archive workflow run %s", run.id)
            result.error = str(e)
            session.rollback()

        result.elapsed_time = time.time() - start_time
        return result

    def _extract_data(
        self,
        session: Session,
        run: WorkflowRun,
    ) -> tuple[dict[str, list[dict[str, Any]]], Sequence[WorkflowAppLog], str | None]:
        table_data: dict[str, list[dict[str, Any]]] = {}
        table_data["workflow_runs"] = [self._row_to_dict(run)]
        repo = self._get_workflow_run_repo()
        app_logs = repo.get_app_logs_by_run_id(session, run.id)
        table_data["workflow_app_logs"] = [self._row_to_dict(row) for row in app_logs]
        node_exec_repo = self._get_workflow_node_execution_repo(session)
        node_exec_records = node_exec_repo.get_executions_by_workflow_run(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            workflow_run_id=run.id,
        )
        node_exec_ids = [record.id for record in node_exec_records]
        offload_records = node_exec_repo.get_offloads_by_execution_ids(session, node_exec_ids)
        table_data["workflow_node_executions"] = [self._row_to_dict(row) for row in node_exec_records]
        table_data["workflow_node_execution_offload"] = [self._row_to_dict(row) for row in offload_records]
        repo = self._get_workflow_run_repo()
        pause_records = repo.get_pause_records_by_run_id(session, run.id)
        pause_ids = [pause.id for pause in pause_records]
        pause_reason_records = repo.get_pause_reason_records_by_run_id(
            session,
            pause_ids,
        )
        table_data["workflow_pauses"] = [self._row_to_dict(row) for row in pause_records]
        table_data["workflow_pause_reasons"] = [self._row_to_dict(row) for row in pause_reason_records]
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        trigger_records = trigger_repo.list_by_run_id(run.id)
        table_data["workflow_trigger_logs"] = [self._row_to_dict(row) for row in trigger_records]
        trigger_metadata = trigger_records[0].trigger_metadata if trigger_records else None
        return table_data, app_logs, trigger_metadata

    @staticmethod
    def _row_to_dict(row: Any) -> dict[str, Any]:
        mapper = inspect(row).mapper
        return {str(column.name): getattr(row, mapper.get_property_by_column(column).key) for column in mapper.columns}

    def _get_archive_key(self, run: WorkflowRun) -> str:
        """Get the storage key for the archive bundle."""
        created_at = run.created_at
        prefix = (
            f"{run.tenant_id}/app_id={run.app_id}/year={created_at.strftime('%Y')}/"
            f"month={created_at.strftime('%m')}/workflow_run_id={run.id}"
        )
        return f"{prefix}/{ARCHIVE_BUNDLE_NAME}"

    def _generate_manifest(
        self,
        run: WorkflowRun,
        table_stats: list[TableStats],
    ) -> dict[str, Any]:
        """Generate a manifest for the archived workflow run."""
        return {
            "schema_version": ARCHIVE_SCHEMA_VERSION,
            "workflow_run_id": run.id,
            "tenant_id": run.tenant_id,
            "app_id": run.app_id,
            "workflow_id": run.workflow_id,
            "created_at": run.created_at.isoformat(),
            "archived_at": datetime.datetime.now(datetime.UTC).isoformat(),
            "tables": {
                stat.table_name: {
                    "row_count": stat.row_count,
                    "checksum": stat.checksum,
                    "size_bytes": stat.size_bytes,
                }
                for stat in table_stats
            },
        }

    def _build_archive_bundle(self, manifest_data: bytes, table_payloads: dict[str, bytes]) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", manifest_data)
            for table_name in self.ARCHIVED_TABLES:
                data = table_payloads.get(table_name)
                if data is None:
                    raise ValueError(f"Missing archive payload for {table_name}")
                archive.writestr(f"{table_name}.jsonl", data)
        return buffer.getvalue()

    def _delete_trigger_logs(self, session: Session, run_ids: Sequence[str]) -> int:
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        return trigger_repo.delete_by_run_ids(run_ids)

    def _delete_node_executions(self, session: Session, runs: Sequence[WorkflowRun]) -> tuple[int, int]:
        run_ids = [run.id for run in runs]
        return self._get_workflow_node_execution_repo(session).delete_by_runs(session, run_ids)

    def _get_workflow_node_execution_repo(
        self,
        session: Session,
    ) -> DifyAPIWorkflowNodeExecutionRepository:
        from repositories.factory import DifyAPIRepositoryFactory

        session_maker = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        return DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(session_maker)

    def _get_workflow_run_repo(self) -> APIWorkflowRunRepository:
        if self.workflow_run_repo is not None:
            return self.workflow_run_repo

        from repositories.factory import DifyAPIRepositoryFactory

        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
        return self.workflow_run_repo
