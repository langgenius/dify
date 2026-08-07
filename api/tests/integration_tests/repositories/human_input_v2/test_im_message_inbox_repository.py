"""PostgreSQL acceptance tests for IM inbox transaction and locking semantics."""

from __future__ import annotations

import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Lock

import pytest
import sqlalchemy as sa
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DataError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_message_inbox import (
    AcceptanceKind,
    IMInboxRecordId,
    InboxClaimOrigin,
    InboxEventValidationError,
    LostLease,
    TransitionApplied,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent
from core.human_input_v2.shared import IntegrationId, UtcTimestamp
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox import IMInboxRecovery, NoopIMInboxMetrics, RecoveryDispatchResult

_NOW = UtcTimestamp(datetime(2026, 8, 2, 8, tzinfo=UTC))
_RECEIVED_AT = datetime(2026, 8, 2, 8)
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000001")
_POSTGRES_SESSION_TIMEZONE = "UTC"


class _ThreadSafeWakeup:
    _lock: Lock
    _record_ids: list[IMInboxRecordId]

    def __init__(self) -> None:
        self._lock = Lock()
        self._record_ids = []

    def publish(self, record_id: IMInboxRecordId) -> None:
        with self._lock:
            self._record_ids.append(record_id)

    def record_ids(self) -> tuple[IMInboxRecordId, ...]:
        with self._lock:
            return tuple(self._record_ids)


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
        payload=' {"secret":"must-not-log"}\n',
    )


def _insert_then_rollback(session_maker: sessionmaker[Session]) -> None:
    with session_maker.begin() as session:
        session.add(
            IMMessageInbox(
                integration_id=str(_INTEGRATION_ID),
                provider=IMProvider.FEISHU,
                provider_tenant_id="tenant-1",
                provider_event_id="rolled-back",
                received_at=_RECEIVED_AT,
                raw_payload="{}",
            )
        )
        session.flush()
        raise RuntimeError("rollback")


