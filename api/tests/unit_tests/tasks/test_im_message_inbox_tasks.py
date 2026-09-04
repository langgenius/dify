"""Tests for Celery-owned IM callback execution and retry."""

from datetime import UTC, datetime

import pytest
from celery.exceptions import Retry
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.im_message_inbox import IMInboxRecord, IMInboxRecordId
from core.human_input_v2.shared import IntegrationId
from dify_app import DifyApp
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox.processor import IMInboxProcessor
from tasks.im_message_inbox_tasks import (
    IMInboxRuntimeNotConfiguredError,
    IMInboxTaskRetryError,
    configure_im_inbox_task_runtime,
    process_im_message_inbox_record,
)

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)


class _RecordProcessor:
    record_ids: list[IMInboxRecordId]

    def __init__(self) -> None:
        self.record_ids = []

    def process(self, record_id: IMInboxRecordId) -> None:
        self.record_ids.append(record_id)


class _FailingRecordProcessor:
    def process(self, record_id: IMInboxRecordId) -> None:
        raise RuntimeError(f"payload must-not-log for {record_id}")


class _Consumer:
    records: list[IMInboxRecord]

    def __init__(self) -> None:
        self.records = []

    def consume(self, record: IMInboxRecord) -> None:
        self.records.append(record)


def _event() -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant-1",
        event_id="event-1",
        event_type="card.action",
        occurred_at=None,
        received_at=datetime(2026, 8, 2, 8),
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload='{"secret":"must-not-log"}',
    )


def _task_queue(task: object) -> str | None:
    queue = getattr(task, "queue", None)
    return queue if isinstance(queue, str) else None


def test_processing_task_uses_human_input_delivery_queue() -> None:
    assert _task_queue(process_im_message_inbox_record) == "human_input_delivery"


def test_processing_task_fails_closed_when_runtime_is_not_configured() -> None:
    app = DifyApp(__name__)

    with app.app_context(), pytest.raises(IMInboxRuntimeNotConfiguredError):
        process_im_message_inbox_record.run("record-1")


def test_processing_task_passes_typed_record_id_to_processor() -> None:
    app = DifyApp(__name__)
    processor = _RecordProcessor()
    configure_im_inbox_task_runtime(app, processor_factory=lambda: processor)

    with app.app_context():
        result = process_im_message_inbox_record.run("record-1")

    assert result is None
    assert processor.record_ids == [IMInboxRecordId("record-1")]


def test_processing_task_retries_sanitized_processor_failure(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = DifyApp(__name__)
    configure_im_inbox_task_runtime(app, processor_factory=_FailingRecordProcessor)
    retry_errors: list[Exception] = []

    def retry(*, exc: Exception, **_: object) -> None:
        retry_errors.append(exc)
        raise Retry()

    monkeypatch.setattr(process_im_message_inbox_record, "retry", retry)

    with app.app_context(), pytest.raises(Retry):
        process_im_message_inbox_record.run("record-1")

    assert len(retry_errors) == 1
    assert isinstance(retry_errors[0], IMInboxTaskRetryError)
    assert "must-not-log" not in caplog.text
    assert "must-not-log" not in str(retry_errors[0])


def test_processing_task_loads_callback_and_records_processed_fact(sqlite_engine: Engine) -> None:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    repository = SQLAlchemyIMMessageInboxRepository(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    consumer = _Consumer()
    processor = IMInboxProcessor(repository=repository, consumer=consumer, clock=lambda: _NOW)
    app = DifyApp(__name__)
    configure_im_inbox_task_runtime(app, processor_factory=lambda: processor)

    with app.app_context():
        process_im_message_inbox_record.run(str(accepted.record_id))

    assert len(consumer.records) == 1
    assert consumer.records[0].event == _event()
    stored = repository.get(accepted.record_id)
    assert stored is not None
    assert stored.processed_at == datetime(2026, 8, 2, 8)
