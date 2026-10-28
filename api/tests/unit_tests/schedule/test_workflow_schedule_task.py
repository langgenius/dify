import uuid
from datetime import datetime

from models.trigger import AppTrigger, AppTriggerStatus, AppTriggerType, WorkflowSchedulePlan
from schedule.workflow_schedule_task import _fetch_due_schedules


def _add_due_schedule_with_triggers(session, *, duplicate_trigger_count: int, trigger_status=AppTriggerStatus.ENABLED):
    tenant_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    node_id = "schedule-node"
    plan = WorkflowSchedulePlan(
        tenant_id=tenant_id,
        app_id=app_id,
        node_id=node_id,
        cron_expression="*/10 * * * *",
        timezone="UTC",
        next_run_at=datetime(2020, 1, 1),
    )
    session.add(plan)
    for index in range(duplicate_trigger_count):
        session.add(
            AppTrigger(
                tenant_id=tenant_id,
                app_id=app_id,
                node_id=node_id,
                trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                title=f"schedule trigger {index}",
                status=trigger_status,
            )
        )
    session.commit()
    return plan


def test_due_schedule_returned_once_with_duplicate_app_trigger_rows(sqlite_session_factory):
    """Concurrent publishes can insert duplicate AppTrigger rows for the same node.

    The due-schedule query must return the plan once, not once per duplicate row.
    """
    with sqlite_session_factory() as session:
        plan = _add_due_schedule_with_triggers(session, duplicate_trigger_count=2)

    with sqlite_session_factory() as session:
        due_schedules = _fetch_due_schedules(session)

    assert [schedule.id for schedule in due_schedules] == [plan.id]


def test_disabled_trigger_does_not_dispatch_schedule(sqlite_session_factory):
    with sqlite_session_factory() as session:
        _add_due_schedule_with_triggers(session, duplicate_trigger_count=1, trigger_status=AppTriggerStatus.DISABLED)

    with sqlite_session_factory() as session:
        due_schedules = _fetch_due_schedules(session)

    assert due_schedules == []
