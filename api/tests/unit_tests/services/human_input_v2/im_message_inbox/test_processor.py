"""Tests for processing one durable IM callback."""

from datetime import UTC, datetime

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.im_message_inbox import IMInboxRecord, IMInboxRecordId
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox.processor import IMInboxProcessor

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)


class _Consumer:
    records: list[IMInboxRecord]

    def __init__(self, *, failure: Exception | None = None) -> None:
        self.records = []
        self._failure = failure

    def consume(self, record: IMInboxRecord) -> None:
        self.records.append(record)
        if self._failure is not None:
            raise self._failure


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


def _context(
    sqlite_engine: Engine, *, failure: Exception | None = None
) -> tuple[IMInboxProcessor, SQLAlchemyIMMessageInboxRepository, _Consumer]:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    repository = SQLAlchemyIMMessageInboxRepository(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    consumer = _Consumer(failure=failure)
    processor = IMInboxProcessor(repository=repository, consumer=consumer, clock=lambda: _NOW)
    return processor, repository, consumer


def test_processor_loads_callback_and_marks_it_processed(sqlite_engine: Engine) -> None:
    processor, repository, consumer = _context(sqlite_engine)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)

    processor.process(accepted.record_id)

    assert len(consumer.records) == 1
    assert consumer.records[0].event == _event()
    stored = repository.get(accepted.record_id)
    assert stored is not None
    assert stored.processed_at == datetime(2026, 8, 2, 8)


def test_processor_skips_already_processed_callback(sqlite_engine: Engine) -> None:
    processor, repository, consumer = _context(sqlite_engine)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    repository.mark_processed(accepted.record_id, processed_at=_NOW)

    processor.process(accepted.record_id)

    assert consumer.records == []


def test_processor_leaves_callback_unprocessed_when_consumer_raises(sqlite_engine: Engine) -> None:
    processor, repository, consumer = _context(sqlite_engine, failure=RuntimeError("must-not-log"))
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)

    with pytest.raises(RuntimeError, match="must-not-log"):
        processor.process(accepted.record_id)

    assert len(consumer.records) == 1
    stored = repository.get(accepted.record_id)
    assert stored is not None
    assert stored.processed_at is None


def test_processor_treats_missing_callback_as_idempotent_noop(sqlite_engine: Engine) -> None:
    processor, _, consumer = _context(sqlite_engine)

    processor.process(IMInboxRecordId("missing"))

    assert consumer.records == []
