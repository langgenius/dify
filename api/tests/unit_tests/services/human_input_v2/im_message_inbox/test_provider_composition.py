"""SQLite acceptance tests from the public Slack receiver boundary to the inbox."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import fields
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from slack_sdk.signature import SignatureVerifier
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.socket_mode.response import SocketModeResponse
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import slack as slack_adapter_module
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_message_inbox import IMInboxRecordId, InboxProcessingPolicy
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    EventAcceptance,
    SlackIMIntegrationCredentials,
    WebhookRequest,
)
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox import IMMessageInboxSink, NoopIMInboxMetrics
from services.human_input_v2.im_message_inbox.wakeup import InboxWakeup

_SIGNING_SECRET = "sanitized-signing-material"
_PROVIDER_TENANT_ID = "sanitized-team"
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000001")
_RECEIVED_AT = datetime(2026, 8, 6, 8)
_NOW = _RECEIVED_AT.replace(tzinfo=UTC)


def _policy() -> InboxProcessingPolicy:
    return InboxProcessingPolicy(
        maximum_attempts=3,
        lease_duration=timedelta(seconds=30),
        retry_backoff_minimum=timedelta(seconds=5),
        retry_backoff_maximum=timedelta(seconds=20),
    )


class _FixedClock:
    def now(self) -> datetime:
        return _NOW


class _CommitObservingWakeup:
    _session_maker: sessionmaker[Session]
    record_ids: list[IMInboxRecordId]

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker
        self.record_ids = []

    def publish(self, record_id: IMInboxRecordId) -> None:
        with self._session_maker() as session:
            assert session.get(IMMessageInbox, str(record_id)) is not None
        self.record_ids.append(record_id)


class _DelegatingConsumer:
    _sink: IMMessageInboxSink
    events: list[AuthenticatedIMEvent]

    def __init__(self, sink: IMMessageInboxSink) -> None:
        self._sink = sink
        self.events = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.events.append(event)
        return self._sink.accept(event)


def _credentials() -> SlackIMIntegrationCredentials:
    return SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="sanitized-client-id",
        client_secret="sanitized-client-secret",
        signing_secret=_SIGNING_SECRET,
        bot_token="xoxb-sanitized-placeholder",
        app_token="xapp-sanitized-placeholder",
    )


def _event_body(event_id: str) -> bytes:
    return json.dumps(
        {
            "type": "event_callback",
            "team_id": _PROVIDER_TENANT_ID,
            "event_id": event_id,
            "event_time": int(_NOW.timestamp()),
            "event": {"type": "message", "text": "Sanitized text"},
        },
        separators=(",", ":"),
    ).encode()


def _signed_request(body: bytes, *, valid_signature: bool = True) -> WebhookRequest:
    timestamp = str(int(_RECEIVED_AT.replace(tzinfo=UTC).timestamp()))
    signature = SignatureVerifier(_SIGNING_SECRET).generate_signature(timestamp=timestamp, body=body)
    assert signature is not None
    if not valid_signature:
        signature = "v0=invalid"
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


def _build_sink(
    sqlite_engine: Engine,
    *,
    wakeup: InboxWakeup | None = None,
) -> tuple[IMMessageInboxSink, sessionmaker[Session]]:
    inbox_table = IMMessageInbox.metadata.tables[IMMessageInbox.__tablename__]
    IMMessageInbox.metadata.create_all(sqlite_engine, tables=[inbox_table])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sink = IMMessageInboxSink(
        integration_id=_INTEGRATION_ID,
        expected_provider=IMProvider.SLACK,
        expected_provider_tenant_id=_PROVIDER_TENANT_ID,
        repository=SQLAlchemyIMMessageInboxRepository(session_maker, _policy()),
        clock=_FixedClock(),
        wakeup=wakeup,
        metrics=NoopIMInboxMetrics(),
    )
    return sink, session_maker


def test_slack_webhook_commits_only_authenticated_business_events_before_success(
    sqlite_engine: Engine,
) -> None:
    _, session_maker = _build_sink(sqlite_engine)
    wakeup = _CommitObservingWakeup(session_maker)
    sink, _ = _build_sink(sqlite_engine, wakeup=wakeup)
    consumer = _DelegatingConsumer(sink)
    handler = SlackIMProviderAdapter(_credentials()).create_webhook_handler(consumer)
    event_body = _event_body("sanitized-webhook-event")
    challenge_body = json.dumps(
        {"type": "url_verification", "challenge": "sanitized-challenge"},
        separators=(",", ":"),
    ).encode()

    unauthenticated_response = handler.handle(_signed_request(event_body, valid_signature=False))
    challenge_response = handler.handle(_signed_request(challenge_body))
    assert consumer.events == []
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0

    accepted_response = handler.handle(_signed_request(event_body))

    assert unauthenticated_response.status_code == 401
    assert challenge_response.status_code == 200
    assert json.loads(challenge_response.body) == {"challenge": "sanitized-challenge"}
    assert accepted_response.status_code == 200
    assert len(consumer.events) == 1
    assert len(wakeup.record_ids) == 1
    with session_maker() as session:
        stored = session.get_one(IMMessageInbox, str(wakeup.record_ids[0]))
        assert stored.integration_id == str(_INTEGRATION_ID)
        assert stored.provider is IMProvider.SLACK
        assert stored.provider_tenant_id == _PROVIDER_TENANT_ID
        assert stored.provider_event_id == "sanitized-webhook-event"
        assert json.loads(stored.payload) == json.loads(event_body)


def test_slack_webhook_maps_inbox_commit_failure_to_retryable_response(sqlite_engine: Engine) -> None:
    sink, session_maker = _build_sink(sqlite_engine)
    handler = SlackIMProviderAdapter(_credentials()).create_webhook_handler(sink)

    def fail_commit(_connection: sa.Connection) -> None:
        raise OperationalError("COMMIT", {}, RuntimeError("injected database failure"))

    sqlalchemy_event.listen(sqlite_engine, "commit", fail_commit, once=True)

    response = handler.handle(_signed_request(_event_body("sanitized-failed-event")))

    assert response.status_code == 503
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 0


def test_slack_stream_connection_acks_only_the_event_committed_by_the_inbox(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sink, session_maker = _build_sink(sqlite_engine)
    failed_request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-failed-envelope",
        payload=json.loads(_event_body("sanitized-failed-stream-event")),
    )
    accepted_request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-accepted-envelope",
        payload=json.loads(_event_body("sanitized-accepted-stream-event")),
    )

    class _SocketTransport:
        instance: _SocketTransport | None = None

        def __init__(self, **kwargs: object) -> None:
            del kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[SocketModeResponse] = []
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            listener = self.socket_mode_request_listeners[0]
            listener(self, failed_request)
            listener(self, accepted_request)

        def send_socket_mode_response(self, response: SocketModeResponse) -> None:
            with session_maker() as session:
                stored = session.scalar(sa.select(IMMessageInbox))
                assert stored is not None
                assert stored.provider_event_id == "sanitized-accepted-stream-event"
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    fail_next_commit = True

    def fail_first_commit(_connection: sa.Connection) -> None:
        nonlocal fail_next_commit
        if fail_next_commit:
            fail_next_commit = False
            raise OperationalError("COMMIT", {}, RuntimeError("injected database failure"))

    monkeypatch.setattr(slack_adapter_module, "SocketModeClient", _SocketTransport)
    sqlalchemy_event.listen(sqlite_engine, "commit", fail_first_commit)
    stream = SlackIMProviderAdapter(_credentials()).create_stream_handler(sink)
    try:
        stream.start()
    finally:
        sqlalchemy_event.remove(sqlite_engine, "commit", fail_first_commit)

    transport = _SocketTransport.instance
    assert transport is not None
    assert [response.to_dict() for response in transport.responses] == [{"envelope_id": "sanitized-accepted-envelope"}]
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(IMMessageInbox.id))) == 1

    stream.stop()

    assert transport.closed is True


def test_slack_webhook_and_stream_share_inbox_deduplication_without_expanding_event_contract(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sink, session_maker = _build_sink(sqlite_engine)
    consumer = _DelegatingConsumer(sink)
    adapter = SlackIMProviderAdapter(_credentials())
    event_body = _event_body("sanitized-shared-event")
    webhook_response = adapter.create_webhook_handler(consumer).handle(_signed_request(event_body))
    stream_request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-shared-envelope",
        payload=json.loads(event_body),
    )

    class _SocketTransport:
        instance: _SocketTransport | None = None

        def __init__(self, **kwargs: object) -> None:
            del kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[SocketModeResponse] = []
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            self.socket_mode_request_listeners[0](self, stream_request)

        def send_socket_mode_response(self, response: SocketModeResponse) -> None:
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(slack_adapter_module, "SocketModeClient", _SocketTransport)
    stream = adapter.create_stream_handler(consumer)
    stream.start()

    transport = _SocketTransport.instance
    assert transport is not None
    assert webhook_response.status_code == 200
    assert [response.to_dict() for response in transport.responses] == [{"envelope_id": "sanitized-shared-envelope"}]
    assert len(consumer.events) == 2
    assert {field.name for field in fields(AuthenticatedIMEvent)} == {
        "provider",
        "provider_tenant_id",
        "event_id",
        "event_type",
        "occurred_at",
        "received_at",
        "ingress_kind",
        "payload",
    }
    with session_maker() as session:
        records = list(session.scalars(sa.select(IMMessageInbox)))
        assert len(records) == 1
        assert records[0].integration_id == str(_INTEGRATION_ID)
        assert records[0].claim_token is None
        assert consumer.events[0].ingress_kind.value == "webhook"
        assert consumer.events[1].ingress_kind.value == "stream"
        assert json.loads(consumer.events[1].payload) == stream_request.to_dict()
        assert records[0].ingress_kind is consumer.events[0].ingress_kind
        assert records[0].payload == consumer.events[0].payload
        assert json.loads(records[0].payload) == json.loads(event_body)

    stream.stop()

    assert transport.closed is True
