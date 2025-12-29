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
import json
import logging
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
    build_workflow_run_prefix,
    get_archive_storage,
)
from models.workflow import (
    WorkflowRun,
)
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.billing_service import BillingService, SubscriptionPlan

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
        ├── manifest.json
        ├── table=workflow_node_executions/data.jsonl.gz
        ├── table=workflow_node_execution_offload/data.jsonl.gz
        ├── table=workflow_pauses/data.jsonl.gz
        ├── table=workflow_pause_reasons/data.jsonl.gz
        └── table=workflow_trigger_logs/data.jsonl.gz
    """

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
            tenant_ids: Optional tenant IDs for grayscale rollout
            limit: Maximum number of runs to archive (None for unlimited)
            dry_run: If True, only preview without making changes
        """
        self.days = days
        self.batch_size = batch_size
        self.tenant_ids = set(tenant_ids) if tenant_ids else set()
        self.limit = limit
        self.dry_run = dry_run
        self.cutoff_date = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=days)
        self.billing_cache: dict[str, SubscriptionPlan | None] = {}
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
                f"{'[DRY RUN] ' if self.dry_run else ''}Starting workflow run archiving "
                f"for runs before {self.cutoff_date.isoformat()} "
                f"(batch_size={self.batch_size}, tenant_ids={','.join(sorted(self.tenant_ids)) or 'all'})",
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
            end_before=self.cutoff_date,
            last_seen=last_seen,
            batch_size=self.batch_size,
            tenant_ids=list(self.tenant_ids) if self.tenant_ids else None,
        )

    def _filter_paid_tenants(self, tenant_ids: set[str]) -> set[str]:
        """Filter tenant IDs to only include paid tenants."""
        if not dify_config.BILLING_ENABLED:
            # If billing is not enabled, treat all tenants as paid
            return tenant_ids

        if not tenant_ids:
            return set()

        # Fetch billing info for uncached tenants
        uncached = [tid for tid in tenant_ids if tid not in self.billing_cache]
        if uncached:
            try:
                bulk_info = BillingService.get_plan_bulk(uncached)
                for tid in uncached:
                    self.billing_cache[tid] = bulk_info.get(tid)
            except Exception:
                logger.exception("Failed to fetch billing plans for tenants")
                # On error, skip all tenants in this batch
                return set()

        # Filter to paid tenants (any plan except SANDBOX)
        paid = set()
        for tid in tenant_ids:
            info = self.billing_cache.get(tid)
            if info and info.get("plan") != CloudPlan.SANDBOX:
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
            # Check if already archived (idempotency)
            manifest_key = self._get_manifest_key(run)
            if storage and storage.object_exists(manifest_key):
                # Manifest exists, check if data was properly archived
                existing_manifest = self._load_manifest(storage, manifest_key)
                if existing_manifest and self._verify_manifest(storage, run, existing_manifest):
                    # Already archived, just mark and delete
                    if not self.dry_run:
                        self._mark_archived(session, run.id)
                        self._delete_archived_data(session, run)
                        session.commit()
                    result.success = True
                    result.elapsed_time = time.time() - start_time
                    return result

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

                # Serialize and upload each table
                table_stats: list[TableStats] = []
                for table_name in self.ARCHIVED_TABLES:
                    records = table_data.get(table_name, [])
                    key = self._get_table_key(run, table_name)
                    if storage.object_exists(key):
                        # Reuse existing archived data to keep archiving idempotent.
                        existing_data = storage.get_object(key)
                        checksum = ArchiveStorage.compute_checksum(existing_data)
                        table_stats.append(
                            TableStats(
                                table_name=table_name,
                                row_count=len(ArchiveStorage.deserialize_from_jsonl_gz(existing_data)),
                                checksum=checksum,
                                size_bytes=len(existing_data),
                            )
                        )
                        continue

                    data = ArchiveStorage.serialize_to_jsonl_gz(records)
                    checksum = storage.put_object(key, data)

                    table_stats.append(
                        TableStats(
                            table_name=table_name,
                            row_count=len(records),
                            checksum=checksum,
                            size_bytes=len(data),
                        )
                    )

                # Generate and upload manifest
                manifest = self._generate_manifest(run, table_stats)
                manifest_data = json.dumps(manifest, indent=2, default=str).encode("utf-8")
                storage.put_object(manifest_key, manifest_data)

                # Verify upload
                if not self._verify_manifest(storage, run, manifest):
                    raise Exception("Manifest verification failed")

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
        node_exec_records = DifyAPISQLAlchemyWorkflowNodeExecutionRepository.get_by_run_id(
            session,
            run.id,
        )
        node_exec_ids = [record.id for record in node_exec_records]
        offload_records = DifyAPISQLAlchemyWorkflowNodeExecutionRepository.get_offloads_by_execution_ids(
            session,
            node_exec_ids,
        )
        table_data["workflow_node_executions"] = [self._model_to_dict(row) for row in node_exec_records]
        table_data["workflow_node_execution_offload"] = [self._model_to_dict(row) for row in offload_records]
        repo = self._get_workflow_run_repo()
        pause_records = repo.get_pause_records_by_run_id(session, run.id)
        pause_ids = [pause.id for pause in pause_records]
        pause_reason_records = repo.get_pause_reason_records_by_run_id(
            session,
            pause_ids,
        )
        table_data["workflow_pauses"] = [self._model_to_dict(row) for row in pause_records]
        table_data["workflow_pause_reasons"] = [self._model_to_dict(row) for row in pause_reason_records]
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        trigger_records = trigger_repo.list_by_run_id(run.id)
        table_data["workflow_trigger_logs"] = [self._model_to_dict(row) for row in trigger_records]
        return table_data

    def _model_to_dict(self, model: Any) -> dict[str, Any]:
        """Convert a SQLAlchemy model to a dictionary."""
        result = {}
        for column in model.__table__.columns:
            attr_name = column.key
            value = getattr(model, attr_name, None)
            if value is None and attr_name == "type" and hasattr(model, "type_"):
                # Some models (e.g., WorkflowNodeExecutionOffload) map the DB column "type"
                # to the attribute name "type_". Fall back accordingly to avoid AttributeError.
                value = model.type_
            result[attr_name] = value
        return result

    def _get_manifest_key(self, run: WorkflowRun) -> str:
        """Get the storage key for the manifest file."""
        prefix = build_workflow_run_prefix(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            created_at=run.created_at,
            run_id=run.id,
        )
        return f"{prefix}/manifest.json"

    def _get_table_key(self, run: WorkflowRun, table_name: str) -> str:
        """Get the storage key for a table data file."""
        prefix = build_workflow_run_prefix(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            created_at=run.created_at,
            run_id=run.id,
        )
        return f"{prefix}/table={table_name}/data.jsonl.gz"

    def _generate_manifest(
        self,
        run: WorkflowRun,
        table_stats: list[TableStats],
    ) -> dict[str, Any]:
        """Generate a manifest for the archived workflow run."""
        return {
            "schema_version": "1.0",
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

    def _load_manifest(self, storage: ArchiveStorage, key: str) -> dict[str, Any] | None:
        """Load a manifest from storage."""
        try:
            data = storage.get_object(key)
            return json.loads(data.decode("utf-8"))
        except Exception:
            return None

    def _verify_manifest(
        self,
        storage: ArchiveStorage,
        run: WorkflowRun,
        manifest: dict[str, Any],
    ) -> bool:
        """Verify that all objects in the manifest exist and have correct checksums."""
        tables = manifest.get("tables", {})

        for table_name, info in tables.items():
            key = self._get_table_key(run, table_name)
            if not storage.object_exists(key):
                logger.warning("Missing archived table object: %s", key)
                return False

            # Optionally verify checksum
            try:
                data = storage.get_object(key)
                actual_checksum = ArchiveStorage.compute_checksum(data)
                if actual_checksum != info.get("checksum"):
                    logger.warning(
                        "Checksum mismatch for %s: expected=%s, actual=%s",
                        key,
                        info.get("checksum"),
                        actual_checksum,
                    )
                    return False

                records = ArchiveStorage.deserialize_from_jsonl_gz(data)
                expected_count = info.get("row_count", 0)
                if len(records) != expected_count:
                    logger.warning(
                        "Row count mismatch for %s: expected=%s, actual=%s",
                        key,
                        expected_count,
                        len(records),
                    )
                    return False
            except Exception as e:
                logger.warning("Failed to verify manifest for %s: %s", key, e)
                return False

        return True

    def _mark_archived(self, session: Session, run_id: str) -> None:
        """Mark a workflow run as archived."""
        repo = self._get_workflow_run_repo()
        repo.mark_runs_archived(session, [run_id])

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
