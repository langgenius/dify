"""Exercise collaboration metrics through Socket.IO's real lifecycle dispatch."""

from collections.abc import Callable, Iterator
from unittest.mock import MagicMock

import pytest
import socketio
from engineio.socket import Socket
from flask import Flask
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import Gauge, Histogram, InMemoryMetricReader, Metric, Sum
from socketio.packet import ACK, CONNECT_ERROR, Packet
from sqlalchemy.orm import Session
from werkzeug.test import EnvironBuilder

from controllers.console.socketio import workflow
from extensions.ext_redis import RedisClientWrapper
from extensions.otel import workflow_collaboration
from extensions.otel.workflow_collaboration import WorkflowCollaborationMetrics
from services.errors.billing import BillingUpstreamUnavailableError
from services.workflow_collaboration_service import WorkflowCollaborationNotEntitledError


@pytest.fixture
def collaboration_server(
    monkeypatch: pytest.MonkeyPatch,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    config_overrides: Callable[..., None],
) -> Iterator[tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader]]:
    """Initialize app-owned metrics for registered handlers while replacing only transports and metric export."""
    config_overrides(ENABLE_OTEL=True)
    app = Flask(__name__)
    server = workflow.sio
    manager = socketio.Manager()
    manager.set_server(server)
    monkeypatch.setattr(server, "manager", manager)
    monkeypatch.setattr(server, "environ", {})
    monkeypatch.setattr(server, "app", app, raising=False)
    monkeypatch.setattr(server.eio, "sockets", {})
    monkeypatch.setattr(workflow.repository, "_redis", redis_transport[0])

    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    monkeypatch.setattr(workflow_collaboration, "get_meter", provider.get_meter)
    workflow_collaboration.init_workflow_collaboration_metrics(app)
    metrics = app.extensions["workflow_collaboration_metrics"]
    assert isinstance(metrics, WorkflowCollaborationMetrics)
    try:
        yield server, metrics, reader
    finally:
        provider.shutdown()


def _read_metrics(reader: InMemoryMetricReader) -> dict[str, Metric]:
    """Collect the real SDK instruments and return their exported values by metric name."""
    data = reader.get_metrics_data()
    assert data is not None
    return {
        metric.name: metric
        for resource in data.resource_metrics
        for scope in resource.scope_metrics
        for metric in scope.metrics
    }


def _assert_single_event(metrics: dict[str, Metric], event: str, outcome: str) -> None:
    """Require exactly one completed handler observation and no compatibility-retry error series."""
    attributes = {"event": event, "event_type": "none", "outcome": outcome}
    events = metrics["dify.collaboration.events"].data
    assert isinstance(events, Sum)
    assert len(events.data_points) == 1
    assert events.data_points[0].attributes == attributes
    assert events.data_points[0].value == 1

    duration = metrics["dify.collaboration.event_duration"].data
    assert isinstance(duration, Histogram)
    assert len(duration.data_points) == 1
    assert duration.data_points[0].attributes == attributes
    assert duration.data_points[0].count == 1

    connections = metrics["dify.collaboration.connections"].data
    assert isinstance(connections, Gauge)
    assert connections.data_points[0].value == 0


def test_connect_without_auth_payload_records_one_rejection(
    collaboration_server: tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader],
) -> None:
    """A tokenless client omitting auth is rejected once without an argument-compatibility error."""
    server, _, reader = collaboration_server
    eio_sid = "connect-without-auth"
    transport = Socket(server.eio, eio_sid)
    server.eio.sockets[eio_sid] = transport
    builder = EnvironBuilder(path="/socket.io")
    try:
        server.environ[eio_sid] = builder.get_environ()
    finally:
        builder.close()

    assert server.handlers["/"]["connect"] is workflow.socket_connect
    server._handle_connect(eio_sid, "/", None)

    response = Packet(encoded_packet=transport.queue.get_nowait().data)
    assert response.packet_type == CONNECT_ERROR
    assert server.manager.sid_from_eio_sid(eio_sid, "/") is None
    _assert_single_event(_read_metrics(reader), "connect", "rejected")