@pytest.fixture
def postgres_context() -> Iterator[tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]]]:
    dsn = os.environ.get("DIFY_IM_INBOX_TEST_DSN")
    if dsn is None:
        pytest.skip("DIFY_IM_INBOX_TEST_DSN is required for PostgreSQL inbox acceptance tests")
    normalized_dsn = dsn.replace("postgres://", "postgresql+psycopg://", 1)
    engine = sa.create_engine(
        normalized_dsn,
        pool_size=8,
        max_overflow=0,
        connect_args={
            "connect_timeout": 3,
            "options": f"-c timezone={_POSTGRES_SESSION_TIMEZONE}",
        },
    )
    try:
        with engine.connect() as connection:
            session_timezone = connection.scalar(sa.text("SHOW TIME ZONE"))
    except OperationalError:
        engine.dispose()
        raise AssertionError("PostgreSQL inbox test database is unavailable") from None
    assert session_timezone == _POSTGRES_SESSION_TIMEZONE
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.drop_all(engine, tables=[inbox_table], checkfirst=True)
    IMMessageInbox.metadata.create_all(engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    repository = SQLAlchemyIMMessageInboxRepository(session_maker)
    try:
        yield engine, repository, session_maker
    finally:
        IMMessageInbox.metadata.drop_all(engine, tables=[inbox_table], checkfirst=True)
        engine.dispose()


def test_postgres_nullable_unique_and_transaction_rollback(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, session_maker = postgres_context
    first = repository.insert_or_resolve(_INTEGRATION_ID, _event(None), now=_NOW)
    second = repository.insert_or_resolve(_INTEGRATION_ID, _event(None), now=_NOW)

    with pytest.raises(RuntimeError, match="rollback"):
        _insert_then_rollback(session_maker)

    assert first.record_id != second.record_id
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 2


def test_postgres_preserves_max_length_provider_metadata(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, session_maker = postgres_context
    maximum_tenant_id = "t" * 128
    maximum_event_id = "e" * 128
    maximum_event_type = "y" * 128

    accepted = repository.insert_or_resolve(
        _INTEGRATION_ID,
        _event(maximum_event_id, tenant_id=maximum_tenant_id, event_type=maximum_event_type),
        now=_NOW,
    )

    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(accepted.record_id))
        assert stored.provider_tenant_id == maximum_tenant_id
        assert stored.provider_event_id == maximum_event_id
        assert stored.provider_event_type == maximum_event_type


@pytest.mark.parametrize(
    ("tenant_id", "event_id", "event_type", "field_name"),
    [
        ("t" * 129, "event-1", None, "provider tenant id"),
        ("tenant-1", "e" * 129, None, "provider event id"),
        ("tenant-1", "event-1", "y" * 129, "provider event type"),
    ],
)
def test_postgres_repository_rejects_oversized_provider_metadata_before_insert(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
    tenant_id: str,
    event_id: str,
    event_type: str | None,
    field_name: str,
) -> None:
    _, repository, session_maker = postgres_context

    with pytest.raises(InboxEventValidationError, match=field_name):
        repository.insert_or_resolve(
            _INTEGRATION_ID,
            _event(event_id, tenant_id=tenant_id, event_type=event_type),
            now=_NOW,
        )

    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


@pytest.mark.parametrize(
    ("tenant_id", "event_id", "event_type"),
    [
        ("t" * 129, "event-1", None),
        ("tenant-1", "e" * 129, None),
        ("tenant-1", "event-1", "y" * 129),
    ],
)
def test_postgres_schema_rejects_oversized_provider_metadata(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
    tenant_id: str,
    event_id: str,
    event_type: str | None,
) -> None:
    _, _, session_maker = postgres_context

    with pytest.raises(DataError), session_maker.begin() as session:
        session.add(
            IMMessageInbox(
                integration_id=str(_INTEGRATION_ID),
                provider=IMProvider.FEISHU,
                provider_tenant_id=tenant_id,
                provider_event_id=event_id,
                received_at=_RECEIVED_AT,
                provider_event_type=event_type,
                raw_payload="{}",
            )
        )


def test_postgres_concurrent_identified_insert_resolves_one_durable_record(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    engine, repository, session_maker = postgres_context
    insert_barrier = Barrier(2)

    def overlap_identified_inserts(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().startswith("INSERT INTO im_message_inbox"):
            insert_barrier.wait(timeout=5)

    sqlalchemy_event.listen(engine, "before_cursor_execute", overlap_identified_inserts)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(repository.insert_or_resolve, _INTEGRATION_ID, _event("event-1"), now=_NOW)
                for _ in range(2)
            ]
            results = [future.result(timeout=5) for future in futures]
    finally:
        sqlalchemy_event.remove(engine, "before_cursor_execute", overlap_identified_inserts)

    assert {result.kind for result in results} == {AcceptanceKind.NEW, AcceptanceKind.DUPLICATE}
    assert results[0].record_id == results[1].record_id
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 1


def test_postgres_skip_locked_and_exclusive_claim(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    engine, repository, session_maker = postgres_context
    first = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-1"), now=_NOW)
    second = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-2"), now=_NOW)

    with session_maker() as locking_session, locking_session.begin():
        locking_session.scalar(
            sa.select(IMMessageInbox).where(IMMessageInbox.id == str(first.record_id)).with_for_update()
        )
        claimed_while_locked = repository.claim_available(
            now=_NOW,
            lease_duration=timedelta(seconds=30),
            limit=2,
        )

    assert tuple(delivery.record_id for delivery in claimed_while_locked) == (second.record_id,)

    third = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-3"), now=_NOW)
    claim_barrier = Barrier(2)

    def overlap_claim_selects(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().startswith("SELECT") and "FOR UPDATE" in statement:
            claim_barrier.wait(timeout=5)

    sqlalchemy_event.listen(engine, "before_cursor_execute", overlap_claim_selects)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            claims = [
                executor.submit(
                    repository.claim_by_id,
                    third.record_id,
                    now=_NOW,
                    lease_duration=timedelta(seconds=30),
                )
                for _ in range(2)
            ]
            deliveries = [future.result(timeout=5) for future in claims]
    finally:
        sqlalchemy_event.remove(engine, "before_cursor_execute", overlap_claim_selects)
    assert sum(delivery is not None for delivery in deliveries) == 1


def test_postgres_lease_reclaim_renewal_and_stale_token_fencing(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, session_maker = postgres_context
    accepted = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-1"), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW, lease_duration=timedelta(seconds=10))
    assert first is not None
    assert first.claim_origin is InboxClaimOrigin.PENDING
    renewed = repository.renew(
        first.record_id,
        first.claim_token,
        now=UtcTimestamp(_NOW.value + timedelta(seconds=5)),
        lease_duration=timedelta(seconds=10),
    )
    assert isinstance(renewed, TransitionApplied)

    second = repository.claim_by_id(
        accepted.record_id,
        now=UtcTimestamp(_NOW.value + timedelta(seconds=16)),
        lease_duration=timedelta(seconds=10),
    )
    assert second is not None
    assert second.claim_origin is InboxClaimOrigin.EXPIRED_PROCESSING
    stale = repository.succeed(
        first.record_id,
        first.claim_token,
        now=UtcTimestamp(_NOW.value + timedelta(seconds=17)),
    )

    assert isinstance(stale, LostLease)
    assert second.claim_token != first.claim_token
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(first.record_id))
        assert stored.claim_token == str(second.claim_token)
        assert stored.status.value == "processing"


def test_postgres_concurrent_recovery_wakeups_share_one_exclusive_claim(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    engine, repository, session_maker = postgres_context
    accepted = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-1"), now=_NOW)
    wakeup = _ThreadSafeWakeup()
    recovery = IMInboxRecovery(
        repository=repository,
        wakeup=wakeup,
        clock=lambda: _NOW,
        batch_size=10,
        metrics=NoopIMInboxMetrics(),
    )
    recovery_barrier = Barrier(2)

    def overlap_recovery_scans(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().startswith("SELECT im_message_inbox.id") and "FOR UPDATE" not in statement:
            recovery_barrier.wait(timeout=5)

    sqlalchemy_event.listen(engine, "before_cursor_execute", overlap_recovery_scans)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            recovery_futures = [executor.submit(recovery.dispatch_available) for _ in range(2)]
            recovery_results = [future.result(timeout=5) for future in recovery_futures]
    finally:
        sqlalchemy_event.remove(engine, "before_cursor_execute", overlap_recovery_scans)

    assert recovery_results == [
        RecoveryDispatchResult(discovered=1, dispatched=1),
        RecoveryDispatchResult(discovered=1, dispatched=1),
    ]
    assert wakeup.record_ids() == (accepted.record_id, accepted.record_id)

    claim_barrier = Barrier(2)

    def overlap_duplicate_wakeup_claims(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().startswith("SELECT") and "FOR UPDATE" in statement:
            claim_barrier.wait(timeout=5)

    sqlalchemy_event.listen(engine, "before_cursor_execute", overlap_duplicate_wakeup_claims)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            claim_futures = [
                executor.submit(
                    repository.claim_by_id,
                    record_id,
                    now=_NOW,
                    lease_duration=timedelta(seconds=30),
                )
                for record_id in wakeup.record_ids()
            ]
            deliveries = [future.result(timeout=5) for future in claim_futures]
    finally:
        sqlalchemy_event.remove(engine, "before_cursor_execute", overlap_duplicate_wakeup_claims)

    claimed = [delivery for delivery in deliveries if delivery is not None]
    assert len(claimed) == 1
    assert isinstance(repository.succeed(claimed[0].record_id, claimed[0].claim_token, now=_NOW), TransitionApplied)
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(accepted.record_id))
        assert stored.status.value == "succeeded"
        assert stored.attempt_count == 1
