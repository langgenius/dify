"""SQLite-backed tests for the IM message inbox persistence adapter."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_message_inbox import (
    AcceptanceKind,
    ClaimToken,
    IMInboxRecordId,
    InboxClaimOrigin,
    InboxEventValidationError,
    InboxPersistenceError,
    InboxProcessingStatus,
    LostLease,
    TransitionApplied,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent
from core.human_input_v2.shared import IntegrationId, UtcTimestamp
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository

_NOW = UtcTimestamp(datetime(2026, 8, 2, 8, tzinfo=UTC))
_PAYLOAD = ' {"token":"sensitive","sequence":1}\n'


def _event(
    event_id: str | None = "event-1",
    *,
    provider: IMProvider = IMProvider.FEISHU,
    tenant_id: str = "tenant-1",
    event_type: str | None = "card.action",
) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=provider,
        provider_tenant_id=tenant_id,
        event_id=event_id,
        occurred_at=datetime(2026, 8, 2, 7, 59),
        received_at=datetime(2026, 8, 2, 8),
        event_type=event_type,
        payload=_PAYLOAD,
    )


def _repository(sqlite_engine: Engine) -> tuple[SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]]:
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[IMMessageInbox.__table__])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    return SQLAlchemyIMMessageInboxRepository(session_maker), session_maker


def test_insert_resolves_identified_duplicate_without_mutating_existing_record(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)

    duplicate = repository.insert_or_resolve(IntegrationId("integration-2"), _event(), now=_NOW)

    assert first.kind is AcceptanceKind.NEW
    assert duplicate.kind is AcceptanceKind.DUPLICATE
    assert duplicate.record_id == first.record_id
    with session_maker() as session:
        records = list(session.scalars(select(IMMessageInbox)))
    assert len(records) == 1
    assert records[0].integration_id == "integration-1"
    assert records[0].attempt_count == 0


def test_absent_event_id_and_distinct_provider_identity_create_independent_records(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)

    results = [
        repository.insert_or_resolve(IntegrationId("integration-1"), _event(None), now=_NOW),
        repository.insert_or_resolve(IntegrationId("integration-1"), _event(None), now=_NOW),
        repository.insert_or_resolve(IntegrationId("integration-1"), _event(tenant_id="tenant-2"), now=_NOW),
        repository.insert_or_resolve(IntegrationId("integration-1"), _event(provider=IMProvider.SLACK), now=_NOW),
    ]

    assert all(result.kind is AcceptanceKind.NEW for result in results)
    with session_maker() as session:
        assert session.scalar(select(func.count(IMMessageInbox.id))) == 4


@pytest.mark.parametrize(
    ("tenant_id", "event_id", "event_type", "field_name"),
    [
        ("t" * 129, "event-1", "card.action", "provider tenant id"),
        ("tenant-1", "e" * 129, "card.action", "provider event id"),
        ("tenant-1", "event-1", "y" * 129, "provider event type"),
    ],
)
def test_repository_rejects_oversized_event_metadata_before_insert(
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
        assert session.scalar(select(func.count(IMMessageInbox.id))) == 0


def test_transaction_commit_failure_rolls_back_the_insert(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)

    def fail_commit(_connection: sa.Connection) -> None:
        raise sa.exc.OperationalError("COMMIT", {}, RuntimeError("credential must-not-escape"))

    sa.event.listen(sqlite_engine, "commit", fail_commit)
    try:
        with pytest.raises(InboxPersistenceError) as error:
            repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    finally:
        sa.event.remove(sqlite_engine, "commit", fail_commit)

    assert "must-not-escape" not in str(error.value)
    with session_maker() as session:
        assert session.scalar(select(func.count(IMMessageInbox.id))) == 0


def test_claim_reconstructs_event_and_renews_only_current_token(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)

    delivery = repository.claim_by_id(accepted.record_id, now=_NOW, lease_duration=timedelta(seconds=60))
    assert delivery is not None
    renewed = repository.renew(
        delivery.record_id,
        delivery.claim_token,
        now=UtcTimestamp(_NOW.value + timedelta(seconds=20)),
        lease_duration=timedelta(seconds=60),
    )
    stale = repository.renew(
        delivery.record_id,
        ClaimToken("stale"),
        now=UtcTimestamp(_NOW.value + timedelta(seconds=20)),
        lease_duration=timedelta(seconds=60),
    )

    assert delivery.event == _event()
    assert delivery.integration_id == IntegrationId("integration-1")
    assert delivery.claim_origin is InboxClaimOrigin.PENDING
    assert delivery.attempt == 1
    assert isinstance(renewed, TransitionApplied)
    assert stale == LostLease(delivery.record_id, ClaimToken("stale"))
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(delivery.record_id))
        assert stored.status is InboxProcessingStatus.PROCESSING
        assert stored.raw_payload == _PAYLOAD


def test_expired_lease_is_reclaimed_and_stale_owner_cannot_finalize(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW, lease_duration=timedelta(seconds=10))
    assert first is not None

    second = repository.claim_by_id(
        accepted.record_id,
        now=UtcTimestamp(_NOW.value + timedelta(seconds=11)),
        lease_duration=timedelta(seconds=10),
    )
    assert second is not None
    stale = repository.succeed(first.record_id, first.claim_token, now=UtcTimestamp(_NOW.value + timedelta(seconds=12)))

    assert second.claim_token != first.claim_token
    assert second.claim_origin is InboxClaimOrigin.EXPIRED_PROCESSING
    assert second.attempt == 2
    assert stale == LostLease(first.record_id, first.claim_token)
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(first.record_id))
        assert stored.claim_token == str(second.claim_token)
        assert stored.status is InboxProcessingStatus.PROCESSING


def test_retry_is_bounded_and_terminal_records_are_not_reclaimed(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW, lease_duration=timedelta(seconds=10))
    assert first is not None

    retried = repository.retry(
        first.record_id,
        first.claim_token,
        now=_NOW,
        maximum_attempts=2,
    )
    with session_maker() as session:
        pending = session.get_one(IMMessageInbox, str(first.record_id))
        assert pending.status is InboxProcessingStatus.PENDING
        assert pending.completed_at is None

    second = repository.claim_by_id(
        first.record_id,
        now=_NOW,
        lease_duration=timedelta(seconds=10),
    )
    assert second is not None
    assert second.claim_origin is InboxClaimOrigin.PENDING
    exhausted = repository.retry(
        second.record_id,
        second.claim_token,
        now=UtcTimestamp(_NOW.value + timedelta(seconds=1)),
        maximum_attempts=2,
    )

    assert isinstance(retried, TransitionApplied)
    assert isinstance(exhausted, TransitionApplied)
    assert (
        repository.claim_by_id(
            first.record_id,
            now=UtcTimestamp(_NOW.value + timedelta(hours=1)),
            lease_duration=timedelta(seconds=10),
        )
        is None
    )
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(first.record_id))
        assert stored.status is InboxProcessingStatus.FAILED
        assert stored.claim_token is None
        assert stored.completed_at == datetime(2026, 8, 2, 8, 0, 1)


def test_recovery_and_backlog_queries_do_not_require_payload_selection(sqlite_engine: Engine) -> None:
    repository, _ = _repository(sqlite_engine)
    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-1"), now=_NOW)
    second = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-2"), now=_NOW)
    claimed = repository.claim_by_id(second.record_id, now=_NOW, lease_duration=timedelta(seconds=5))
    assert claimed is not None
    later = UtcTimestamp(_NOW.value + timedelta(seconds=6))

    recoverable = repository.recoverable_record_ids(now=later, limit=10)
    backlog = repository.backlog(now=later)

    assert set(recoverable) == {first.record_id, second.record_id}
    assert backlog.count(InboxProcessingStatus.PENDING) == 1
    assert backlog.count(InboxProcessingStatus.PROCESSING) == 1
    assert backlog.oldest_pending_age == timedelta(seconds=6)


def test_claim_available_is_bounded_and_uses_the_same_claim_state(sqlite_engine: Engine) -> None:
    repository, _ = _repository(sqlite_engine)
    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-1"), now=_NOW)
    second = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-2"), now=_NOW)

    deliveries = repository.claim_available(now=_NOW, lease_duration=timedelta(seconds=30), limit=1)
    remaining = repository.claim_available(now=_NOW, lease_duration=timedelta(seconds=30), limit=1)

    assert len(deliveries) == 1
    assert len(remaining) == 1
    assert {deliveries[0].record_id, remaining[0].record_id} == {first.record_id, second.record_id}


def test_current_claim_can_finalize_each_terminal_outcome(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    accepted = [
        repository.insert_or_resolve(IntegrationId("integration-1"), _event(f"event-{index}"), now=_NOW)
        for index in range(3)
    ]
    deliveries = [
        repository.claim_by_id(result.record_id, now=_NOW, lease_duration=timedelta(seconds=30)) for result in accepted
    ]
    assert all(delivery is not None for delivery in deliveries)
    succeeded, ignored, failed = deliveries
    assert succeeded is not None
    assert ignored is not None
    assert failed is not None

    repository.succeed(succeeded.record_id, succeeded.claim_token, now=_NOW)
    repository.ignore(ignored.record_id, ignored.claim_token, now=_NOW)
    repository.fail(failed.record_id, failed.claim_token, now=_NOW)

    with session_maker() as session:
        statuses = {
            IMInboxRecordId(record.id): (record.status, record.completed_at)
            for record in session.scalars(select(IMMessageInbox))
        }
    assert statuses[succeeded.record_id] == (InboxProcessingStatus.SUCCEEDED, datetime(2026, 8, 2, 8))
    assert statuses[ignored.record_id] == (InboxProcessingStatus.IGNORED, datetime(2026, 8, 2, 8))
    assert statuses[failed.record_id] == (InboxProcessingStatus.FAILED, datetime(2026, 8, 2, 8))
