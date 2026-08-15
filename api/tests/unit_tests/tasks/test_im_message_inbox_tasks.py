"""Tests for payload-free IM inbox Celery boundaries."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_message_inbox import (
    ConsumerDecision,
    IMInboxDelivery,
    IMInboxRecordId,
    InboxProcessingPolicy,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.shared import IntegrationId
from dify_app import DifyApp
from extensions.ext_celery import init_app as init_celery_app
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox import (
    IMInboxWorker,
    InboxWorkerOutcome,
    NoopIMInboxMetrics,
    RenewableLeaseHeartbeat,
)
from services.human_input_v2.im_message_inbox.wakeup import InboxWakeupError
from tasks.im_message_inbox_tasks import (
    CeleryIMInboxWakeup,
    IMInboxRuntimeNotConfiguredError,
    configure_im_inbox_task_runtime,
    process_im_message_inbox_record,
    recover_im_message_inbox,
)


class _RecordTask:
    calls: list[tuple[tuple[str, ...], bool]]
    failure: RuntimeError | None

    def __init__(self, *, failure: RuntimeError | None = None) -> None:
        self.calls = []
        self.failure = failure

    def apply_async(self, args: tuple[str, ...], *, retry: bool) -> object:
        self.calls.append((args, retry))
        if self.failure is not None:
            raise self.failure
        return object()


class _RecordProcessor:
    record_ids: list[IMInboxRecordId]

    def __init__(self) -> None:
        self.record_ids = []

    def process(self, record_id: IMInboxRecordId) -> InboxWorkerOutcome:
        self.record_ids.append(record_id)
        return InboxWorkerOutcome.SUCCEEDED


class _Consumer:
    deliveries: list[IMInboxDelivery]

    def __init__(self) -> None:
        self.deliveries = []

    def consume(self, delivery: IMInboxDelivery) -> ConsumerDecision:
        self.deliveries.append(delivery)
        return ConsumerDecision.SUCCEEDED


class _FixedClock:
    current: datetime

    def __init__(self, current: datetime) -> None:
        self.current = current

    def now(self) -> datetime:
        return self.current


class _Recovery:
    calls: int

    def __init__(self) -> None:
        self.calls = 0

    def dispatch_available(self) -> object:
        self.calls += 1
        return object()


def _task_queue(task: object) -> str | None:
    # Celery exposes routing options dynamically, outside its declared Task interface.
    queue = getattr(task, "queue", None)
    return queue if isinstance(queue, str) else None


def test_processing_task_uses_the_deployed_human_input_queue() -> None:
    assert _task_queue(process_im_message_inbox_record) == "human_input_delivery"


def test_celery_wakeup_publishes_one_record_id_without_broker_retries() -> None:
    record_task = _RecordTask()
    wakeup = CeleryIMInboxWakeup(record_task)

    wakeup.publish(IMInboxRecordId("record-1"))

    assert record_task.calls == [(("record-1",), False)]


def test_celery_wakeup_maps_broker_failure_to_sanitized_error() -> None:
    record_task = _RecordTask(failure=RuntimeError("credential must-not-log"))
    wakeup = CeleryIMInboxWakeup(record_task)

    with pytest.raises(InboxWakeupError) as error:
        wakeup.publish(IMInboxRecordId("record-1"))

    assert "must-not-log" not in str(error.value)
    assert record_task.calls == [(("record-1",), False)]


def test_processing_task_fails_closed_before_claim_when_runtime_is_not_configured() -> None:
    app = DifyApp(__name__)

    with app.app_context(), pytest.raises(IMInboxRuntimeNotConfiguredError):
        process_im_message_inbox_record.run("record-1")


def test_processing_task_passes_only_typed_record_id_to_configured_processor() -> None:
    app = DifyApp(__name__)
    processor = _RecordProcessor()
    configure_im_inbox_task_runtime(app, processor_factory=lambda: processor)

    with app.app_context():
        outcome = process_im_message_inbox_record.run("record-1")

    assert outcome == InboxWorkerOutcome.SUCCEEDED.value
    assert processor.record_ids == [IMInboxRecordId("record-1")]


def test_processing_task_runs_repository_backed_worker_and_fenced_finalizes(sqlite_engine: Engine) -> None:
    now = datetime(2026, 8, 2, 8, tzinfo=UTC)
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    lease_duration = timedelta(seconds=30)
    repository = SQLAlchemyIMMessageInboxRepository(
        session_maker,
        InboxProcessingPolicy(
            maximum_attempts=3,
            lease_duration=lease_duration,
            retry_backoff_minimum=timedelta(seconds=5),
            retry_backoff_maximum=timedelta(seconds=20),
        ),
    )
    event = AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant-1",
        event_id="event-1",
        event_type="card.action",
        occurred_at=None,
        received_at=datetime(2026, 8, 2, 8),
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=' {"secret":"must-not-leave-the-database"}\n',
    )
    record_id = repository.insert_or_resolve(IntegrationId("integration-1"), event, now=now).record_id
    consumer = _Consumer()
    clock = _FixedClock(now)
    worker = IMInboxWorker(
        repository=repository,
        consumer=consumer,
        clock=clock,
        heartbeat=RenewableLeaseHeartbeat(
            repository=repository,
            clock=clock,
            heartbeat_interval=timedelta(seconds=10),
        ),
        metrics=NoopIMInboxMetrics(),
    )
    app = DifyApp(__name__)
    configure_im_inbox_task_runtime(app, processor_factory=lambda: worker)

    with app.app_context():
        outcome = process_im_message_inbox_record.run(str(record_id))

    assert outcome == InboxWorkerOutcome.SUCCEEDED.value
    assert len(consumer.deliveries) == 1
    assert consumer.deliveries[0].record_id == record_id
    assert consumer.deliveries[0].integration_id == IntegrationId("integration-1")
    assert consumer.deliveries[0].event == event
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(record_id))
        assert stored.status.value == "succeeded"
        assert stored.completed_at == datetime(2026, 8, 2, 8)
        assert stored.claim_token is None
        assert stored.lease_expires_at is None


def test_recovery_task_fails_closed_before_scan_when_runtime_is_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = DifyApp(__name__)

    def fail_if_recovery_is_built() -> _Recovery:
        raise AssertionError("recovery must not scan without a configured processor")

    monkeypatch.setattr("tasks.im_message_inbox_tasks._build_recovery", fail_if_recovery_is_built)

    with app.app_context(), pytest.raises(IMInboxRuntimeNotConfiguredError):
        recover_im_message_inbox.run()


def test_recovery_task_delegates_to_concrete_recovery_builder(monkeypatch: pytest.MonkeyPatch) -> None:
    recovery = _Recovery()
    monkeypatch.setattr("tasks.im_message_inbox_tasks._build_recovery", lambda: recovery)
    app = DifyApp(__name__)
    configure_im_inbox_task_runtime(app, processor_factory=_RecordProcessor)

    with app.app_context():
        recover_im_message_inbox.run()

    assert recovery.calls == 1


def test_celery_app_schedules_bounded_im_inbox_recovery(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("extensions.ext_celery.setup_workflow_warm_shutdown_handler", lambda: None)
    app = DifyApp(__name__)

    celery_app = init_celery_app(app)

    assert "tasks.im_message_inbox_tasks" in celery_app.conf.imports
    assert celery_app.conf.beat_schedule["im_message_inbox_recovery"] == {
        "task": "im_message_inbox.recover",
        "schedule": timedelta(seconds=dify_config.IM_MESSAGE_INBOX_RECOVERY_INTERVAL_SECONDS),
    }
