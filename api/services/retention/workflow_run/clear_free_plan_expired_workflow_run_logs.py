import datetime
import logging
from collections.abc import Iterable, Sequence

import click
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.billing_service import BillingService, SubscriptionPlan

logger = logging.getLogger(__name__)


class WorkflowRunCleanup:
    def __init__(
        self,
        days: int,
        batch_size: int,
        start_from: datetime.datetime | None = None,
        end_before: datetime.datetime | None = None,
        workflow_run_repo: APIWorkflowRunRepository | None = None,
        dry_run: bool = False,
    ):
        if (start_from is None) ^ (end_before is None):
            raise ValueError("start_from and end_before must be both set or both omitted.")

        computed_cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
        self.window_start = start_from
        self.window_end = end_before or computed_cutoff

        if self.window_start and self.window_end <= self.window_start:
            raise ValueError("end_before must be greater than start_from.")

        if batch_size <= 0:
            raise ValueError("batch_size must be greater than 0.")

        self.batch_size = batch_size
        self._cleanup_whitelist: set[str] | None = None
        self.dry_run = dry_run
        self.free_plan_grace_period_days = dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_GRACEFUL_PERIOD
        self.workflow_run_repo: APIWorkflowRunRepository
        if workflow_run_repo:
            self.workflow_run_repo = workflow_run_repo
        else:
            # Lazy import to avoid circular dependencies during module import
            from repositories.factory import DifyAPIRepositoryFactory

            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
            self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    def run(self) -> None:
        click.echo(
            click.style(
                f"{'Inspecting' if self.dry_run else 'Cleaning'} workflow runs "
                f"{'between ' + self.window_start.isoformat() + ' and ' if self.window_start else 'before '}"
                f"{self.window_end.isoformat()} (batch={self.batch_size})",
                fg="white",
            )
        )
        if self.dry_run:
            click.echo(click.style("Dry run mode enabled. No data will be deleted.", fg="yellow"))

        total_runs_deleted = 0
        total_runs_targeted = 0
        related_totals = self._empty_related_counts() if self.dry_run else None
        batch_index = 0
        last_seen: tuple[datetime.datetime, str] | None = None

        while True:
            run_rows = self.workflow_run_repo.get_runs_batch_by_time_range(
                start_from=self.window_start,
                end_before=self.window_end,
                last_seen=last_seen,
                batch_size=self.batch_size,
            )
            if not run_rows:
                break

            batch_index += 1
            last_seen = (run_rows[-1].created_at, run_rows[-1].id)
            tenant_ids = {row.tenant_id for row in run_rows}
            free_tenants = self._filter_free_tenants(tenant_ids)
            free_runs = [row for row in run_rows if row.tenant_id in free_tenants]
            paid_or_skipped = len(run_rows) - len(free_runs)

            if not free_runs:
                skipped_message = (
                    f"[batch #{batch_index}] skipped (no sandbox runs in batch, {paid_or_skipped} paid/unknown)"
                )
                click.echo(
                    click.style(
                        skipped_message,
                        fg="yellow",
                    )
                )
                continue

            total_runs_targeted += len(free_runs)

            if self.dry_run:
                batch_counts = self.workflow_run_repo.count_runs_with_related(
                    free_runs,
                    count_node_executions=self._count_node_executions,
                    count_trigger_logs=self._count_trigger_logs,
                )
                if related_totals is not None:
                    for key in related_totals:
                        related_totals[key] += batch_counts.get(key, 0)
                sample_ids = ", ".join(run.id for run in free_runs[:5])
                click.echo(
                    click.style(
                        f"[batch #{batch_index}] would delete {len(free_runs)} runs "
                        f"(sample ids: {sample_ids}) and skip {paid_or_skipped} paid/unknown",
                        fg="yellow",
                    )
                )
                continue

            try:
                counts = self.workflow_run_repo.delete_runs_with_related(
                    free_runs,
                    delete_node_executions=self._delete_node_executions,
                    delete_trigger_logs=self._delete_trigger_logs,
                )
            except Exception:
                logger.exception("Failed to delete workflow runs batch ending at %s", last_seen[0])
                raise

            total_runs_deleted += counts["runs"]
            click.echo(
                click.style(
                    f"[batch #{batch_index}] deleted runs: {counts['runs']} "
                    f"(nodes {counts['node_executions']}, offloads {counts['offloads']}, "
                    f"app_logs {counts['app_logs']}, trigger_logs {counts['trigger_logs']}, "
                    f"pauses {counts['pauses']}, pause_reasons {counts['pause_reasons']}); "
                    f"skipped {paid_or_skipped} paid/unknown",
                    fg="green",
                )
            )

        if self.dry_run:
            if self.window_start:
                summary_message = (
                    f"Dry run complete. Would delete {total_runs_targeted} workflow runs "
                    f"between {self.window_start.isoformat()} and {self.window_end.isoformat()}"
                )
            else:
                summary_message = (
                    f"Dry run complete. Would delete {total_runs_targeted} workflow runs "
                    f"before {self.window_end.isoformat()}"
                )
            if related_totals is not None:
                summary_message = f"{summary_message}; related records: {self._format_related_counts(related_totals)}"
            summary_color = "yellow"
        else:
            if self.window_start:
                summary_message = (
                    f"Cleanup complete. Deleted {total_runs_deleted} workflow runs "
                    f"between {self.window_start.isoformat()} and {self.window_end.isoformat()}"
                )
            else:
                summary_message = (
                    f"Cleanup complete. Deleted {total_runs_deleted} workflow runs before {self.window_end.isoformat()}"
                )
            summary_color = "white"

        click.echo(click.style(summary_message, fg=summary_color))

    def _filter_free_tenants(self, tenant_ids: Iterable[str]) -> set[str]:
        tenant_id_list = list(tenant_ids)

        if not dify_config.BILLING_ENABLED:
            return set(tenant_id_list)

        if not tenant_id_list:
            return set()

        cleanup_whitelist = self._get_cleanup_whitelist()

        try:
            bulk_info = BillingService.get_plan_bulk_with_cache(tenant_id_list)
        except Exception:
            bulk_info = {}
            logger.exception("Failed to fetch billing plans in bulk for tenants: %s", tenant_id_list)

        eligible_free_tenants: set[str] = set()
        for tenant_id in tenant_id_list:
            if tenant_id in cleanup_whitelist:
                continue

            info = bulk_info.get(tenant_id)
            if info is None:
                logger.warning("Missing billing info for tenant %s in bulk resp; treating as non-free", tenant_id)
                continue

            if info.get("plan") != CloudPlan.SANDBOX:
                continue

            if self._is_within_grace_period(tenant_id, info):
                continue

            eligible_free_tenants.add(tenant_id)

        return eligible_free_tenants

    def _expiration_datetime(self, tenant_id: str, expiration_value: int) -> datetime.datetime | None:
        if expiration_value < 0:
            return None

        try:
            return datetime.datetime.fromtimestamp(expiration_value, datetime.UTC)
        except (OverflowError, OSError, ValueError):
            logger.exception("Failed to parse expiration timestamp for tenant %s", tenant_id)
            return None

    def _is_within_grace_period(self, tenant_id: str, info: SubscriptionPlan) -> bool:
        if self.free_plan_grace_period_days <= 0:
            return False

        expiration_value = info.get("expiration_date", -1)
        expiration_at = self._expiration_datetime(tenant_id, expiration_value)
        if expiration_at is None:
            return False

        grace_deadline = expiration_at + datetime.timedelta(days=self.free_plan_grace_period_days)
        return datetime.datetime.now(datetime.UTC) < grace_deadline

    def _get_cleanup_whitelist(self) -> set[str]:
        if self._cleanup_whitelist is not None:
            return self._cleanup_whitelist

        if not dify_config.BILLING_ENABLED:
            self._cleanup_whitelist = set()
            return self._cleanup_whitelist

        try:
            whitelist_ids = BillingService.get_expired_subscription_cleanup_whitelist()
        except Exception:
            logger.exception("Failed to fetch cleanup whitelist from billing service")
            whitelist_ids = []

        self._cleanup_whitelist = set(whitelist_ids)
        return self._cleanup_whitelist

    def _delete_trigger_logs(self, session: Session, run_ids: Sequence[str]) -> int:
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        return trigger_repo.delete_by_run_ids(run_ids)

    def _count_trigger_logs(self, session: Session, run_ids: Sequence[str]) -> int:
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        return trigger_repo.count_by_run_ids(run_ids)

    @staticmethod
    def _empty_related_counts() -> dict[str, int]:
        return {
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }

    @staticmethod
    def _format_related_counts(counts: dict[str, int]) -> str:
        return (
            f"node_executions {counts['node_executions']}, "
            f"offloads {counts['offloads']}, "
            f"app_logs {counts['app_logs']}, "
            f"trigger_logs {counts['trigger_logs']}, "
            f"pauses {counts['pauses']}, "
            f"pause_reasons {counts['pause_reasons']}"
        )

    def _count_node_executions(self, session: Session, runs: Sequence[WorkflowRun]) -> tuple[int, int]:
        run_ids = [run.id for run in runs]
        repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        )
        return repo.count_by_runs(session, run_ids)

    def _delete_node_executions(self, session: Session, runs: Sequence[WorkflowRun]) -> tuple[int, int]:
        run_ids = [run.id for run in runs]
        repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        )
        return repo.delete_by_runs(session, run_ids)
