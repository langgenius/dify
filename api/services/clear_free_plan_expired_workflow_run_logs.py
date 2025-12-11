import datetime
import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import click
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from models import WorkflowAppLog, WorkflowNodeExecutionModel, WorkflowRun
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowNodeExecutionOffload, WorkflowPause, WorkflowPauseReason
from services.billing_service import BillingService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkflowRunRow:
    id: str
    tenant_id: str
    created_at: datetime.datetime


class WorkflowRunCleanup:
    def __init__(
        self,
        days: int,
        batch_size: int,
        start_after: datetime.datetime | None = None,
        end_before: datetime.datetime | None = None,
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
            with Session(db.engine) as session:
                run_rows = self._load_batch(session, last_seen)
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
                            f"[batch #{batch_index}] skipped (no sandbox runs in batch, {paid_or_skipped} paid)",
                            fg="yellow",
                        )
                    )
                    continue

                try:
                    counts = self._delete_runs(session, free_run_ids)
                    session.commit()
                except Exception:
                    session.rollback()
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

    def _load_batch(
        self, session: Session, last_seen: tuple[datetime.datetime, str] | None
    ) -> list[WorkflowRunRow]:
        stmt = (
            select(WorkflowRun.id, WorkflowRun.tenant_id, WorkflowRun.created_at)
            .where(WorkflowRun.created_at < self.window_end)
            .order_by(WorkflowRun.created_at.asc(), WorkflowRun.id.asc())
            .limit(self.batch_size)
        )

        if self.window_start:
            stmt = stmt.where(WorkflowRun.created_at >= self.window_start)

        if last_seen:
            stmt = stmt.where(
                sa.or_(
                    WorkflowRun.created_at > last_seen[0],
                    sa.and_(WorkflowRun.created_at == last_seen[0], WorkflowRun.id > last_seen[1]),
                )
            )

        rows = session.execute(stmt).all()
        return [WorkflowRunRow(id=row.id, tenant_id=row.tenant_id, created_at=row.created_at) for row in rows]

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
                        raw_plan = info.get("subscription", {}).get("plan")
                        plan = CloudPlan(raw_plan)
                    except Exception:
                        logger.exception("Failed to parse billing plan for tenant %s", tenant_id)
                else:
                    logger.warning("Missing billing info for tenant %s in bulk resp; treating as non-free", tenant_id)

                self.billing_cache[tenant_id] = plan

        return {tenant_id for tenant_id in tenant_id_list if self.billing_cache.get(tenant_id) == CloudPlan.SANDBOX}

    def _delete_runs(self, session: Session, workflow_run_ids: Sequence[str]) -> dict[str, int]:
        node_execution_ids = session.scalars(
            select(WorkflowNodeExecutionModel.id).where(WorkflowNodeExecutionModel.workflow_run_id.in_(workflow_run_ids))
        ).all()

        offloads_deleted = 0
        if node_execution_ids:
            offloads_deleted = (
                session.query(WorkflowNodeExecutionOffload)
                .where(WorkflowNodeExecutionOffload.node_execution_id.in_(node_execution_ids))
                .delete(synchronize_session=False)
            )

        node_executions_deleted = 0
        if node_execution_ids:
            node_executions_deleted = (
                session.query(WorkflowNodeExecutionModel)
                .where(WorkflowNodeExecutionModel.id.in_(node_execution_ids))
                .delete(synchronize_session=False)
            )

        app_logs_deleted = (
            session.query(WorkflowAppLog)
            .where(WorkflowAppLog.workflow_run_id.in_(workflow_run_ids))
            .delete(synchronize_session=False)
        )

        pause_ids = session.scalars(
            select(WorkflowPause.id).where(WorkflowPause.workflow_run_id.in_(workflow_run_ids))
        ).all()
        pause_reasons_deleted = 0
        pauses_deleted = 0

        if pause_ids:
            pause_reasons_deleted = (
                session.query(WorkflowPauseReason).where(WorkflowPauseReason.pause_id.in_(pause_ids)).delete(
                    synchronize_session=False
                )
            )
            pauses_deleted = (
                session.query(WorkflowPause)
                .where(WorkflowPause.id.in_(pause_ids))
                .delete(synchronize_session=False)
            )

        trigger_logs_deleted = (
            session.query(WorkflowTriggerLog)
            .where(WorkflowTriggerLog.workflow_run_id.in_(workflow_run_ids))
            .delete(synchronize_session=False)
        )

        runs_deleted = (
            session.query(WorkflowRun).where(WorkflowRun.id.in_(workflow_run_ids)).delete(synchronize_session=False)
        )

        return {
            "runs": runs_deleted,
            "node_executions": node_executions_deleted,
            "offloads": offloads_deleted,
            "app_logs": app_logs_deleted,
            "trigger_logs": trigger_logs_deleted,
            "pauses": pauses_deleted,
            "pause_reasons": pause_reasons_deleted,
        }
