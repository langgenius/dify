"""SQLite-backed tests for the IM message inbox persistence adapter."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_message_inbox import (
    AcceptanceKind,
    ClaimToken,
    IMInboxDelivery,
    IMInboxRecordId,
    InboxClaimOrigin,
    InboxEventValidationError,
    InboxPersistenceError,
    InboxProcessingPolicy,
    InboxProcessingStatus,
    LostLease,
    RetryExhausted,
    RetryScheduled,
    TransitionApplied,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)
_PAYLOAD = ' {"token":"sensitive","sequence":1}\n'


def _policy(
    *,
    maximum_attempts: int = 3,
    lease_duration: timedelta = timedelta(seconds=10),
    retry_backoff_minimum: timedelta = timedelta(seconds=5),
) -> InboxProcessingPolicy:
    return InboxProcessingPolicy(
        maximum_attempts=maximum_attempts,
        lease_duration=lease_duration,
        retry_backoff_minimum=retry_backoff_minimum,
        retry_backoff_maximum=timedelta(seconds=20),
    )


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
        occurred_at=datetime(2026, 8, 2, 7, 59),
        received_at=datetime(2026, 8, 2, 8),
        event_type=event_type,
        ingress_kind=ingress_kind,
        payload=payload,
    )


def _repository(
    sqlite_engine: Engine,
    *,
    policy: InboxProcessingPolicy | None = None,
) -> tuple[SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]]:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    return SQLAlchemyIMMessageInboxRepository(session_maker, policy or _policy()), session_maker


def test_repository_owns_processing_policy_and_returns_typed_retry_results(sqlite_engine: Engine) -> None:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    repository = SQLAlchemyIMMessageInboxRepository(
        session_maker,
        InboxProcessingPolicy(
            maximum_attempts=2,
            lease_duration=timedelta(seconds=10),
            retry_backoff_minimum=timedelta(seconds=5),
            retry_backoff_maximum=timedelta(seconds=20),
        ),
    )
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(first, IMInboxDelivery)

    scheduled = repository.retry(first.record_id, first.claim_token, now=_NOW)
    assert scheduled == RetryScheduled(first.record_id)
    second = repository.claim_by_id(
        accepted.record_id,
        now=_NOW + timedelta(seconds=5),
    )
    assert isinstance(second, IMInboxDelivery)

    exhausted = repository.retry(
        second.record_id,
        second.claim_token,
        now=_NOW + timedelta(seconds=6),
    )
    assert exhausted == RetryExhausted(second.record_id)


def test_empty_backlog_rejects_naive_now_at_persistence_boundary(sqlite_engine: Engine) -> None:
    repository, _ = _repository(sqlite_engine)

    with pytest.raises(ValueError, match="timestamp must be timezone-aware"):
        repository.backlog(now=datetime(2026, 8, 2, 8))


def test_insert_resolves_identified_duplicate_without_mutating_existing_record(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    webhook_payload = '{"type":"card.action","source":"webhook"}'
    stream_payload = '{"type":"callback","event":{"source":"stream"}}'
    first = repository.insert_or_resolve(
        IntegrationId("integration-1"),
        _event(ingress_kind=IMEventIngressKind.WEBHOOK, payload=webhook_payload),
        now=_NOW,
    )

    duplicate = repository.insert_or_resolve(
        IntegrationId("integration-2"),
        _event(ingress_kind=IMEventIngressKind.STREAM, payload=stream_payload),
        now=_NOW,
    )

    assert first.kind is AcceptanceKind.NEW
    assert duplicate.kind is AcceptanceKind.DUPLICATE
    assert duplicate.record_id == first.record_id
    with session_maker() as session:
        records = list(session.scalars(select(IMMessageInbox)))
    assert len(records) == 1
    assert records[0].integration_id == "integration-1"
    assert records[0].attempt_count == 0
    assert records[0].ingress_kind is IMEventIngressKind.WEBHOOK
    assert records[0].payload == webhook_payload


def test_ingress_kind_and_payload_round_trip_and_remain_immutable_through_processing(
    sqlite_engine: Engine,
) -> None:
    repository, session_maker = _repository(sqlite_engine)
    payload = '{"type":"interactive","envelope_id":"envelope-1","payload":{"nested":[1,null,true]}}'
    event = _event(ingress_kind=IMEventIngressKind.STREAM, payload=payload)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), event, now=_NOW)

    delivery = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(delivery, IMInboxDelivery)
    assert delivery.event == event
    repository.succeed(delivery.record_id, delivery.claim_token, now=_NOW + timedelta(seconds=1))

    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(delivery.record_id))
        assert stored.ingress_kind is IMEventIngressKind.STREAM
        assert stored.payload == payload
        assert stored.status is InboxProcessingStatus.SUCCEEDED
        assert not hasattr(stored, "raw_payload")


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


@pytest.mark.parametrize("blank_event_id", ["", " \t\n", " " * 129])
def test_blank_event_id_is_persisted_as_absent_without_deduplication(
    sqlite_engine: Engine, blank_event_id: str
) -> None:
    repository, session_maker = _repository(sqlite_engine)

    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event(blank_event_id), now=_NOW)
    second = repository.insert_or_resolve(IntegrationId("integration-1"), _event(blank_event_id), now=_NOW)

    assert first.kind is AcceptanceKind.NEW
    assert second.kind is AcceptanceKind.NEW
    assert first.record_id != second.record_id
    with session_maker() as session:
        records = list(session.scalars(select(IMMessageInbox).order_by(IMMessageInbox.id)))
    assert len(records) == 2
    assert all(record.provider_event_id is None for record in records)
    assert all(record.payload == _PAYLOAD for record in records)


def test_nonblank_event_id_is_preserved_verbatim_and_deduplicated(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    event_id = " event-1 "

    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event(event_id), now=_NOW)
    duplicate = repository.insert_or_resolve(IntegrationId("integration-1"), _event(event_id), now=_NOW)

    assert first.kind is AcceptanceKind.NEW
    assert duplicate.kind is AcceptanceKind.DUPLICATE
    assert duplicate.record_id == first.record_id
    with session_maker() as session:
        records = list(session.scalars(select(IMMessageInbox)))
    assert len(records) == 1
    assert records[0].provider_event_id == event_id


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
        raise OperationalError("COMMIT", {}, RuntimeError("credential must-not-escape"))

    sqlalchemy_event.listen(sqlite_engine, "commit", fail_commit)
    try:
        with pytest.raises(InboxPersistenceError) as error:
            repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    finally:
        sqlalchemy_event.remove(sqlite_engine, "commit", fail_commit)

    assert "must-not-escape" not in str(error.value)
    with session_maker() as session:
        assert session.scalar(select(func.count(IMMessageInbox.id))) == 0


def test_claim_reconstructs_event_and_renews_only_current_token(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(
        sqlite_engine,
        policy=_policy(lease_duration=timedelta(seconds=60)),
    )
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)

    delivery = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(delivery, IMInboxDelivery)
    renewed = repository.renew(
        delivery.record_id,
        delivery.claim_token,
        now=_NOW + timedelta(seconds=20),
    )
    stale = repository.renew(
        delivery.record_id,
        ClaimToken("stale"),
        now=_NOW + timedelta(seconds=20),
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
        assert stored.payload == _PAYLOAD


def test_renew_uses_repository_owned_lease_duration(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(
        sqlite_engine,
        policy=_policy(lease_duration=timedelta(seconds=60)),
    )
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    delivery = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(delivery, IMInboxDelivery)
    renewed_at = _NOW + timedelta(seconds=1)

    renewed = repository.renew(delivery.record_id, delivery.claim_token, now=renewed_at)

    assert isinstance(renewed, TransitionApplied)
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(delivery.record_id))
        assert stored.lease_expires_at == datetime(2026, 8, 2, 8, 1, 1)


def test_expired_lease_is_reclaimed_and_stale_owner_cannot_finalize(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(
        sqlite_engine,
        policy=_policy(lease_duration=timedelta(seconds=10)),
    )
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(first, IMInboxDelivery)

    second = repository.claim_by_id(
        accepted.record_id,
        now=_NOW + timedelta(seconds=11),
    )
    assert isinstance(second, IMInboxDelivery)
    stale = repository.succeed(first.record_id, first.claim_token, now=_NOW + timedelta(seconds=12))

    assert second.claim_token != first.claim_token
    assert second.claim_origin is InboxClaimOrigin.EXPIRED_PROCESSING
    assert second.attempt == 2
    assert stale == LostLease(first.record_id, first.claim_token)
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(first.record_id))
        assert stored.claim_token == str(second.claim_token)
        assert stored.status is InboxProcessingStatus.PROCESSING


def test_retry_is_bounded_and_terminal_records_are_not_reclaimed(sqlite_engine: Engine) -> None:
    policy = _policy(maximum_attempts=2, retry_backoff_minimum=timedelta(seconds=1))
    repository, session_maker = _repository(sqlite_engine, policy=policy)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(first, IMInboxDelivery)

    retried = repository.retry(
        first.record_id,
        first.claim_token,
        now=_NOW,
    )
    with session_maker() as session:
        pending = session.get_one(IMMessageInbox, str(first.record_id))
        assert pending.status is InboxProcessingStatus.PENDING
        assert pending.completed_at is None

    second = repository.claim_by_id(
        first.record_id,
        now=_NOW + timedelta(seconds=1),
    )
    assert isinstance(second, IMInboxDelivery)
    assert second.claim_origin is InboxClaimOrigin.PENDING
    exhausted = repository.retry(
        second.record_id,
        second.claim_token,
        now=_NOW + timedelta(seconds=2),
    )

    assert retried == RetryScheduled(first.record_id)
    assert exhausted == RetryExhausted(second.record_id)
    assert (
        repository.claim_by_id(
            first.record_id,
            now=_NOW + timedelta(hours=1),
        )
        is None
    )
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(first.record_id))
        assert stored.status is InboxProcessingStatus.FAILED
        assert stored.claim_token is None
        assert stored.completed_at == datetime(2026, 8, 2, 8, 0, 2)


def test_retry_backoff_hides_pending_work_from_direct_claim_and_recovery_until_boundary(
    sqlite_engine: Engine,
) -> None:
    repository, _ = _repository(sqlite_engine)
    direct = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-direct"), now=_NOW)
    recovered = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-recovery"), now=_NOW)
    first_claims = repository.claim_available(now=_NOW, limit=2)
    retry_at = _NOW + timedelta(seconds=1)
    for claim in first_claims:
        assert isinstance(claim, IMInboxDelivery)
        assert repository.retry(claim.record_id, claim.claim_token, now=retry_at) == RetryScheduled(claim.record_id)

    before_boundary = retry_at + timedelta(seconds=4, microseconds=999999)
    assert repository.claim_by_id(direct.record_id, now=before_boundary) is None
    assert repository.claim_available(now=before_boundary, limit=10) == ()
    assert repository.recoverable_record_ids(now=before_boundary, limit=10) == ()

    at_boundary = retry_at + timedelta(seconds=5)
    assert set(repository.recoverable_record_ids(now=at_boundary, limit=10)) == {
        direct.record_id,
        recovered.record_id,
    }
    direct_claim = repository.claim_by_id(direct.record_id, now=at_boundary)
    assert isinstance(direct_claim, IMInboxDelivery)
    assert direct_claim.record_id == direct.record_id
    assert direct_claim.attempt == 2
    batch_claims = repository.claim_available(now=at_boundary, limit=10)
    assert len(batch_claims) == 1
    assert isinstance(batch_claims[0], IMInboxDelivery)
    assert batch_claims[0].record_id == recovered.record_id
    assert batch_claims[0].attempt == 2


def test_retry_backoff_uses_attempt_specific_delay_and_caps_at_maximum(sqlite_engine: Engine) -> None:
    policy = _policy(maximum_attempts=5)
    repository, _ = _repository(sqlite_engine, policy=policy)
    accepted = repository.insert_or_resolve(IntegrationId("integration-1"), _event(), now=_NOW)
    claim = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(claim, IMInboxDelivery)

    current = _NOW
    for completed_attempt, delay_seconds in enumerate((5, 10, 20, 20), start=1):
        assert claim.attempt == completed_attempt
        assert repository.retry(claim.record_id, claim.claim_token, now=current) == RetryScheduled(claim.record_id)
        before_boundary = current + timedelta(seconds=delay_seconds, microseconds=-1)
        assert repository.claim_by_id(accepted.record_id, now=before_boundary) is None

        current += timedelta(seconds=delay_seconds)
        next_claim = repository.claim_by_id(accepted.record_id, now=current)
        assert isinstance(next_claim, IMInboxDelivery), completed_attempt
        claim = next_claim

    assert claim.attempt == 5


def test_expired_claims_at_attempt_limit_are_atomically_failed_for_direct_and_batch_claim(
    sqlite_engine: Engine,
) -> None:
    from core.human_input_v2.im_message_inbox import InboxClaimExhausted

    policy = _policy(maximum_attempts=1)
    repository, session_maker = _repository(sqlite_engine, policy=policy)
    direct = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-direct"), now=_NOW)
    batch = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-batch"), now=_NOW)
    initial_claims = repository.claim_available(now=_NOW, limit=2)
    assert all(not isinstance(claim, InboxClaimExhausted) for claim in initial_claims)
    after_lease = _NOW + timedelta(seconds=11)

    direct_result = repository.claim_by_id(direct.record_id, now=after_lease)
    batch_results = repository.claim_available(now=after_lease, limit=10)

    assert direct_result == InboxClaimExhausted(direct.record_id, IMProvider.FEISHU, 1)
    assert batch_results == (InboxClaimExhausted(batch.record_id, IMProvider.FEISHU, 1),)
    with session_maker() as session:
        records = list(session.scalars(select(IMMessageInbox).order_by(IMMessageInbox.provider_event_id)))
    assert all(record.status is InboxProcessingStatus.FAILED for record in records)
    assert all(record.claim_token is None for record in records)
    assert all(record.lease_expires_at is None for record in records)
    assert all(record.completed_at == datetime(2026, 8, 2, 8, 0, 11) for record in records)
    assert all(record.updated_at == datetime(2026, 8, 2, 8, 0, 11) for record in records)


def test_recovery_and_backlog_queries_do_not_require_payload_selection(sqlite_engine: Engine) -> None:
    repository, _ = _repository(sqlite_engine, policy=_policy(lease_duration=timedelta(seconds=5)))
    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-1"), now=_NOW)
    second = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-2"), now=_NOW)
    claimed = repository.claim_by_id(second.record_id, now=_NOW)
    assert claimed is not None
    later = _NOW + timedelta(seconds=6)

    recoverable = repository.recoverable_record_ids(now=later, limit=10)
    backlog = repository.backlog(now=later)

    assert set(recoverable) == {first.record_id, second.record_id}
    assert backlog.count(InboxProcessingStatus.PENDING) == 1
    assert backlog.count(InboxProcessingStatus.PROCESSING) == 1
    assert backlog.oldest_pending_age == timedelta(seconds=6)


def test_claim_available_is_bounded_and_uses_the_same_claim_state(sqlite_engine: Engine) -> None:
    repository, _ = _repository(sqlite_engine, policy=_policy(lease_duration=timedelta(seconds=30)))
    first = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-1"), now=_NOW)
    second = repository.insert_or_resolve(IntegrationId("integration-1"), _event("event-2"), now=_NOW)

    deliveries = repository.claim_available(now=_NOW, limit=1)
    remaining = repository.claim_available(now=_NOW, limit=1)

    assert len(deliveries) == 1
    assert len(remaining) == 1
    assert {deliveries[0].record_id, remaining[0].record_id} == {first.record_id, second.record_id}


def test_current_claim_can_finalize_each_terminal_outcome(sqlite_engine: Engine) -> None:
    repository, session_maker = _repository(sqlite_engine)
    accepted = [
        repository.insert_or_resolve(IntegrationId("integration-1"), _event(f"event-{index}"), now=_NOW)
        for index in range(3)
    ]
    deliveries = [repository.claim_by_id(result.record_id, now=_NOW) for result in accepted]
    succeeded, ignored, failed = deliveries
    assert isinstance(succeeded, IMInboxDelivery)
    assert isinstance(ignored, IMInboxDelivery)
    assert isinstance(failed, IMInboxDelivery)

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
