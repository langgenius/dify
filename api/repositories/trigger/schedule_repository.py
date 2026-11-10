"""Schedule persistence, including the existing transactional broker-publish lease."""

from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig
from core.workflow.nodes.trigger_schedule.exc import ScheduleNotFoundError
from libs.datetime_utils import ensure_naive_utc
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import AppTriggerStatus, AppTriggerType
from models.trigger import AppTrigger, WorkflowSchedulePlan
from services.account_errors import AccountNotFoundError
from services.trigger.schedule_store import ClaimedSchedules, ScheduleExecution, TriggerSchedule


def _record(plan: WorkflowSchedulePlan) -> TriggerSchedule:
    return TriggerSchedule(
        id=plan.id,
        tenant_id=plan.tenant_id,
        app_id=plan.app_id,
        node_id=plan.node_id,
        cron_expression=plan.cron_expression,
        timezone=plan.timezone,
        next_run_at=plan.next_run_at,
    )


@dataclass
class _ClaimedSchedules:
    _plans: Sequence[WorkflowSchedulePlan]

    @property
    def schedules(self) -> tuple[TriggerSchedule, ...]:
        return tuple(_record(plan) for plan in self._plans)

    def advance(self, next_run_times: Mapping[str, datetime]) -> None:
        for plan in self._plans:
            plan.next_run_at = ensure_naive_utc(next_run_times[plan.id])


class TriggerScheduleRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def sync_publication(
        self,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        config: ScheduleConfig | None,
        next_run_at: datetime | None,
    ) -> None:
        """Share the publisher's transaction and version-counter lock.

        Remove this explicit session once publication owns an injected unit of
        work spanning workflow data and all trigger registrations.
        """
        plan = session.scalar(
            select(WorkflowSchedulePlan).where(
                WorkflowSchedulePlan.tenant_id == tenant_id,
                WorkflowSchedulePlan.app_id == app_id,
            )
        )
        if config is None:
            if plan is not None:
                session.delete(plan)
            return
        if plan is None:
            session.add(
                WorkflowSchedulePlan(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    node_id=config.node_id,
                    cron_expression=config.cron_expression,
                    timezone=config.timezone,
                    next_run_at=ensure_naive_utc(next_run_at) if next_run_at is not None else None,
                )
            )
        else:
            plan.node_id = config.node_id
            plan.cron_expression = config.cron_expression
            plan.timezone = config.timezone
            plan.next_run_at = ensure_naive_utc(next_run_at) if next_run_at is not None else None

    @contextmanager
    def claim_due(self, *, now: datetime, limit: int) -> Generator[ClaimedSchedules]:
        """Hold SKIP LOCKED claims until next-run updates and broker publication finish.

        Broker I/O intentionally remains inside this bounded transaction: releasing
        these locks first would let another poller publish the same due schedules.
        A future transactional outbox can remove this exception. As before, a broker
        accepting the batch followed by a failed SQL commit can cause redelivery.
        """
        with self._session_factory.begin() as session:
            plans = session.scalars(
                select(WorkflowSchedulePlan)
                .where(
                    WorkflowSchedulePlan.next_run_at <= ensure_naive_utc(now),
                    select(AppTrigger.id)
                    .where(
                        AppTrigger.tenant_id == WorkflowSchedulePlan.tenant_id,
                        AppTrigger.app_id == WorkflowSchedulePlan.app_id,
                        AppTrigger.node_id == WorkflowSchedulePlan.node_id,
                        AppTrigger.trigger_type == AppTriggerType.TRIGGER_SCHEDULE,
                        AppTrigger.status == AppTriggerStatus.ENABLED,
                    )
                    .exists(),
                )
                .order_by(WorkflowSchedulePlan.next_run_at.asc())
                .with_for_update(skip_locked=True)
                .limit(limit)
            ).all()
            # EXISTS preserves the owner chain and avoids duplicate publication
            # when legacy app_triggers contains more than one matching row.
            yield _ClaimedSchedules(plans)

    def get_for_execution(self, schedule_id: str) -> ScheduleExecution:
        """Return a detached schedule and its tenant owner or admin account ID.

        Raise ScheduleNotFoundError or AccountNotFoundError when either is missing.
        """
        with self._session_factory() as session:
            schedule = session.get(WorkflowSchedulePlan, schedule_id)
            if schedule is None:
                raise ScheduleNotFoundError(f"Schedule {schedule_id} not found")
            membership = session.scalar(
                select(TenantAccountJoin)
                .where(
                    TenantAccountJoin.tenant_id == schedule.tenant_id,
                    TenantAccountJoin.role.in_([TenantAccountRole.OWNER, TenantAccountRole.ADMIN]),
                )
                .order_by(case((TenantAccountJoin.role == TenantAccountRole.OWNER, 0), else_=1))
                .limit(1)
            )
            if membership is None:
                raise AccountNotFoundError(f"Account not found for tenant: {schedule.tenant_id}")
            account_id = session.scalar(select(Account.id).where(Account.id == membership.account_id))
            if account_id is None:
                raise AccountNotFoundError(f"Account not found: {membership.account_id}")
            return ScheduleExecution(schedule=_record(schedule), account_id=account_id)
