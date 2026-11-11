"""Real SQL and broker tests for scheduled publication, polling, and execution."""

import logging
from collections.abc import Callable, Iterator, Sequence
from contextlib import closing
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import partial
from uuid import uuid4

import pytest
from celery import Celery
from kombu.simple import SimpleQueue
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.trigger_schedule.exc import ScheduleExecutionError, ScheduleNotFoundError
from enums import DeploymentEdition, QuotaType
from libs.datetime_utils import ensure_naive_utc
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import AppTriggerStatus, AppTriggerType
from models.trigger import AppTrigger, WorkflowSchedulePlan
from repositories.trigger.app_repository import SQLAlchemyAppTriggerRepository
from repositories.trigger.schedule_repository import TriggerScheduleRepository
from services.account_errors import AccountNotFoundError
from services.quota_service import QuotaService
from services.trigger.app_trigger_service import AppTriggerService
from services.trigger.schedule_gateway import publish_schedules
from services.trigger.schedule_service import SchedulePublicationService, TriggerScheduleService
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_app, make_workflow
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.controllers.trigger import test_webhook as native_webhook_tests
from tests.unit_tests.tasks.test_trigger_processing_tasks import _Billing, billing

__all__ = ["billing"]
application_redis = native_webhook_tests.application_redis
harness = native_webhook_tests.harness
broker = native_webhook_tests.broker
_NOW = datetime(2026, 10, 24, 8, 0, tzinfo=UTC)


@dataclass
class _Dispatch:
    calls: list[dict[str, str]] = field(default_factory=list)
    error: Exception | None = None
    connections: set[object] | None = None

    def __call__(self, *, account_id: str, tenant_id: str, app_id: str, node_id: str) -> str:
        if self.connections is not None:
            assert not self.connections
        self.calls.append({"account_id": account_id, "tenant_id": tenant_id, "app_id": app_id, "node_id": node_id})
        if self.error is not None:
            raise self.error
        return "trigger-log-id"


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> TriggerScheduleRepository:
    return TriggerScheduleRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def connections(sqlite_engine: Engine) -> Iterator[set[object]]:
    opened: set[object] = set()

    def checkout(connection: object, *_args: object) -> None:
        opened.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        opened.remove(connection)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield opened
        assert not opened
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def _plan(sessions: sessionmaker[Session], *, enabled: bool = True) -> WorkflowSchedulePlan:
    plan = WorkflowSchedulePlan(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        node_id="schedule",
        cron_expression="* * * * *",
        timezone="UTC",
        next_run_at=ensure_naive_utc(_NOW - timedelta(minutes=1)),
    )
    with sessions.begin() as session:
        session.add_all(
            [
                plan,
                AppTrigger(
                    tenant_id=plan.tenant_id,
                    app_id=plan.app_id,
                    node_id=plan.node_id,
                    trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                    title="Schedule",
                    status=AppTriggerStatus.ENABLED if enabled else AppTriggerStatus.DISABLED,
                ),
            ]
        )
    return plan


def _graph(*, node_id: str = "schedule", cron: str = "30 10 * * *") -> dict[str, object]:
    return {
        "nodes": [
            {
                "id": node_id,
                "data": {"type": "trigger-schedule", "mode": "cron", "cron_expression": cron, "timezone": "UTC"},
            }
        ]
    }


def _service(
    sessions: sessionmaker[Session],
    repository: TriggerScheduleRepository,
    dispatch: _Dispatch,
    *,
    publish: Callable[[Sequence[str]], None] = publish_schedules,
    batch_size: int = 2,
    limit: int = 0,
) -> TriggerScheduleService:
    return TriggerScheduleService(
        schedules=repository,
        publish=publish,
        dispatch=dispatch,
        reserve=partial(QuotaService.reserve, QuotaType.TRIGGER),
        mark_rate_limited=AppTriggerService(
            triggers=SQLAlchemyAppTriggerRepository(session_factory=sessions)
        ).mark_tenant_triggers_rate_limited,
        now=lambda: _NOW,
        batch_size=batch_size,
        max_dispatch_per_tick=limit,
    )


@pytest.mark.parametrize("commit", [True, False])
def test_publication_schedule_joins_callers_transaction(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
    commit: bool,
) -> None:
    tenant_id, app_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory() as session:
        service = SchedulePublicationService(
            sync_schedule=partial(repository.sync_publication, session=session), now=lambda: _NOW
        )
        service.sync(tenant_id=tenant_id, app_id=app_id, graph=_graph())
        plan = session.scalar(select(WorkflowSchedulePlan))
        assert plan is not None
        assert plan.next_run_at is not None
        assert ensure_naive_utc(plan.next_run_at) == ensure_naive_utc(_NOW.replace(hour=10, minute=30))
        assert session.in_transaction()
        if commit:
            session.commit()
        else:
            session.rollback()
    with sqlite_session_factory() as session:
        assert (session.scalar(select(WorkflowSchedulePlan.id)) is not None) == commit


