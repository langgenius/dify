import datetime
import logging
from collections.abc import Iterable

import click
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.billing_service import BillingService

logger = logging.getLogger(__name__)


class WorkflowRunCleanup:
    def __init__(
        self,
        days: int,
        batch_size: int,
        start_after: datetime.datetime | None = None,
        end_before: datetime.datetime | None = None,
        repo: APIWorkflowRunRepository | None = None,
    ):
        if (start_after is None) ^ (end_before is None):
            raise ValueError("start_after and end_before must be both set or both omitted.")

        computed_cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
        self.window_start = start_after
        self.window_end = end_before or computed_cutoff

        if self.window_start and self.window_end <= self.window_start:
            raise ValueError("end_before must be greater than start_after.")

        self.batch_size = batch_size
        self.billing_cache: dict[str, CloudPlan | None] = {}
        if repo:
            self.repo = repo
        else:
            # Lazy import to avoid circular dependency during module import
            from repositories.factory import DifyAPIRepositoryFactory

            self.repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
                sessionmaker(bind=db.engine, expire_on_commit=False)
            )

    def run(self) -> None:
        click.echo(
            click.style(
                f"Cleaning workflow runs "
                f"{'between ' + self.window_start.isoformat() + ' and ' if self.window_start else 'before '}"
                f"{self.window_end.isoformat()} (batch={self.batch_size})",
                fg="white",
            )
        )

        total_runs_deleted = 0
        batch_index = 0
        last_seen: tuple[datetime.datetime, str] | None = None

        while True:
            run_rows = self.repo.get_runs_batch_for_cleanup(
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
            free_run_ids = [row.id for row in run_rows if row.tenant_id in free_tenants]
            paid_or_skipped = len(run_rows) - len(free_run_ids)

            if not free_run_ids:
                click.echo(
                    click.style(
                        f"[batch #{batch_index}] skipped (no sandbox runs in batch, {paid_or_skipped} paid/unknown)",
                        fg="yellow",
                    )
                )
                continue

            try:
                counts = self.repo.delete_runs_with_related(free_run_ids)
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

        if self.window_start:
            summary_message = (
                f"Cleanup complete. Deleted {total_runs_deleted} workflow runs "
                f"between {self.window_start.isoformat()} and {self.window_end.isoformat()}"
            )
        else:
            summary_message = (
                f"Cleanup complete. Deleted {total_runs_deleted} workflow runs before {self.window_end.isoformat()}"
            )

        click.echo(click.style(summary_message, fg="white"))

    def _filter_free_tenants(self, tenant_ids: Iterable[str]) -> set[str]:
        if not dify_config.BILLING_ENABLED:
            return set(tenant_ids)

        tenant_id_list = list(tenant_ids)
        uncached_tenants = [tenant_id for tenant_id in tenant_id_list if tenant_id not in self.billing_cache]

        if uncached_tenants:
            try:
                bulk_info = BillingService.get_info_bulk(uncached_tenants)
            except Exception:
                bulk_info = {}
                logger.exception("Failed to fetch billing plans in bulk for tenants: %s", uncached_tenants)

            for tenant_id in uncached_tenants:
                plan: CloudPlan | None = None
                info = bulk_info.get(tenant_id)
                if info:
                    try:
                        plan = CloudPlan(info)
                    except Exception:
                        logger.exception("Failed to parse billing plan for tenant %s", tenant_id)
                else:
                    logger.warning("Missing billing info for tenant %s in bulk resp; treating as non-free", tenant_id)

                self.billing_cache[tenant_id] = plan

        return {tenant_id for tenant_id in tenant_id_list if self.billing_cache.get(tenant_id) == CloudPlan.SANDBOX}
