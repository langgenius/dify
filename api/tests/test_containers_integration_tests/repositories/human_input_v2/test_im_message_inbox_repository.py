"""PostgreSQL tests for durable IM callback persistence."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.im_message_inbox import AcceptanceKind, InboxEventValidationError
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)
_RECEIVED_AT = datetime(2026, 8, 2, 8)
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000001")


def _event(
    event_id: str | None,
    *,
    tenant_id: str = "tenant-1",
    event_type: str | None = None,
) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id=tenant_id,
        event_id=event_id,
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload='{"secret":"must-not-log"}',
    )


@pytest.fixture
def postgres_context(
    db_session_with_containers: Session,
) -> tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]]:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    assert engine.dialect.name == "postgresql"
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    return engine, SQLAlchemyIMMessageInboxRepository(session_maker), session_maker


@pytest.mark.parametrize("absent_event_id", [None, "", " \t\n"])
def test_postgres_unidentified_callbacks_remain_independent(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
    absent_event_id: str | None,
) -> None:
    _, repository, session_maker = postgres_context

    first = repository.insert_or_resolve(_INTEGRATION_ID, _event(absent_event_id), now=_NOW)
    second = repository.insert_or_resolve(_INTEGRATION_ID, _event(absent_event_id), now=_NOW)

    assert first.kind is AcceptanceKind.NEW
    assert second.kind is AcceptanceKind.NEW
    assert first.record_id != second.record_id
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 2


def test_postgres_preserves_max_length_provider_metadata(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, session_maker = postgres_context
    tenant_id = "t" * 128
    event_id = "e" * 128
    event_type = "y" * 128

    accepted = repository.insert_or_resolve(
        _INTEGRATION_ID,
        _event(event_id, tenant_id=tenant_id, event_type=event_type),
        now=_NOW,
    )

    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(accepted.record_id))
        assert stored.provider_tenant_id == tenant_id
        assert stored.provider_event_id == event_id
        assert stored.provider_event_type == event_type


def test_postgres_repository_rejects_oversized_provider_metadata_before_insert(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, session_maker = postgres_context

    with pytest.raises(InboxEventValidationError):
        repository.insert_or_resolve(
            _INTEGRATION_ID,
            _event("event-1", tenant_id="t" * 129),
            now=_NOW,
        )

    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


def test_postgres_schema_rejects_oversized_provider_metadata(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, _, session_maker = postgres_context

    def insert_oversized_callback() -> None:
        with session_maker.begin() as session:
            session.add(
                IMMessageInbox(
                    integration_id=str(_INTEGRATION_ID),
                    provider=IMProvider.FEISHU,
                    provider_tenant_id="t" * 129,
                    provider_event_id="event-1",
                    received_at=_RECEIVED_AT,
                    ingress_kind=IMEventIngressKind.WEBHOOK,
                    payload="{}",
                )
            )
            session.flush()

    with pytest.raises(DataError):
        insert_oversized_callback()


def test_postgres_concurrent_identified_insert_resolves_one_record(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, session_maker = postgres_context
    barrier = Barrier(2)

    def insert_callback() -> tuple[AcceptanceKind, str]:
        barrier.wait(timeout=5)
        accepted = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-1"), now=_NOW)
        return accepted.kind, str(accepted.record_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [future.result(timeout=5) for future in [executor.submit(insert_callback) for _ in range(2)]]

    assert {kind for kind, _ in results} == {AcceptanceKind.NEW, AcceptanceKind.DUPLICATE}
    assert len({record_id for _, record_id in results}) == 1
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 1


def test_postgres_mark_processed_is_idempotent(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, _ = postgres_context
    accepted = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-1"), now=_NOW)

    repository.mark_processed(accepted.record_id, processed_at=_NOW)
    repository.mark_processed(accepted.record_id, processed_at=_NOW.replace(minute=1))

    stored = repository.get(accepted.record_id)
    assert stored is not None
    assert stored.processed_at == datetime(2026, 8, 2, 8)
