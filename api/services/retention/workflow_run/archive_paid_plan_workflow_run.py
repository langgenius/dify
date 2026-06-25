"""
Archive Paid Plan Workflow Run Logs Service.

This service archives workflow run logs for paid plan users older than the configured retention period (default:
90 days) to S3-compatible storage.

Archive V2 writes bundle-level Parquet objects. A bundle contains many workflow runs and their related table rows.
Bundle metadata lives in the object-store manifest as the recoverable source of truth. Completed bundles are also
mirrored into a small database index so console listing and download jobs do not list object storage online.

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
import hashlib
import json
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import click
import pyarrow as pa
import pyarrow.parquet as pq
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from graphon.enums import WorkflowType
from libs.archive_storage import (
    ArchiveStorage,
    ArchiveStorageNotConfiguredError,
    get_archive_storage,
)
from models.trigger import WorkflowTriggerLog
from models.workflow import (
    WorkflowAppLog,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.billing_service import BillingService
from services.retention.workflow_run.archive_bundle_index import (
    ArchiveBundleManifest,
    ArchiveBundleTableManifestEntry,
    decode_archive_bundle_manifest,
    upsert_archive_bundle_index_from_manifest,
)
from services.retention.workflow_run.constants import (
    ARCHIVE_BUNDLE_FORMAT,
    ARCHIVE_BUNDLE_MANIFEST_NAME,
    ARCHIVE_BUNDLE_SCHEMA_VERSION,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ArchiveBundleIdentity:
    """Stable identity and object prefix for one V2 archive bundle."""

    tenant_prefix: str
    tenant_id: str
    year: int
    month: int
    shard: str
    bundle_id: str
    object_prefix: str


@dataclass
class TableStats:
    """Statistics for a single archived table."""

    table_name: str
    row_count: int
    checksum: str
    size_bytes: int
    object_key: str = ""


@dataclass
class ArchiveResult:
    """Result of archiving a bundle of workflow runs."""

    bundle_id: str
    tenant_id: str
    object_prefix: str
    success: bool
    run_count: int = 0
    tables: list[TableStats] = field(default_factory=list)
    object_size_bytes: int = 0
    skipped: bool = False
    error: str | None = None
    elapsed_time: float = 0.0


@dataclass
class ArchiveSummary:
    """Summary of the entire archive operation."""

    total_runs_processed: int = 0
    runs_archived: int = 0
    runs_skipped: int = 0
    runs_failed: int = 0
    total_bundles_processed: int = 0
    bundles_archived: int = 0
    bundles_skipped: int = 0
    bundles_failed: int = 0
    total_object_size_bytes: int = 0
    table_stats: dict[str, TableStats] = field(default_factory=dict)
    total_elapsed_time: float = 0.0


class WorkflowRunArchiver:
    """
    Archive workflow run logs for paid plan users.

    Storage Layout:
    workflow-runs/v2/tenant_prefix={prefix}/tenant_id={tenant_id}/year={YYYY}/month={MM}/
        shard={shard}/bundle={bundle_id}/
            ├── manifest.json
            ├── workflow_runs.parquet
            ├── workflow_app_logs.parquet
            ├── workflow_node_executions.parquet
            ├── workflow_node_execution_offload.parquet
            ├── workflow_pauses.parquet
            ├── workflow_pause_reasons.parquet
            └── workflow_trigger_logs.parquet

    `batch_size` is the maximum workflow_runs per bundle. The current implementation groups each fetched page by
    tenant/month before writing bundles. Bundle idempotency is based on the manifest object key; the manifest is
    uploaded after all table objects, so a missing manifest means the bundle should be retried.
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
    paid_tenant_ids: set[str] | None
    tenant_prefixes: list[str]
    run_shard_index: int | None
    run_shard_total: int | None

    def __init__(
        self,
        days: int = 90,
        batch_size: int = 100,
        start_from: datetime.datetime | None = None,
        end_before: datetime.datetime | None = None,
        workers: int = 1,
        tenant_ids: Sequence[str] | None = None,
        tenant_prefixes: Sequence[str] | None = None,
        paid_tenant_ids: Sequence[str] | None = None,
        run_shard_index: int | None = None,
        run_shard_total: int | None = None,
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
            tenant_prefixes: Optional tenant ID first-hex prefixes for rollout waves. CLI callers should resolve these
                to tenant_ids during planning so workflow_runs scan uses tenant_id IN (...) instead of a prefix range.
            paid_tenant_ids: Optional paid-tenant whitelist resolved by the archive plan. When provided, archive uses it
                for per-run paid filtering and does not call billing on every fetched page.
            run_shard_index: Optional zero-based workflow run shard index for parallel cron jobs
            run_shard_total: Optional total workflow run shard count for parallel cron jobs
            limit: Maximum number of runs to archive (None for unlimited)
            dry_run: If True, only preview without making changes
            delete_after_archive: Reserved for the V1 per-run path. Bundle archive requires a separate validated
                bundle delete workflow.
        """
        if delete_after_archive:
            raise ValueError("delete_after_archive is not supported by bundle archive")
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
        self.tenant_prefixes = sorted(set(tenant_prefixes)) if tenant_prefixes else []
        self.paid_tenant_ids = set(paid_tenant_ids) if paid_tenant_ids is not None else None
        if (run_shard_index is None) ^ (run_shard_total is None):
            raise ValueError("run_shard_index and run_shard_total must be provided together")
        if run_shard_total is not None and not 1 <= run_shard_total <= 16:
            raise ValueError("run_shard_total must be between 1 and 16")
        if run_shard_index is not None and run_shard_total is not None and not 0 <= run_shard_index < run_shard_total:
            raise ValueError("run_shard_index must be between 0 and run_shard_total - 1")
        self.run_shard_index = run_shard_index
        self.run_shard_total = run_shard_total
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
        attempted_count = 0

        for tenant_scope in self._tenant_scan_scopes():
            last_seen: tuple[datetime.datetime, str] | None = None
            while True:
                if self.limit and attempted_count >= self.limit:
                    click.echo(click.style(f"Reached limit of {self.limit} runs", fg="yellow"))
                    break

                runs = self._get_runs_batch(last_seen, tenant_scope=tenant_scope)
                if not runs:
                    break

                last_seen = (runs[-1].created_at, runs[-1].id)
                tenant_ids = {run.tenant_id for run in runs}
                paid_tenants = self._filter_paid_tenants(tenant_ids)

                runs_to_process: list[WorkflowRun] = []
                for run in runs:
                    summary.total_runs_processed += 1
                    if run.tenant_id not in paid_tenants:
                        summary.runs_skipped += 1
                        continue
                    if self.limit and attempted_count + len(runs_to_process) >= self.limit:
                        break
                    runs_to_process.append(run)

                if not runs_to_process:
                    continue

                for bundle_runs in self._group_runs_for_bundles(runs_to_process):
                    summary.total_bundles_processed += 1
                    with session_maker() as session:
                        result = self._archive_bundle(session, storage, bundle_runs)

                    if result.skipped:
                        attempted_count += result.run_count
                        summary.bundles_skipped += 1
                        summary.runs_skipped += result.run_count
                        click.echo(
                            click.style(
                                f"Skipped bundle {result.bundle_id} (tenant={result.tenant_id}, "
                                f"runs={result.run_count}, reason={result.error or 'already handled'})",
                                fg="yellow",
                            )
                        )
                    elif result.success:
                        attempted_count += result.run_count
                        summary.bundles_archived += 1
                        summary.runs_archived += result.run_count
                        self._merge_result_stats(summary, result)
                        click.echo(
                            click.style(
                                f"{'[DRY RUN] Would archive' if self.dry_run else 'Archived'} "
                                f"bundle {result.bundle_id} (tenant={result.tenant_id}, runs={result.run_count}, "
                                f"tables={len(result.tables)}, object_size_bytes={result.object_size_bytes}, "
                                f"time={result.elapsed_time:.2f}s)",
                                fg="green",
                            )
                        )
                        if self.dry_run:
                            self._echo_table_estimates(result.tables)
                    else:
                        attempted_count += result.run_count
                        summary.bundles_failed += 1
                        summary.runs_failed += result.run_count
                        click.echo(
                            click.style(
                                f"Failed to archive bundle {result.bundle_id}: {result.error}",
                                fg="red",
                            )
                        )

            if self.limit and attempted_count >= self.limit:
                break

        summary.total_elapsed_time = time.time() - start_time
        click.echo(
            click.style(
                f"{'[DRY RUN] ' if self.dry_run else ''}Archive complete: "
                f"processed={summary.total_runs_processed}, archived={summary.runs_archived}, "
                f"skipped={summary.runs_skipped}, failed={summary.runs_failed}, "
                f"bundles_archived={summary.bundles_archived}, bundles_skipped={summary.bundles_skipped}, "
                f"bundles_failed={summary.bundles_failed}, "
                f"object_size_bytes={summary.total_object_size_bytes}, "
                f"time={summary.total_elapsed_time:.2f}s",
                fg="white",
            )
        )
        if self.dry_run:
            self._echo_summary_estimates(summary)

        return summary

    @staticmethod
    def _merge_result_stats(summary: ArchiveSummary, result: ArchiveResult) -> None:
        summary.total_object_size_bytes += result.object_size_bytes
        for table_stat in result.tables:
            summary_stat = summary.table_stats.get(table_stat.table_name)
            if summary_stat is None:
                summary.table_stats[table_stat.table_name] = TableStats(
                    table_name=table_stat.table_name,
                    row_count=table_stat.row_count,
                    checksum="",
                    size_bytes=table_stat.size_bytes,
                )
                continue
            summary_stat.row_count += table_stat.row_count
            summary_stat.size_bytes += table_stat.size_bytes

    @staticmethod
    def _echo_table_estimates(table_stats: Sequence[TableStats]) -> None:
        for stat in table_stats:
            click.echo(
                click.style(
                    f"  table={stat.table_name} rows={stat.row_count} parquet_bytes={stat.size_bytes}",
                    fg="white",
                )
            )

    def _echo_summary_estimates(self, summary: ArchiveSummary) -> None:
        click.echo(click.style("[DRY RUN] Estimated archive totals by table:", fg="white"))
        for table_name in self.ARCHIVED_TABLES:
            stat = summary.table_stats.get(table_name)
            row_count = stat.row_count if stat else 0
            size_bytes = stat.size_bytes if stat else 0
            click.echo(click.style(f"  table={table_name} rows={row_count} parquet_bytes={size_bytes}", fg="white"))

    def _get_runs_batch(
        self,
        last_seen: tuple[datetime.datetime, str] | None,
        tenant_scope: Sequence[str] | None = None,
    ) -> Sequence[WorkflowRun]:
        """Fetch a batch of workflow runs to archive."""
        repo = self._get_workflow_run_repo()
        tenant_ids = list(tenant_scope) if tenant_scope is not None else self.tenant_ids or None
        return repo.get_runs_batch_by_time_range(
            start_from=self.start_from,
            end_before=self.end_before,
            last_seen=last_seen,
            batch_size=self.batch_size,
            run_types=self.ARCHIVED_TYPE,
            tenant_ids=tenant_ids,
            tenant_prefixes=None if tenant_ids else self.tenant_prefixes or None,
            run_shard_index=self.run_shard_index,
            run_shard_total=self.run_shard_total,
        )

    def _tenant_scan_scopes(self) -> list[list[str] | None]:
        if not self.tenant_ids:
            return [None]
        return [[tenant_id] for tenant_id in self.tenant_ids]

    def _build_start_message(self) -> str:
        range_desc = f"before {self.end_before.isoformat()}"
        if self.start_from:
            range_desc = f"between {self.start_from.isoformat()} and {self.end_before.isoformat()}"
        run_shard_desc = "all"
        if self.run_shard_index is not None and self.run_shard_total is not None:
            run_shard_desc = f"{self.run_shard_index}/{self.run_shard_total}"
        return (
            f"{'[DRY RUN] ' if self.dry_run else ''}Starting workflow run archiving "
            f"for runs {range_desc} "
            f"(batch_size={self.batch_size}, tenant_ids={self._format_tenant_scope()}, "
            f"tenant_prefixes={','.join(self.tenant_prefixes) or 'all'}, run_shard={run_shard_desc})"
        )

    def _format_tenant_scope(self) -> str:
        if not self.tenant_ids:
            return "all"
        if len(self.tenant_ids) <= 10:
            return ",".join(self.tenant_ids)
        return f"{len(self.tenant_ids)} planned tenants"

    def _filter_paid_tenants(self, tenant_ids: set[str]) -> set[str]:
        """Filter tenant IDs to only include paid tenants."""
        if self.paid_tenant_ids is not None:
            return tenant_ids & self.paid_tenant_ids

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

    def _archive_bundle(
        self,
        session: Session,
        storage: ArchiveStorage | None,
        runs: Sequence[WorkflowRun],
    ) -> ArchiveResult:
        """Archive one tenant/month bundle of workflow runs."""
        if not runs:
            raise ValueError("runs must not be empty")
        start_time = time.time()
        identity = self._build_bundle_identity(runs)
        result = ArchiveResult(
            bundle_id=identity.bundle_id,
            tenant_id=identity.tenant_id,
            object_prefix=identity.object_prefix,
            run_count=len(runs),
            success=False,
        )

        try:
            if not self.dry_run:
                if storage is None:
                    raise ArchiveStorageNotConfiguredError("Archive storage not configured")
                if storage.object_exists(self._get_manifest_object_key(identity)):
                    self._sync_existing_bundle_index(session, storage, identity)
                    result.success = True
                    result.skipped = True
                    result.error = "bundle already archived"
                    result.elapsed_time = time.time() - start_time
                    return result

                locked_runs = self._lock_runs_for_archive(session, [run.id for run in runs])
                if len(locked_runs) != len(runs):
                    result.success = True
                    result.skipped = True
                    result.error = "one or more runs locked or deleted by another archiver"
                    result.elapsed_time = time.time() - start_time
                    return result
                runs = locked_runs

            table_data = self._extract_bundle_data(session, runs)
            table_stats, table_payloads, manifest_data = self._build_archive_payload(identity, runs, table_data)
            object_size = len(manifest_data) + sum(len(payload) for payload in table_payloads.values())

            if self.dry_run:
                result.tables = table_stats
                result.object_size_bytes = object_size
                result.success = True
            else:
                if storage is None:
                    raise ArchiveStorageNotConfiguredError("Archive storage not configured")

                for table_name, payload in table_payloads.items():
                    storage.put_object(self._get_table_object_key(identity, table_name), payload)
                storage.put_object(self._get_manifest_object_key(identity), manifest_data)
                manifest = decode_archive_bundle_manifest(manifest_data)
                upsert_archive_bundle_index_from_manifest(session, manifest, len(manifest_data))
                session.commit()

                logger.info(
                    "Archived workflow run bundle %s: tenant=%s runs=%s tables=%s object_prefix=%s",
                    identity.bundle_id,
                    identity.tenant_id,
                    len(runs),
                    {s.table_name: s.row_count for s in table_stats},
                    identity.object_prefix,
                )

                result.tables = table_stats
                result.object_size_bytes = object_size
                result.success = True

        except Exception as e:
            logger.exception("Failed to archive workflow run bundle %s", identity.bundle_id)
            result.error = str(e)
            session.rollback()

        result.elapsed_time = time.time() - start_time
        return result

    def _sync_existing_bundle_index(
        self,
        session: Session,
        storage: ArchiveStorage,
        identity: ArchiveBundleIdentity,
    ) -> None:
        """Best-effort DB index sync for a bundle whose manifest already exists in archive storage."""
        manifest_key = self._get_manifest_object_key(identity)
        try:
            manifest_data = storage.get_object(manifest_key)
            manifest = decode_archive_bundle_manifest(manifest_data)
            upsert_archive_bundle_index_from_manifest(session, manifest, len(manifest_data))
            session.commit()
        except Exception:
            session.rollback()
            logger.warning("Failed to sync workflow archive bundle index for %s", manifest_key, exc_info=True)

    def _lock_runs_for_archive(
        self,
        session: Session,
        run_ids: Sequence[str],
    ) -> list[WorkflowRun]:
        """
        Lock workflow runs before archiving a bundle.

        Parallel cron jobs may select overlapping pages. Row-level SKIP LOCKED keeps duplicate archivers from uploading
        conflicting bundle objects for the same source rows.
        """
        if not run_ids:
            return []
        stmt = (
            select(WorkflowRun)
            .where(WorkflowRun.id.in_(run_ids))
            .order_by(WorkflowRun.created_at.asc(), WorkflowRun.id.asc())
            .with_for_update(skip_locked=True)
        )
        return list(session.scalars(stmt))

    def _extract_bundle_data(
        self,
        session: Session,
        runs: Sequence[WorkflowRun],
    ) -> dict[str, list[dict[str, Any]]]:
        """Extract all archived table rows for a bundle."""
        run_ids = [run.id for run in runs]
        table_data: dict[str, list[dict[str, Any]]] = {}
        table_data["workflow_runs"] = [self._row_to_dict(run) for run in runs]

        app_logs = list(session.scalars(select(WorkflowAppLog).where(WorkflowAppLog.workflow_run_id.in_(run_ids))))
        table_data["workflow_app_logs"] = [self._row_to_dict(row) for row in app_logs]

        node_exec_records = list(
            session.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.workflow_run_id.in_(run_ids))
            )
        )
        node_exec_ids = [record.id for record in node_exec_records]
        offload_records = []
        if node_exec_ids:
            offload_records = list(
                session.scalars(
                    select(WorkflowNodeExecutionOffload).where(
                        WorkflowNodeExecutionOffload.node_execution_id.in_(node_exec_ids)
                    )
                )
            )
        table_data["workflow_node_executions"] = [self._row_to_dict(row) for row in node_exec_records]
        table_data["workflow_node_execution_offload"] = [self._row_to_dict(row) for row in offload_records]

        pause_records = list(session.scalars(select(WorkflowPause).where(WorkflowPause.workflow_run_id.in_(run_ids))))
        pause_ids = [pause.id for pause in pause_records]
        pause_reason_records = []
        if pause_ids:
            pause_reason_records = list(
                session.scalars(select(WorkflowPauseReason).where(WorkflowPauseReason.pause_id.in_(pause_ids)))
            )
        table_data["workflow_pauses"] = [self._row_to_dict(row) for row in pause_records]
        table_data["workflow_pause_reasons"] = [self._row_to_dict(row) for row in pause_reason_records]

        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        trigger_records: list[WorkflowTriggerLog] = []
        for run_id in run_ids:
            trigger_records.extend(trigger_repo.list_by_run_id(run_id))
        table_data["workflow_trigger_logs"] = [self._row_to_dict(row) for row in trigger_records]
        return table_data

    @staticmethod
    def _row_to_dict(row: Any) -> dict[str, Any]:
        mapper = inspect(row).mapper
        return {str(column.name): getattr(row, mapper.get_property_by_column(column).key) for column in mapper.columns}

    def _build_archive_payload(
        self,
        identity: ArchiveBundleIdentity,
        runs: Sequence[WorkflowRun],
        table_data: dict[str, list[dict[str, Any]]],
    ) -> tuple[list[TableStats], dict[str, bytes], bytes]:
        """Build the archive payload and size stats without writing it to storage."""
        table_stats: list[TableStats] = []
        table_payloads: dict[str, bytes] = {}
        for table_name in self.ARCHIVED_TABLES:
            records = table_data.get(table_name, [])
            data = self._serialize_to_parquet(records)
            table_payloads[table_name] = data
            checksum = ArchiveStorage.compute_checksum(data)

            table_stats.append(
                TableStats(
                    table_name=table_name,
                    row_count=len(records),
                    checksum=checksum,
                    size_bytes=len(data),
                    object_key=self._get_table_object_key(identity, table_name),
                )
            )

        manifest = self._generate_manifest(identity, runs, table_stats)
        manifest_data = json.dumps(manifest, indent=2, default=str).encode("utf-8")
        return table_stats, table_payloads, manifest_data

    def _generate_manifest(
        self,
        identity: ArchiveBundleIdentity,
        runs: Sequence[WorkflowRun],
        table_stats: list[TableStats],
    ) -> ArchiveBundleManifest:
        """Generate a manifest for the archived workflow run bundle."""
        tables: dict[str, ArchiveBundleTableManifestEntry] = {
            stat.table_name: {
                "row_count": stat.row_count,
                "checksum": stat.checksum,
                "size_bytes": stat.size_bytes,
                "object_key": stat.object_key,
            }
            for stat in table_stats
        }
        sorted_runs = sorted(runs, key=lambda run: (run.created_at, run.id))
        return ArchiveBundleManifest(
            schema_version=ARCHIVE_BUNDLE_SCHEMA_VERSION,
            archive_format=ARCHIVE_BUNDLE_FORMAT,
            tenant_id=identity.tenant_id,
            tenant_prefix=identity.tenant_prefix,
            year=identity.year,
            month=identity.month,
            shard=identity.shard,
            bundle_id=identity.bundle_id,
            object_prefix=identity.object_prefix,
            workflow_run_count=len(runs),
            workflow_node_execution_count=tables["workflow_node_executions"]["row_count"],
            min_created_at=sorted_runs[0].created_at.isoformat(),
            max_created_at=sorted_runs[-1].created_at.isoformat(),
            min_run_id=min(run.id for run in runs),
            max_run_id=max(run.id for run in runs),
            archived_at=datetime.datetime.now(datetime.UTC).isoformat(),
            tables=tables,
            run_ids=[run.id for run in sorted_runs],
        )

    @staticmethod
    def _serialize_to_parquet(records: list[dict[str, Any]]) -> bytes:
        normalized_records = [WorkflowRunArchiver._normalize_record_for_parquet(record) for record in records]
        table = pa.Table.from_pylist(normalized_records) if normalized_records else pa.table({})
        sink = pa.BufferOutputStream()
        pq.write_table(table, sink, compression="zstd")
        return sink.getvalue().to_pybytes()

    @staticmethod
    def _normalize_record_for_parquet(record: dict[str, Any]) -> dict[str, Any]:
        def normalize(value: Any) -> Any:
            if isinstance(value, Enum):
                return value.value
            if isinstance(value, dict | list):
                return json.dumps(value, default=str, ensure_ascii=False)
            return value

        return {key: normalize(value) for key, value in record.items()}

    def _group_runs_for_bundles(self, runs: Sequence[WorkflowRun]) -> list[list[WorkflowRun]]:
        """Group a fetched page into tenant/month bundles."""
        grouped: dict[tuple[str, int, int], list[WorkflowRun]] = {}
        for run in runs:
            key = (run.tenant_id, run.created_at.year, run.created_at.month)
            grouped.setdefault(key, []).append(run)
        return [sorted(group, key=lambda run: (run.created_at, run.id)) for group in grouped.values()]

    def _build_bundle_identity(self, runs: Sequence[WorkflowRun]) -> ArchiveBundleIdentity:
        """Build the object-store identity for a bundle."""
        sorted_runs = sorted(runs, key=lambda run: (run.created_at, run.id))
        first_run = sorted_runs[0]
        tenant_ids = {run.tenant_id for run in sorted_runs}
        if len(tenant_ids) != 1:
            raise ValueError("archive bundle cannot span multiple tenants")
        years_months = {(run.created_at.year, run.created_at.month) for run in sorted_runs}
        if len(years_months) != 1:
            raise ValueError("archive bundle cannot span multiple months")

        run_ids_digest = hashlib.sha256(",".join(run.id for run in sorted_runs).encode("utf-8")).hexdigest()
        tenant_prefix = first_run.tenant_id[0].lower()
        shard = self._bundle_shard_name()
        year, month = next(iter(years_months))
        bundle_id = run_ids_digest[:16]
        object_prefix = (
            f"workflow-runs/v2/tenant_prefix={tenant_prefix}/tenant_id={first_run.tenant_id}/"
            f"year={year:04d}/month={month:02d}/shard={shard}/bundle={bundle_id}"
        )
        return ArchiveBundleIdentity(
            tenant_prefix=tenant_prefix,
            tenant_id=first_run.tenant_id,
            year=year,
            month=month,
            shard=shard,
            bundle_id=bundle_id,
            object_prefix=object_prefix,
        )

    def _bundle_shard_name(self) -> str:
        if self.run_shard_index is None or self.run_shard_total is None:
            return "00-of-01"
        return f"{self.run_shard_index:02d}-of-{self.run_shard_total:02d}"

    @staticmethod
    def _get_table_object_key(identity: ArchiveBundleIdentity, table_name: str) -> str:
        return f"{identity.object_prefix}/{table_name}.parquet"

    @staticmethod
    def _get_manifest_object_key(identity: ArchiveBundleIdentity) -> str:
        return f"{identity.object_prefix}/{ARCHIVE_BUNDLE_MANIFEST_NAME}"

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
