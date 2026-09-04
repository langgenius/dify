"""SQLite-backed tests for durable IM callback persistence."""

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.im_message_inbox import (
    AcceptanceKind,
    IMInboxRecordId,
    InboxEventValidationError,
    InboxPersistenceError,
)
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)
_RECEIVED_AT = datetime(2026, 8, 2, 8)
_PAYLOAD = ' {"secret":"must-not-log"}\n'


def _event(
    event_id: str | None = "event-1",
    *,
    provider: IMProvider = IMProvider.FEISHU,
    tenant_id: str = "tenant-1",
    event_type: str | None = "card.action",
    ingress_kind: IMEventIngressKind = IMEventIngressKind.WEBHOOK,
    payload: str = _PAYLOAD,
) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id=tenant_id,
        event_id=event_id,
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=ingress_kind,
        payload=payload,
    )


def _repository(sqlite_engine: Engine) -> tuple[SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]]:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    return SQLAlchemyIMMessageInboxRepository(session_maker), session_maker


def test_unidentified_callbacks_create_independent_records(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)

    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event(None), now=_NOW)
    second = repository.insert_or_resolve(IntegrationId("integration-1"), _event(None), now=_NOW)

    assert first.kind is AcceptanceKind.NEW
    assert second.kind is AcceptanceKind.NEW
    assert first.record_id != second.record_id
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 2


@pytest.mark.parametrize("blank_event_id", ["", " \t\n", " " * 129])
def test_blank_event_id_is_persisted_as_unidentified(sqlite_engine: Engine, blank_event_id: str) -> None:
    repository, session_maker = _repository(sqlite_engine)

    repository.insert_or_resolve(IntegrationId("integration-1"), _event(blank_event_id), now=_NOW)

    with session_maker() as session:
        stored = session.scalar(sa.select(IMMessageInbox))
        assert stored is not None
        assert stored.provider_event_id is None


def test_identified_duplicate_resolves_same_record_without_mutating_callback_facts(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    first_event = _event(ingress_kind=IMEventIngressKind.WEBHOOK, payload='{"source":"webhook"}')
    duplicate_event = _event(ingress_kind=IMEventIngressKind.STREAM, payload='{"source":"stream"}')

    first = repository.insert_or_resolve(IntegrationId("integration-1"), first_event, now=_NOW)
    duplicate = repository.insert_or_resolve(IntegrationId("integration-2"), duplicate_event, now=_NOW)

    assert first.kind is AcceptanceKind.NEW
    assert duplicate.kind is AcceptanceKind.DUPLICATE
    assert duplicate.record_id == first.record_id
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(first.record_id))
        assert stored.integration_id == "integration-1"
        assert stored.ingress_kind is IMEventIngressKind.WEBHOOK
        assert stored.payload == first_event.payload


def test_load_reconstructs_callback_facts(sqlite_engine: Engine) -> None:
    repository, _ = _repository(sqlite_engine)
    event = _event()
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), event, now=_NOW)

    record = repository.get(accepted.record_id)

    assert record is not None
    assert record.record_id == accepted.record_id
    assert record.integration_id == IntegrationId("integration-1")
    assert record.event == event
    assert record.processed_at is None


def test_mark_processed_records_callback_fact_and_is_idempotent(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    processed_at = _NOW.replace(minute=1)

    repository.mark_processed(accepted.record_id, processed_at=processed_at)
    repository.mark_processed(accepted.record_id, processed_at=_NOW.replace(minute=2))

    record = repository.get(accepted.record_id)
    assert record is not None
    assert record.processed_at == datetime(2026, 8, 2, 8, 1)
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(accepted.record_id))
        assert stored.processed_at == datetime(2026, 8, 2, 8, 1)


def test_mark_processed_rejects_missing_record(sqlite_engine: Engine) -> None:
    repository, _ = _repository(sqlite_engine)

    with pytest.raises(InboxPersistenceError, match="does not exist"):
        repository.mark_processed(IMInboxRecordId("missing"), processed_at=_NOW)


@pytest.mark.parametrize(
    ("tenant_id", "event_id", "event_type", "field_name"),
    [
        ("t" * 129, "event-1", "card.action", "provider tenant id"),
        ("tenant-1", "e" * 129, "card.action", "provider event id"),
        ("tenant-1", "event-1", "y" * 129, "provider event type"),
    ],
)
def test_repository_rejects_oversized_callback_metadata(
    sqlite_engine: Engine,
    tenant_id: str,
    event_id: str,
    event_type: str,
    field_name: str,
) -> None:
    repository, session_maker = _repository(sqlite_engine)

    with pytest.raises(InboxEventValidationError, match=field_name):
        repository.insert_or_resolve(
            IntegrationId("integration-1"),
            _event(event_id, tenant_id=tenant_id, event_type=event_type),
            now=_NOW,
        )

    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


def test_transaction_commit_failure_rolls_back_callback(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)

    def fail_commit(_connection: sa.Connection) -> None:
        raise OperationalError("COMMIT", {}, RuntimeError("credential must-not-escape"))

    sqlalchemy_event.listen(sqlite_engine, "commit", fail_commit)
    try:
        with pytest.raises(InboxPersistenceError) as error:
            repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    finally:
        sqlalchemy_event.remove(sqlite_engine, "commit", fail_commit)

    assert "must-not-escape" not in str(error.value)
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0