def test_user_connect_returns_ack_when_billing_is_unavailable(
    collaboration_server: tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Billing failures return a 503 ACK to the client."""
    server, _, reader = collaboration_server
    eio_sid = "billing-unavailable"
    transport = Socket(server.eio, eio_sid)
    server.eio.sockets[eio_sid] = transport
    sid = server.manager.connect(eio_sid, "/")

    def billing_unavailable(*_args: object, **_kwargs: object) -> None:
        raise BillingUpstreamUnavailableError("billing unavailable")

    monkeypatch.setattr(workflow.session_factory, "create_session", Session)
    monkeypatch.setattr(workflow.collaboration_service, "authorize_and_join_workflow_room", billing_unavailable)

    server._handle_event_internal(server, sid, eio_sid, ["user_connect", {"workflow_id": "wf-1"}], "/", 42)

    response = Packet(encoded_packet=transport.queue.get_nowait().data)
    assert response.packet_type == ACK
    assert response.id == 42
    assert response.data == [{"msg": "collaboration_unavailable"}, 503]
    _assert_single_event(_read_metrics(reader), "user_connect", "error")


def test_user_connect_distinguishes_plan_rejection_from_missing_access(
    collaboration_server: tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server, _, _ = collaboration_server
    monkeypatch.setattr(workflow.session_factory, "create_session", Session)

    def not_entitled(*_args: object, **_kwargs: object) -> None:
        raise WorkflowCollaborationNotEntitledError

    monkeypatch.setattr(workflow.collaboration_service, "authorize_and_join_workflow_room", not_entitled)
    assert server.handlers["/"]["user_connect"]("sid-1", {"workflow_id": "wf-1"}) == ({"msg": "not_entitled"}, 403)

    monkeypatch.setattr(workflow.collaboration_service, "authorize_and_join_workflow_room", lambda *_args, **_kw: None)
    assert server.handlers["/"]["user_connect"]("sid-1", {"workflow_id": "wf-1"}) == ({"msg": "unauthorized"}, 401)


def test_user_connect_does_not_hide_unrelated_errors(
    collaboration_server: tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server, _, _ = collaboration_server

    def unexpected_error(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("unexpected error")

    monkeypatch.setattr(workflow.session_factory, "create_session", Session)
    monkeypatch.setattr(workflow.collaboration_service, "authorize_and_join_workflow_room", unexpected_error)

    with pytest.raises(RuntimeError, match="unexpected error"):
        server.handlers["/"]["user_connect"]("sid-1", {"workflow_id": "wf-1"})


def test_disconnect_with_reason_records_one_success(
    collaboration_server: tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    """A reason-bearing disconnect executes real cleanup once and removes the worker's live connection."""
    server, metrics, reader = collaboration_server
    eio_sid = "disconnect-with-reason"
    sid = server.manager.connect(eio_sid, "/")
    assert isinstance(sid, str)
    metrics.connected(sid)

    assert server.handlers["/"]["disconnect"] is workflow.handle_disconnect
    server._handle_disconnect(eio_sid, "/", server.reason.PING_TIMEOUT)

    redis_transport[1].assert_called_once_with(
        "GET", workflow.repository.sid_key(sid), keys=[workflow.repository.sid_key(sid)]
    )
    assert not server.manager.is_connected(sid, "/")
    _assert_single_event(_read_metrics(reader), "disconnect", "success")


@pytest.mark.parametrize("otel_enabled", [True, False])
def test_disconnect_type_error_is_not_retried(
    collaboration_server: tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    otel_enabled: bool,
) -> None:
    """A cleanup TypeError propagates after one call, regardless of instrumentation."""
    server, metrics, reader = collaboration_server
    config_overrides(ENABLE_OTEL=otel_enabled)
    eio_sid = "disconnect-cleanup-error"
    sid = server.manager.connect(eio_sid, "/")
    assert isinstance(sid, str)
    metrics.connected(sid)
    failure = TypeError("cleanup failed after partial work")
    calls: list[str] = []

    def cleanup(disconnected_sid: str) -> None:
        calls.append(disconnected_sid)
        if len(calls) == 1:
            raise failure

    monkeypatch.setattr(workflow.collaboration_service, "disconnect_session", cleanup)

    with pytest.raises(TypeError) as caught:
        server._handle_disconnect(eio_sid, "/", server.reason.CLIENT_DISCONNECT)

    assert caught.value is failure
    assert calls == [sid]
    if otel_enabled:
        _assert_single_event(_read_metrics(reader), "disconnect", "error")
