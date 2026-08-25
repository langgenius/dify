"""PostgreSQL acceptance tests for IM inbox transaction and locking semantics."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Lock

import pytest
import sqlalchemy as sa
from slack_sdk.signature import SignatureVerifier
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    AuthenticatedIMEvent,
    IMEventIngressKind,
    SlackCredentials,
    WebhookRequest,
)
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_message_inbox import (
    AcceptanceKind,
    ConsumerDecision,
    IMInboxDelivery,
    IMInboxRecordId,
    InboxClaimExhausted,
    InboxClaimOrigin,
    InboxEventValidationError,
    InboxProcessingPolicy,
    InboxProcessingStatus,
    LostLease,
    RetryScheduled,
    TransitionApplied,
)
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox import (
    IMInboxRecovery,
    IMInboxWorker,
    IMMessageInboxSink,
    InboxWorkerOutcome,
    NoopIMInboxMetrics,
    RecoveryDispatchResult,
    RenewableLeaseHeartbeat,
)

_NOW = datetime(2026, 8, 2, 8, tzinfo=UTC)
_RECEIVED_AT = datetime(2026, 8, 2, 8)
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000001")
_SLACK_SIGNING_SECRET = "sanitized-signing-material"
_SLACK_PROVIDER_TENANT_ID = "sanitized-team"
_SLACK_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000002")


def _policy(
    *,
    maximum_attempts: int = 3,
    lease_duration: timedelta = timedelta(seconds=30),
) -> InboxProcessingPolicy:
    return InboxProcessingPolicy(
        maximum_attempts=maximum_attempts,
        lease_duration=lease_duration,
        retry_backoff_minimum=timedelta(seconds=5),
        retry_backoff_maximum=timedelta(seconds=20),
    )


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


class _FixedClock:
    def now(self) -> datetime:
        return _NOW


class _SuccessfulConsumer:
    deliveries: list[IMInboxDelivery]

    def __init__(self) -> None:
        self.deliveries = []

    def consume(self, delivery: IMInboxDelivery) -> ConsumerDecision:
        self.deliveries.append(delivery)
        return ConsumerDecision.SUCCEEDED


def _event(
    event_id: str | None,
    *,
    tenant_id: str = "tenant-1",
    event_type: str | None = None,
    ingress_kind: IMEventIngressKind = IMEventIngressKind.WEBHOOK,
    payload: str = ' {"secret":"must-not-log"}\n',
) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id=tenant_id,
        event_id=event_id,
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=ingress_kind,
        payload=payload,
    )


def _slack_credentials() -> SlackCredentials:
    return SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="sanitized-client-id",
        client_secret="sanitized-client-secret",
        signing_secret=_SLACK_SIGNING_SECRET,
        bot_token="xoxb-sanitized-placeholder",
        app_token="xapp-sanitized-placeholder",
    )


def _signed_slack_request(body: bytes) -> WebhookRequest:
    timestamp = str(int(_RECEIVED_AT.replace(tzinfo=UTC).timestamp()))
    signature = SignatureVerifier(_SLACK_SIGNING_SECRET).generate_signature(timestamp=timestamp, body=body)
    assert signature is not None
    return WebhookRequest(
        method="POST",
        headers=(
            ("X-Slack-Request-Timestamp", timestamp),
            ("X-Slack-Signature", signature),
            ("Content-Type", "application/json"),
        ),
        body=body,
        received_at=_RECEIVED_AT,
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
                ingress_kind=IMEventIngressKind.WEBHOOK,
                payload="{}",
            )
        )
        session.flush()
        raise RuntimeError("rollback")


@pytest.fixture
def postgres_context(
    db_session_with_containers: Session,
) -> tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]]:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    assert engine.dialect.name == "postgresql"
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    repository = SQLAlchemyIMMessageInboxRepository(session_maker, _policy())
    return engine, repository, session_maker


@pytest.mark.parametrize("absent_event_id", [None, "", " \t\n"])
def test_postgres_absent_event_id_and_transaction_rollback(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
    absent_event_id: str | None,
) -> None:
    _, repository, session_maker = postgres_context
    first = repository.insert_or_resolve(_INTEGRATION_ID, _event(absent_event_id), now=_NOW)
    second = repository.insert_or_resolve(_INTEGRATION_ID, _event(absent_event_id), now=_NOW)

    with pytest.raises(RuntimeError, match="rollback"):
        _insert_then_rollback(session_maker)

    assert first.record_id != second.record_id
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 2
        assert all(record.provider_event_id is None for record in session.scalars(sa.select(IMMessageInbox)))


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
                ingress_kind=IMEventIngressKind.WEBHOOK,
                payload="{}",
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
    _, _, session_maker = postgres_context
    repository = SQLAlchemyIMMessageInboxRepository(
        session_maker,
        _policy(lease_duration=timedelta(seconds=10)),
    )
    accepted = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-1"), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(first, IMInboxDelivery)
    assert first.claim_origin is InboxClaimOrigin.PENDING
    renewed = repository.renew(
        first.record_id,
        first.claim_token,
        now=_NOW + timedelta(seconds=5),
    )
    assert isinstance(renewed, TransitionApplied)

    second = repository.claim_by_id(
        accepted.record_id,
        now=_NOW + timedelta(seconds=16),
    )
    assert isinstance(second, IMInboxDelivery)
    assert second.claim_origin is InboxClaimOrigin.EXPIRED_PROCESSING
    stale = repository.succeed(
        first.record_id,
        first.claim_token,
        now=_NOW + timedelta(seconds=17),
    )

    assert isinstance(stale, LostLease)
    assert second.claim_token != first.claim_token
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(first.record_id))
        assert stored.claim_token == str(second.claim_token)
        assert stored.status.value == "processing"


def test_postgres_retry_backoff_has_the_same_direct_and_recovery_visibility_boundary(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, _ = postgres_context
    accepted = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-backoff"), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(first, IMInboxDelivery)
    retry_at = _NOW + timedelta(seconds=1)
    assert repository.retry(first.record_id, first.claim_token, now=retry_at) == RetryScheduled(first.record_id)

    before_boundary = retry_at + timedelta(seconds=4, microseconds=999999)
    assert repository.claim_by_id(accepted.record_id, now=before_boundary) is None
    assert repository.recoverable_record_ids(now=before_boundary, limit=10) == ()

    at_boundary = retry_at + timedelta(seconds=5)
    assert repository.recoverable_record_ids(now=at_boundary, limit=10) == (accepted.record_id,)
    second = repository.claim_by_id(accepted.record_id, now=at_boundary)
    assert isinstance(second, IMInboxDelivery)
    assert second.attempt == 2


def test_postgres_expired_claim_at_attempt_limit_is_atomically_failed_before_consumer_handoff(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, _, session_maker = postgres_context
    repository = SQLAlchemyIMMessageInboxRepository(
        session_maker,
        _policy(maximum_attempts=1, lease_duration=timedelta(seconds=10)),
    )
    accepted = repository.insert_or_resolve(_INTEGRATION_ID, _event("event-exhausted"), now=_NOW)
    first = repository.claim_by_id(accepted.record_id, now=_NOW)
    assert isinstance(first, IMInboxDelivery)
    after_lease = _NOW + timedelta(seconds=11)
    assert repository.recoverable_record_ids(now=after_lease, limit=10) == (accepted.record_id,)

    exhausted = repository.claim_by_id(accepted.record_id, now=after_lease)

    assert exhausted == InboxClaimExhausted(accepted.record_id, IMProvider.FEISHU, 1)
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(accepted.record_id))
        assert stored.status is InboxProcessingStatus.FAILED
        assert stored.attempt_count == 1
        assert stored.claim_token is None
        assert stored.lease_expires_at is None
        assert stored.completed_at == datetime(2026, 8, 2, 8, 0, 11)


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
                )
                for record_id in wakeup.record_ids()
            ]
            deliveries = [future.result(timeout=5) for future in claim_futures]
    finally:
        sqlalchemy_event.remove(engine, "before_cursor_execute", overlap_duplicate_wakeup_claims)

    claimed = [delivery for delivery in deliveries if isinstance(delivery, IMInboxDelivery)]
    assert len(claimed) == 1
    assert isinstance(repository.succeed(claimed[0].record_id, claimed[0].claim_token, now=_NOW), TransitionApplied)
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(accepted.record_id))
        assert stored.status.value == "succeeded"
        assert stored.attempt_count == 1


def test_postgres_slack_receiver_reaches_terminal_worker_outcome(
    postgres_context: tuple[Engine, SQLAlchemyIMMessageInboxRepository, sessionmaker[Session]],
) -> None:
    _, repository, session_maker = postgres_context
    clock = _FixedClock()
    metrics = NoopIMInboxMetrics()
    sink = IMMessageInboxSink(
        integration_id=_SLACK_INTEGRATION_ID,
        expected_provider=IMProvider.SLACK,
        expected_provider_tenant_id=_SLACK_PROVIDER_TENANT_ID,
        repository=repository,
        clock=clock,
        wakeup=None,
        metrics=metrics,
    )
    handler = SlackIMProviderAdapter(_slack_credentials()).create_webhook_handler(sink)
    request_body = json.dumps(
        {
            "type": "event_callback",
            "team_id": _SLACK_PROVIDER_TENANT_ID,
            "event_id": "sanitized-postgres-event",
            "event_time": int(_NOW.timestamp()),
            "event": {"type": "message", "text": "Sanitized text"},
        },
        separators=(",", ":"),
    ).encode()

    response = handler.handle(_signed_slack_request(request_body))

    assert response.status_code == 200
    with session_maker() as session:
        stored = session.scalar(
            sa.select(IMMessageInbox).where(IMMessageInbox.provider_event_id == "sanitized-postgres-event")
        )
        assert stored is not None
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 1
        assert stored.integration_id == str(_SLACK_INTEGRATION_ID)
        assert stored.status is InboxProcessingStatus.PENDING
        record_id = IMInboxRecordId(stored.id)

    consumer = _SuccessfulConsumer()
    worker = IMInboxWorker(
        repository=repository,
        consumer=consumer,
        clock=clock,
        heartbeat=RenewableLeaseHeartbeat(
            repository=repository,
            clock=clock,
            heartbeat_interval=timedelta(seconds=5),
        ),
        metrics=metrics,
    )

    outcome = worker.process(record_id)

    assert outcome is InboxWorkerOutcome.SUCCEEDED
    assert len(consumer.deliveries) == 1
    delivery = consumer.deliveries[0]
    assert delivery.integration_id == _SLACK_INTEGRATION_ID
    assert delivery.event.provider is IMProvider.SLACK
    assert delivery.event.provider_tenant_id == _SLACK_PROVIDER_TENANT_ID
    assert delivery.event.event_id == "sanitized-postgres-event"
    assert json.loads(delivery.event.payload) == json.loads(request_body)
    with session_maker() as session:
        terminal = session.get_one(IMMessageInbox, str(record_id))
        assert terminal.status is InboxProcessingStatus.SUCCEEDED
        assert terminal.completed_at is not None
        assert terminal.attempt_count == 1