def test_publication_updates_existing_plan_removes_missing_and_preserves_other_owners(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
) -> None:
    plan, foreign = _plan(sqlite_session_factory), _plan(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        foreign_plan = session.get_one(WorkflowSchedulePlan, foreign.id)
        foreign_plan.app_id = plan.app_id
        foreign_plan.node_id = "foreign-schedule"
    with sqlite_session_factory.begin() as session:
        service = SchedulePublicationService(
            sync_schedule=partial(repository.sync_publication, session=session), now=lambda: _NOW
        )
        service.sync(tenant_id=plan.tenant_id, app_id=plan.app_id, graph=_graph(node_id="updated", cron="0 12 * * *"))
    with sqlite_session_factory() as session:
        stored = session.get_one(WorkflowSchedulePlan, plan.id)
        assert stored.node_id == "updated"
        assert stored.cron_expression == "0 12 * * *"
        assert stored.next_run_at == ensure_naive_utc(_NOW.replace(hour=12))
        assert session.get_one(WorkflowSchedulePlan, foreign.id).node_id == "foreign-schedule"
    with sqlite_session_factory.begin() as session:
        SchedulePublicationService(
            sync_schedule=partial(repository.sync_publication, session=session), now=lambda: _NOW
        ).sync(tenant_id=plan.tenant_id, app_id=plan.app_id, graph={"nodes": []})
    with sqlite_session_factory() as session:
        assert session.get(WorkflowSchedulePlan, plan.id) is None
        assert session.get(WorkflowSchedulePlan, foreign.id) is not None


@pytest.mark.parametrize("mismatch", ["tenant_id", "app_id", "node_id", "type", "disabled", "not_due", "no_time"])
def test_due_claim_requires_complete_owner_chain_and_enabled_due_schedule(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
    mismatch: str,
) -> None:
    valid, decoy = _plan(sqlite_session_factory), _plan(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        trigger = session.scalar(select(AppTrigger).where(AppTrigger.app_id == decoy.app_id))
        assert trigger is not None
        if mismatch == "tenant_id":
            trigger.tenant_id = str(uuid4())
        elif mismatch == "app_id":
            trigger.app_id = str(uuid4())
        elif mismatch == "node_id":
            trigger.node_id = "other"
        elif mismatch == "type":
            trigger.trigger_type = AppTriggerType.TRIGGER_PLUGIN
        elif mismatch == "disabled":
            trigger.status = AppTriggerStatus.DISABLED
        elif mismatch == "not_due":
            session.get_one(WorkflowSchedulePlan, decoy.id).next_run_at = ensure_naive_utc(_NOW + timedelta(hours=1))
        else:
            session.get_one(WorkflowSchedulePlan, decoy.id).next_run_at = None
    with repository.claim_due(now=_NOW, limit=10) as claimed:
        assert [schedule.id for schedule in claimed.schedules] == [valid.id]


def test_poll_publishes_real_celery_tasks_and_advances_batch(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
) -> None:
    plans = [_plan(sqlite_session_factory) for _ in range(3)]
    from tasks.workflow_schedule_tasks import run_schedule_trigger

    previous = run_schedule_trigger.app
    with closing(Celery("schedule-test", broker="memory://", backend="cache+memory://")) as app:
        app.set_current()
        try:
            with (
                app.connection_for_write() as connection,
                SimpleQueue(connection.channel(), "schedule_executor") as queue,
            ):
                queue.clear()
                service = _service(sqlite_session_factory, repository, _Dispatch())
                assert service.poll() == 3
                messages = [queue.get(block=False) for _ in range(3)]
                assert {message.payload[0][0] for message in messages} == {plan.id for plan in plans}
                assert {message.headers["task"] for message in messages} == {
                    "tasks.workflow_schedule_tasks.run_schedule_trigger"
                }
                for message in messages:
                    message.ack()
                assert queue.qsize() == 0
        finally:
            previous.set_current()
    with sqlite_session_factory() as session:
        assert {plan.next_run_at for plan in session.scalars(select(WorkflowSchedulePlan))} == {
            ensure_naive_utc(_NOW + timedelta(minutes=1))
        }


def test_publish_failure_rolls_back_next_run_and_releases_claims(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
    connections: set[object],
) -> None:
    plan = _plan(sqlite_session_factory)

    def fail(_ids: Sequence[str]) -> None:
        assert connections  # The documented broker-publish consistency exception.
        raise ConnectionError("broker unavailable")

    with pytest.raises(ConnectionError, match="broker unavailable"):
        _service(sqlite_session_factory, repository, _Dispatch(), publish=fail).poll()
    assert not connections
    with sqlite_session_factory() as session:
        assert session.get_one(WorkflowSchedulePlan, plan.id).next_run_at == plan.next_run_at


@pytest.mark.parametrize("owner", [True, False])
def test_execution_resolves_owner_before_admin_and_closes_sql_before_external_calls(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
    connections: set[object],
    billing: _Billing,
    owner: bool,
) -> None:
    plan = _plan(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        admin = Account(name="Admin", email=f"{uuid4()}@example.com")
        session.add(admin)
        session.flush()
        session.add(TenantAccountJoin(tenant_id=plan.tenant_id, account_id=admin.id, role=TenantAccountRole.ADMIN))
        expected = admin.id
        if owner:
            account = Account(name="Owner", email=f"{uuid4()}@example.com")
            session.add(account)
            session.flush()
            session.add(
                TenantAccountJoin(tenant_id=plan.tenant_id, account_id=account.id, role=TenantAccountRole.OWNER)
            )
            expected = account.id
    dispatch = _Dispatch(connections=connections)
    service = _service(sqlite_session_factory, repository, dispatch)
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
        service.execute(plan.id)
    assert not connections
    assert dispatch.calls == [
        {"account_id": expected, "tenant_id": plan.tenant_id, "app_id": plan.app_id, "node_id": plan.node_id}
    ]
    assert [path for path, _ in billing.requests] == ["/quota/reserve", "/quota/commit"]


@pytest.mark.parametrize("failure", ["quota", "execution"])
def test_execution_failure_preserves_quota_and_status_policy(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
    billing: _Billing,
    failure: str,
) -> None:
    plan = _plan(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        account = Account(name="Owner", email=f"{uuid4()}@example.com")
        session.add(account)
        session.flush()
        session.add(TenantAccountJoin(tenant_id=plan.tenant_id, account_id=account.id, role=TenantAccountRole.OWNER))
    billing.exhausted = failure == "quota"
    dispatch = _Dispatch(error=RuntimeError("publish failed"))
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
        if failure == "quota":
            _service(sqlite_session_factory, repository, dispatch).execute(plan.id)
            assert dispatch.calls == []
        else:
            with pytest.raises(ScheduleExecutionError, match=f"schedule {plan.id}"):
                _service(sqlite_session_factory, repository, dispatch).execute(plan.id)
    with sqlite_session_factory() as session:
        trigger = session.scalar(select(AppTrigger).where(AppTrigger.app_id == plan.app_id))
        assert trigger is not None
        assert trigger.status == (AppTriggerStatus.RATE_LIMITED if failure == "quota" else AppTriggerStatus.ENABLED)
    assert [path for path, _ in billing.requests] == (
        ["/quota/reserve"] if failure == "quota" else ["/quota/reserve", "/quota/release"]
    )


def test_missing_schedule_or_membership_returns_precise_error(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
) -> None:
    with pytest.raises(ScheduleNotFoundError, match="not found"):
        repository.get_for_execution(str(uuid4()))
    plan = _plan(sqlite_session_factory)
    with pytest.raises(AccountNotFoundError, match=f"tenant: {plan.tenant_id}"):
        repository.get_for_execution(plan.id)


def test_tick_limit_stops_after_current_batch_and_duplicate_trigger_rows_do_not_duplicate_claims(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
) -> None:
    plans = [_plan(sqlite_session_factory) for _ in range(3)]
    with sqlite_session_factory.begin() as session:
        first = plans[0]
        session.add(
            AppTrigger(
                tenant_id=first.tenant_id,
                app_id=first.app_id,
                node_id=first.node_id,
                trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                title="Historical duplicate",
                status=AppTriggerStatus.ENABLED,
            )
        )
    from tasks.workflow_schedule_tasks import run_schedule_trigger

    previous = run_schedule_trigger.app
    with closing(Celery("schedule-tick-test", broker="memory://", backend="cache+memory://")) as app:
        app.set_current()
        try:
            with (
                app.connection_for_write() as connection,
                SimpleQueue(connection.channel(), "schedule_executor") as queue,
            ):
                queue.clear()
                assert _service(sqlite_session_factory, repository, _Dispatch(), limit=1).poll() == 2
                messages = [queue.get(block=False) for _ in range(2)]
                assert len({message.payload[0][0] for message in messages}) == 2
                for message in messages:
                    message.ack()
                assert queue.qsize() == 0
        finally:
            previous.set_current()
    with repository.claim_due(now=_NOW, limit=10) as claimed:
        assert len(claimed.schedules) == 1


def test_owner_membership_without_account_does_not_fall_back_to_admin(
    sqlite_session_factory: sessionmaker[Session],
    repository: TriggerScheduleRepository,
) -> None:
    plan = _plan(sqlite_session_factory)
    missing_account_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        admin = Account(name="Admin", email=f"{uuid4()}@example.com")
        session.add(admin)
        session.flush()
        session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=plan.tenant_id, account_id=missing_account_id, role=TenantAccountRole.OWNER
                ),
                TenantAccountJoin(tenant_id=plan.tenant_id, account_id=admin.id, role=TenantAccountRole.ADMIN),
            ]
        )
    with pytest.raises(AccountNotFoundError, match=missing_account_id):
        repository.get_for_execution(plan.id)


@pytest.mark.parametrize("commit", [True, False])
def test_wired_publication_handler_uses_the_publishers_transaction(harness: _Harness, commit: bool) -> None:
    from events.event_handlers.sync_workflow_schedule_when_app_published import handle
    from models.model import AppMode

    app_id = str(uuid4())
    app = make_app(app_id=app_id, tenant_id=harness.tenant_id, mode=AppMode.WORKFLOW)
    workflow = make_workflow(
        app_id=app_id,
        tenant_id=harness.tenant_id,
        version="published",
        graph=_graph(),
        created_by=harness.account_id,
    )
    with harness.app.app_context(), harness.session_factory() as session:
        handle(app, session=session, published_workflow=workflow)
        plan = session.scalar(select(WorkflowSchedulePlan).where(WorkflowSchedulePlan.app_id == app_id))
        assert plan is not None
        assert plan.tenant_id == harness.tenant_id
        assert plan.node_id == "schedule"
        assert plan.cron_expression == "30 10 * * *"
        assert plan.next_run_at is not None
        if commit:
            session.commit()
        else:
            session.rollback()
    with harness.session_factory() as session:
        assert (
            session.scalar(select(WorkflowSchedulePlan.id).where(WorkflowSchedulePlan.app_id == app_id)) is not None
        ) == commit


def test_wired_schedule_tasks_enqueue_workflow_with_tenant_owner(
    harness: _Harness, broker: SimpleQueue, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="services.trigger.schedule_service")
    from celery import current_app

    from models.enums import CreatorUserRole, WorkflowTriggerStatus
    from models.model import AppMode
    from models.trigger import WorkflowTriggerLog
    from schedule.workflow_schedule_task import poll_workflow_schedules
    from tasks.workflow_schedule_tasks import run_schedule_trigger

    app_id = str(uuid4())
    workflow = make_workflow(
        app_id=app_id,
        tenant_id=harness.tenant_id,
        version="published",
        graph=_graph(),
        created_by=harness.account_id,
    )
    plan = WorkflowSchedulePlan(
        tenant_id=harness.tenant_id,
        app_id=app_id,
        node_id="schedule",
        cron_expression="* * * * *",
        timezone="UTC",
        next_run_at=ensure_naive_utc(datetime.now(UTC) - timedelta(minutes=1)),
    )
    with harness.session_factory.begin() as session:
        session.add_all(
            [
                workflow,
                make_app(app_id=app_id, tenant_id=harness.tenant_id, mode=AppMode.WORKFLOW, workflow_id=workflow.id),
                plan,
                AppTrigger(
                    tenant_id=harness.tenant_id,
                    app_id=app_id,
                    node_id="schedule",
                    trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                    title="Schedule",
                    status=AppTriggerStatus.ENABLED,
                ),
            ]
        )
    with (
        harness.app.app_context(),
        current_app.connection_for_write() as connection,
        SimpleQueue(connection.channel(), "schedule_executor") as schedules,
    ):
        schedules.clear()
        try:
            poll_workflow_schedules()
            message = schedules.get(block=False)
            assert message.headers["task"] == "tasks.workflow_schedule_tasks.run_schedule_trigger"
            assert message.payload[0] == [plan.id]
            run_schedule_trigger(*message.payload[0])
            message.ack()
            assert schedules.qsize() == 0
        finally:
            schedules.clear()
    with harness.session_factory() as session:
        log = session.scalar(select(WorkflowTriggerLog).where(WorkflowTriggerLog.app_id == app_id))
        assert log is not None
        assert log.tenant_id == harness.tenant_id
        assert log.workflow_id == workflow.id
        assert log.trigger_type == AppTriggerType.TRIGGER_SCHEDULE
        assert log.root_node_id == "schedule"
        assert log.created_by == harness.account_id
        assert log.created_by_role == CreatorUserRole.ACCOUNT
        assert log.status == WorkflowTriggerStatus.QUEUED
        assert f"Schedule {plan.id} triggered workflow: {log.id}" in caplog.messages
        queued = broker.get(block=False)
        assert queued.payload[0] == [{"workflow_trigger_log_id": log.id}]
        assert queued.headers["id"] == log.celery_task_id
        queued.ack()
        assert broker.qsize() == 0
