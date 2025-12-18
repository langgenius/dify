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
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.billing_service import BillingService, TenantPlanInfo

logger = logging.getLogger(__name__)


class WorkflowRunCleanup:
    def __init__(
        self,
        days: int,
        batch_size: int,
        start_after: datetime.datetime | None = None,
        end_before: datetime.datetime | None = None,
        workflow_run_repo: APIWorkflowRunRepository | None = None,
        dry_run: bool = False,
    ):
        if (start_after is None) ^ (end_before is None):
            raise ValueError("start_after and end_before must be both set or both omitted.")

        computed_cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
        self.window_start = start_after
        self.window_end = end_before or computed_cutoff

        if self.window_start and self.window_end <= self.window_start:
            raise ValueError("end_before must be greater than start_after.")

        if batch_size <= 0:
            raise ValueError("batch_size must be greater than 0.")

        self.batch_size = batch_size
        self.billing_cache: dict[str, TenantPlanInfo | None] = {}
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
        batch_index = 0
        last_seen: tuple[datetime.datetime, str] | None = None

        while True:
            run_rows = self.workflow_run_repo.get_runs_batch_by_time_range(
                start_after=self.window_start,
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
                click.echo(
                    click.style(
                        f"[batch #{batch_index}] skipped (no sandbox runs in batch, {paid_or_skipped} paid/unknown)",
                        fg="yellow",
                    )
                )
                continue

            total_runs_targeted += len(free_runs)

            if self.dry_run:
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

        uncached_tenants = [tenant_id for tenant_id in tenant_id_list if tenant_id not in self.billing_cache]

        if uncached_tenants:
            try:
                bulk_info = BillingService.get_plan_bulk(uncached_tenants)
            except Exception:
                bulk_info = {}
                logger.exception("Failed to fetch billing plans in bulk for tenants: %s", uncached_tenants)

            for tenant_id in uncached_tenants:
                info = bulk_info.get(tenant_id)
                if info is None:
                    logger.warning("Missing billing info for tenant %s in bulk resp; treating as non-free", tenant_id)
                self.billing_cache[tenant_id] = info

        eligible_free_tenants: set[str] = set()
        for tenant_id in tenant_id_list:
            info = self.billing_cache.get(tenant_id)
            if not info:
                continue

            if info.plan != CloudPlan.SANDBOX:
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

    def _is_within_grace_period(self, tenant_id: str, info: TenantPlanInfo) -> bool:
        if self.free_plan_grace_period_days <= 0:
            return False

        expiration_at = self._expiration_datetime(tenant_id, info.expiration_date)
        if expiration_at is None:
            return False

        grace_deadline = expiration_at + datetime.timedelta(days=self.free_plan_grace_period_days)
        return datetime.datetime.now(datetime.UTC) < grace_deadline

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
