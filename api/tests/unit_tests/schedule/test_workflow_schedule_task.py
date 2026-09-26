"""The schedule poller dispatches every due plan whose next run it can calculate."""

import logging
from collections.abc import Callable, Iterable
from contextlib import nullcontext
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytz
from celery.canvas import Signature
from croniter import CroniterBadCronError
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from libs.schedule_utils import calculate_next_run_at
from models.enums import AppTriggerType
from models.trigger import AppTrigger, WorkflowSchedulePlan
from schedule import workflow_schedule_task


@pytest.fixture
def dispatched_schedule_ids(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> list[str]:
    """Bind the poller to the SQLite database and record the schedule ids it dispatches instead of publishing."""
    dispatched: list[str] = []

    def group(signatures: Iterable[Signature[None]]) -> SimpleNamespace:
        schedule_ids = [signature.args[0] for signature in signatures]
        return SimpleNamespace(apply_async=lambda **_options: dispatched.extend(schedule_ids))

    monkeypatch.setattr(workflow_schedule_task, "db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(workflow_schedule_task, "current_app", SimpleNamespace(producer_or_acquire=nullcontext))
    monkeypatch.setattr(workflow_schedule_task, "group", group)
    return dispatched


def _add_due_plan(session: Session, *, timezone: str, next_run_at: datetime) -> WorkflowSchedulePlan:
    tenant_id, app_id, node_id = str(uuid4()), str(uuid4()), "schedule"
    session.add(
        AppTrigger(
            tenant_id=tenant_id,
            app_id=app_id,
            node_id=node_id,
            trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
            title="Schedule",
        )
    )
    plan = WorkflowSchedulePlan(
        app_id=app_id,
        node_id=node_id,
        tenant_id=tenant_id,
        cron_expression="*/5 * * * *",
        timezone=timezone,
        next_run_at=next_run_at,
    )
    session.add(plan)
    session.commit()
    return plan


BROKEN_TIMEZONE = "Invalid/Timezone"


def _fail_poll_after_calculations(
    monkeypatch: pytest.MonkeyPatch, limit: int, broken_timezone_error: Exception | None = None
) -> None:
    """Fail a poll that calculates more than `limit` next runs, so a poll that never ends fails instead of hanging.

    With `broken_timezone_error`, calculating a next run in BROKEN_TIMEZONE raises it instead.
    """
    calculations = 0

    def bounded_calculate_next_run_at(cron_expression: str, timezone: str) -> datetime:
        nonlocal calculations
        calculations += 1
        if calculations > limit:
            pytest.fail(f"The poll calculated more than {limit} next runs without ending")
        if broken_timezone_error is not None and timezone == BROKEN_TIMEZONE:
            raise broken_timezone_error
        return calculate_next_run_at(cron_expression, timezone)

    monkeypatch.setattr(workflow_schedule_task, "calculate_next_run_at", bounded_calculate_next_run_at)


# Any error from the calculation skips the plan, not only the UnknownTimeZoneError an unknown zone name raises.
@pytest.mark.parametrize(
    "broken_timezone_error",
    [
        AssertionError("croniter assumed a positive DST offset"),
        CroniterBadCronError("invalid cron expression"),
        pytz.UnknownTimeZoneError(BROKEN_TIMEZONE),
    ],
    ids=["assertion-error", "croniter-value-error", "unknown-timezone-error"],
)
@pytest.mark.parametrize("batch_size", [100, 1], ids=["same-batch", "own-batch"])
def test_plan_whose_next_run_cannot_be_calculated_does_not_block_other_due_plans(
    batch_size: int,
    broken_timezone_error: Exception,
    dispatched_schedule_ids: list[str],
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE=batch_size)
    caplog.set_level(logging.WARNING, logger=workflow_schedule_task.logger.name)
    now = naive_utc_now()
    # The poll sees the same time as the test, so every plan below is due however long the test takes.
    monkeypatch.setattr(workflow_schedule_task, "naive_utc_now", lambda: now)
    # Due plans are fetched most overdue first, so the raising plan comes between the two UTC plans; with a batch
    # size of 1 each plan fills a batch alone.
    utc_before = _add_due_plan(sqlite_session, timezone="UTC", next_run_at=now - timedelta(minutes=15))
    broken_due_at = now - timedelta(minutes=10)
    broken = _add_due_plan(sqlite_session, timezone=BROKEN_TIMEZONE, next_run_at=broken_due_at)
    utc_after = _add_due_plan(sqlite_session, timezone="UTC", next_run_at=now - timedelta(minutes=5))
    # A poll calculates the next run of each of the 3 due plans once.
    _fail_poll_after_calculations(monkeypatch, limit=3, broken_timezone_error=broken_timezone_error)

    workflow_schedule_task.poll_workflow_schedules.run()

    assert dispatched_schedule_ids == [utc_before.id, utc_after.id]
    sqlite_session.expire_all()
    for utc in (utc_before, utc_after):
        utc_next_run_at = utc.next_run_at
        assert utc_next_run_at is not None
        assert utc_next_run_at > now
    # Skipped for this poll only: it stays due, so the next poll tries it again.
    assert broken.next_run_at == broken_due_at
    assert any(broken.id in record.getMessage() for record in caplog.records)


def test_poll_skips_and_logs_each_plan_whose_next_run_cannot_be_calculated_once(
    dispatched_schedule_ids: list[str],
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE=1)
    caplog.set_level(logging.WARNING, logger=workflow_schedule_task.logger.name)
    now = naive_utc_now()
    monkeypatch.setattr(workflow_schedule_task, "naive_utc_now", lambda: now)
    broken_due_at = [now - timedelta(minutes=10), now - timedelta(minutes=5)]
    broken = [_add_due_plan(sqlite_session, timezone=BROKEN_TIMEZONE, next_run_at=due_at) for due_at in broken_due_at]
    # A poll calculates the next run of each of the 2 due plans once. If a skipped plan came back, the two would fill
    # the batches in turn and the poll would never end.
    _fail_poll_after_calculations(monkeypatch, limit=2)

    workflow_schedule_task.poll_workflow_schedules.run()

    assert dispatched_schedule_ids == []
    sqlite_session.expire_all()
    assert [plan.next_run_at for plan in broken] == broken_due_at
    for plan in broken:
        assert sum(plan.id in record.getMessage() for record in caplog.records) == 1
