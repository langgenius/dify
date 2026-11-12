"""Real PostgreSQL execution coverage for transactional schedule claims."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import ensure_naive_utc
from models.enums import AppTriggerStatus, AppTriggerType
from models.trigger import AppTrigger, WorkflowSchedulePlan
from repositories.trigger.schedule_repository import TriggerScheduleRepository


def test_concurrent_claims_skip_locked_plans_and_rollback_releases_them(db_session_with_containers: Session) -> None:
    now = datetime.now(UTC)
    plans = [
        WorkflowSchedulePlan(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            node_id="schedule",
            cron_expression="* * * * *",
            timezone="UTC",
            next_run_at=ensure_naive_utc(now - timedelta(minutes=2 - index)),
        )
        for index in range(2)
    ]
    for plan in plans:
        db_session_with_containers.add_all(
            [
                plan,
                AppTrigger(
                    tenant_id=plan.tenant_id,
                    app_id=plan.app_id,
                    node_id=plan.node_id,
                    trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                    title="Due schedule",
                    status=AppTriggerStatus.ENABLED,
                ),
            ]
        )
    db_session_with_containers.commit()
    factory = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    repository = TriggerScheduleRepository(session_factory=factory)
    with repository.claim_due(now=now, limit=1) as first:
        assert [record.id for record in first.schedules] == [plans[0].id]
        try:
            with repository.claim_due(now=now, limit=2) as second:
                assert [record.id for record in second.schedules] == [plans[1].id]
                second.advance({plans[1].id: now + timedelta(hours=1)})
                raise ConnectionError("broker unavailable")
        except ConnectionError:
            pass
        first.advance({plans[0].id: now + timedelta(hours=1)})
    with repository.claim_due(now=now, limit=2) as remaining:
        assert [record.id for record in remaining.schedules] == [plans[1].id]
    with factory() as session:
        updated = session.scalar(select(WorkflowSchedulePlan).where(WorkflowSchedulePlan.id == plans[0].id))
        assert updated is not None
        assert updated.next_run_at == ensure_naive_utc(now + timedelta(hours=1))
