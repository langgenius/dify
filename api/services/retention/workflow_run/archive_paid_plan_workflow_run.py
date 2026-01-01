"""
Archive Paid Plan Workflow Run Logs Service.

This service archives workflow run logs for paid plan users older than the configured
retention period (default: 90 days) to S3-compatible storage.

Archived tables:
- workflow_node_executions
- workflow_node_execution_offload
- workflow_pauses
- workflow_pause_reasons
- workflow_trigger_logs

The workflow_runs and workflow_app_logs tables are preserved for UI listing.
"""

import datetime
import io
import json
import logging
import tarfile
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import click
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageNotConfiguredError,
    get_archive_storage,
)
from libs.retention_utils import build_workflow_run_prefix
from models.workflow import (
    WorkflowRun,
)
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.billing_service import BillingService

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
        └── archive.v1.0.tar
            ├── manifest.json
            ├── workflow_node_executions.jsonl.gz
            ├── workflow_node_execution_offload.jsonl.gz
            ├── workflow_pauses.jsonl.gz
            ├── workflow_pause_reasons.jsonl.gz
            └── workflow_trigger_logs.jsonl.gz
    """

    ARCHIVE_SCHEMA_VERSION = "1.0"
    ARCHIVE_BUNDLE_NAME = f"archive.v{ARCHIVE_SCHEMA_VERSION}.tar"

    ARCHIVED_TABLES = [
        "workflow_node_executions",
        "workflow_node_execution_offload",
        "workflow_pauses",
        "workflow_pause_reasons",
        "workflow_trigger_logs",
    ]

    def __init__(
        self,
        days: int = 90,
        batch_size: int = 100,
        start_time: datetime.datetime | None = None,
        end_time: datetime.datetime | None = None,
        tenant_ids: Sequence[str] | None = None,
        limit: int | None = None,
        dry_run: bool = False,
        workflow_run_repo: APIWorkflowRunRepository | None = None,
    ):
        """
        Initialize the archiver.

        Args:
            days: Archive runs older than this many days
            batch_size: Number of runs to process per batch
            start_time: Optional start time (inclusive) for archiving
            end_time: Optional end time (exclusive) for archiving
            tenant_ids: Optional tenant IDs for grayscale rollout
            limit: Maximum number of runs to archive (None for unlimited)
            dry_run: If True, only preview without making changes
        """
        self.days = days
        self.batch_size = batch_size
        if start_time or end_time:
            if start_time is None or end_time is None:
                raise ValueError("start_time and end_time must be provided together")
            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=datetime.UTC)
            if end_time.tzinfo is None:
                end_time = end_time.replace(tzinfo=datetime.UTC)
            if start_time >= end_time:
                raise ValueError("start_time must be earlier than end_time")
            self.start_time = start_time
            self.end_time = end_time
        else:
            self.start_time = None
            self.end_time = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=days)
        self.tenant_ids = set(tenant_ids) if tenant_ids else set()
        self.limit = limit
        self.dry_run = dry_run
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
        last_seen: tuple[datetime.datetime, str] | None = None
        archived_count = 0

        while True:
            # Check limit
            if self.limit and archived_count >= self.limit:
                click.echo(click.style(f"Reached limit of {self.limit} runs", fg="yellow"))
                break

            # Fetch batch of runs
            runs = self._get_runs_batch(last_seen)

            if not runs:
                break

            last_seen = (runs[-1].created_at, runs[-1].id)

            # Filter to paid tenants only
            tenant_ids = {run.tenant_id for run in runs}
            paid_tenants = self._filter_paid_tenants(tenant_ids)

            with session_maker() as session:
                for run in runs:
                    summary.total_runs_processed += 1

                    # Skip non-paid tenants
                    if run.tenant_id not in paid_tenants:
                        summary.runs_skipped += 1
                        continue

                    # Skip already archived runs
                    if run.is_archived:
                        summary.runs_skipped += 1
                        continue

                    # Check limit
                    if self.limit and archived_count >= self.limit:
                        break

                    # Archive this run
                    result = self._archive_run(session, storage, run)

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
            start_after=None,
            end_before=self.end_time,
            last_seen=last_seen,
            batch_size=self.batch_size,
            tenant_ids=list(self.tenant_ids) if self.tenant_ids else None,
        )

    def _build_start_message(self) -> str:
        range_desc = f"before {self.end_time.isoformat()}"
        if self.start_time:
            range_desc = f"between {self.start_time.isoformat()} and {self.end_time.isoformat()}"
        return (
            f"{'[DRY RUN] ' if self.dry_run else ''}Starting workflow run archiving "
            f"for runs {range_desc} "
            f"(batch_size={self.batch_size}, tenant_ids={','.join(sorted(self.tenant_ids)) or 'all'})"
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
            table_data = self._extract_data(session, run)

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
                    data = ArchiveStorage.serialize_to_jsonl_gz(records)
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

                # Mark as archived and delete source data
                self._mark_archived(session, run.id)
                deleted_counts = self._delete_archived_data(session, run)
                session.commit()

                logger.info(
                    "Archived workflow run %s: tables=%s, deleted=%s",
                    run.id,
                    {s.table_name: s.row_count for s in table_stats},
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

    def _extract_data(self, session: Session, run: WorkflowRun) -> dict[str, list[dict[str, Any]]]:
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
        table_data["workflow_node_executions"] = [row.to_dict() for row in node_exec_records]
        table_data["workflow_node_execution_offload"] = [row.to_dict() for row in offload_records]
        repo = self._get_workflow_run_repo()
        pause_records = repo.get_pause_records_by_run_id(session, run.id)
        pause_ids = [pause.id for pause in pause_records]
        pause_reason_records = repo.get_pause_reason_records_by_run_id(
            session,
            pause_ids,
        )
        table_data["workflow_pauses"] = [row.to_dict() for row in pause_records]
        table_data["workflow_pause_reasons"] = [row.to_dict() for row in pause_reason_records]
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        trigger_records = trigger_repo.list_by_run_id(run.id)
        table_data["workflow_trigger_logs"] = [row.to_dict() for row in trigger_records]
        return table_data

    def _get_archive_key(self, run: WorkflowRun, *, bundle_name: str | None = None) -> str:
        """Get the storage key for the archive bundle."""
        prefix = build_workflow_run_prefix(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            created_at=run.created_at,
            run_id=run.id,
        )
        bundle = bundle_name or self.ARCHIVE_BUNDLE_NAME
        return f"{prefix}/{bundle}"

    @staticmethod
    def _get_table_member_path(table_name: str) -> str:
        """Get the archive bundle path for a table data file."""
        return f"{table_name}.jsonl.gz"

    def _generate_manifest(
        self,
        run: WorkflowRun,
        table_stats: list[TableStats],
    ) -> dict[str, Any]:
        """Generate a manifest for the archived workflow run."""
        return {
            "schema_version": self.ARCHIVE_SCHEMA_VERSION,
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

    @staticmethod
    def _add_tar_member(tar: tarfile.TarFile, name: str, data: bytes) -> None:
        info = tarfile.TarInfo(name)
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))

    def _build_archive_bundle(self, manifest_data: bytes, table_payloads: dict[str, bytes]) -> bytes:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            self._add_tar_member(tar, "manifest.json", manifest_data)
            for table_name in self.ARCHIVED_TABLES:
                data = table_payloads.get(table_name)
                if data is None:
                    raise ValueError(f"Missing archive payload for {table_name}")
                member_path = self._get_table_member_path(table_name)
                self._add_tar_member(tar, member_path, data)
        return buffer.getvalue()

    def _mark_archived(self, session: Session, run_id: str) -> None:
        """Mark a workflow run as archived."""
        repo = self._get_workflow_run_repo()
        repo.set_runs_archived(session, [run_id], archived=True)

    def _delete_archived_data(self, session: Session, run: WorkflowRun) -> dict[str, int]:
        """Delete archived data from the 5 tables."""
        repo = self._get_workflow_run_repo()
        return repo.delete_archived_run_related_data(
            session,
            [run],
            delete_node_executions=self._delete_node_executions,
            delete_trigger_logs=self._delete_trigger_logs,
        )

    def _delete_trigger_logs(self, session: Session, run_ids: Sequence[str]) -> int:
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        return trigger_repo.delete_by_run_ids(run_ids)

    def _delete_node_executions(self, session: Session, runs: Sequence[WorkflowRun]) -> tuple[int, int]:
        run_contexts: list[DifyAPISQLAlchemyWorkflowNodeExecutionRepository.RunContext] = [
            {
                "run_id": run.id,
                "tenant_id": run.tenant_id,
                "app_id": run.app_id,
                "workflow_id": run.workflow_id,
                "triggered_from": run.triggered_from,
            }
            for run in runs
        ]
        return DifyAPISQLAlchemyWorkflowNodeExecutionRepository.delete_by_runs(session, run_contexts)

    def _get_workflow_run_repo(self) -> APIWorkflowRunRepository:
        if self.workflow_run_repo is not None:
            return self.workflow_run_repo

        from repositories.factory import DifyAPIRepositoryFactory

        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
        return self.workflow_run_repo
