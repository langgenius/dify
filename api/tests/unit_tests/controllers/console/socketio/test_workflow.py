"""Exercise collaboration lifecycle and durable draft synchronization through registered Socket.IO handlers."""

from collections.abc import Callable, Iterator
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import socketio
from engineio.socket import Socket
from flask import Flask
from loro import ExportMode, LoroDoc, VersionVector
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import Gauge, Histogram, InMemoryMetricReader, Metric, Sum
from socketio.packet import ACK, CONNECT_ERROR, Packet
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import EnvironBuilder

from controllers.console.socketio import workflow
from enums import CloudPlan, DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_redis import RedisClientWrapper
from extensions.otel import workflow_collaboration
from extensions.otel.workflow_collaboration import WorkflowCollaborationMetrics
from models.account import TenantAccountJoin
from models.model import App, AppMode
from models.workflow import Workflow
from services.errors.billing import BillingUpstreamUnavailableError
from services.workflow_collaboration_service import WorkflowCollaborationNotEntitledError
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant, make_workflow
from tests.helpers.unit.services.workflow_collaboration_fixtures import RedisState

type LoroClient = tuple[socketio.Server, App, Workflow, str]


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


@pytest.fixture
def loro_client(
    collaboration_server: tuple[socketio.Server, WorkflowCollaborationMetrics, InMemoryMetricReader],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> LoroClient:
    """Provide a joined editor backed by real ORM objects, sessions and Redis repository logic."""
    config_overrides(ENABLE_COLLABORATION_MODE=True, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, RBAC_ENABLED=False)
    server, _, _ = collaboration_server
    redis_transport[1].side_effect = RedisState().execute
    tenant = make_tenant(tenant_id=str(uuid4()))
    account = make_account(account_id=str(uuid4()), tenant=tenant)
    app = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.WORKFLOW, maintainer=account.id)
    draft = make_workflow(
        app_id=app.id,
        tenant_id=tenant.id,
        created_by=account.id,
        graph={"nodes": [{"id": "llm", "data": {"title": "Before"}}], "edges": []},
    )
    membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.EDITOR)
    sqlite_session.add_all([tenant, account, app, draft, membership])
    sqlite_session.commit()
    eio_sid = "loro-editor"
    server.eio.sockets[eio_sid] = Socket(server.eio, eio_sid)
    sid = server.manager.connect(eio_sid, "/")
    assert isinstance(sid, str)
    server.save_session(sid, {"tenant_id": tenant.id, "user_id": account.id})
    workflow.repository.set_session_info(
        app.id,
        {"sid": sid, "user_id": account.id, "username": account.name, "avatar": None, "connected_at": 1},
    )
    monkeypatch.setattr(workflow.session_factory, "create_session", sqlite_session_factory)
    monkeypatch.setattr(workflow, "WorkflowService", lambda: WorkflowService(sqlite_session_factory))
    return server, app, draft, sid


def _seed_loro_client(client: LoroClient) -> tuple[LoroDoc, bytes]:
    """Fetch the committed baseline through the registered binary synchronization handler."""
    server, _, draft, sid = client
    body, status = server.handlers["/"]["loro_draft_sync"](sid, {"epoch": draft.id})
    assert status == 200
    assert isinstance(body["update"], bytes)
    assert isinstance(body["version"], bytes)
    doc = LoroDoc()
    doc.import_(body["update"])
    return doc, body["version"]


def test_loro_confirmation_matches_durable_history_and_duplicate_revision(
    loro_client: LoroClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """An ACK exposes only committed state; a dropped ACK can be retried without another revision."""
    server, app, draft, sid = loro_client
    doc, baseline = _seed_loro_client(loro_client)
    doc.get_map("graph").insert("viewport", {"x": 42, "y": 0, "zoom": 1})
    payload = {
        "epoch": draft.id,
        "version": baseline,
        "update": doc.export(ExportMode.Updates(VersionVector.decode(baseline))),
    }
    first, status = server.handlers["/"]["loro_draft_sync"](sid, payload)
    assert status == 200
    with sqlite_session_factory() as session:
        durable = session.get(Workflow, draft.id)
        assert durable is not None
        assert durable.app_id == app.id
        assert durable.graph_dict["viewport"] == {"x": 42, "y": 0, "zoom": 1}
        assert first["hash"] == durable.unique_hash
        assert durable.loro_draft_snapshot is not None
    duplicate, status = server.handlers["/"]["loro_draft_sync"](sid, payload)
    assert status == 200
    assert duplicate == first


@pytest.mark.parametrize("kind", ["corrupt-update", "corrupt-version", "snapshot", "string-bytes"])
def test_loro_rejects_invalid_binary_without_changing_the_draft(
    loro_client: LoroClient, sqlite_session_factory: sessionmaker[Session], kind: str
) -> None:
    """Invalid or non-delta binary input returns 400 and leaves the last committed history intact."""
    server, _, draft, sid = loro_client
    doc, baseline = _seed_loro_client(loro_client)
    payload: dict[str, object] = {"epoch": draft.id, "version": baseline}
    if kind == "corrupt-update":
        payload["update"] = b"invalid"
    elif kind == "corrupt-version":
        payload["version"] = b"invalid"
    elif kind == "snapshot":
        payload["update"] = doc.export(ExportMode.Snapshot())
    else:
        payload["update"] = "invalid"
    assert server.handlers["/"]["loro_draft_sync"](sid, payload) == ({"msg": "invalid_loro_update"}, 400)
    with sqlite_session_factory() as session:
        durable = session.get(Workflow, draft.id)
        assert durable is not None
        assert durable.graph_dict == draft.graph_dict
        assert durable.loro_draft_snapshot is not None
        recovered = LoroDoc()
        recovered.import_(durable.loro_draft_snapshot)
        assert recovered.state_vv.encode() == baseline


@pytest.mark.parametrize("reason", ["unjoined", "identity-changed", "disabled", "viewer", "wrong-tenant"])
def test_loro_rechecks_editor_access_before_loading_history(
    loro_client: LoroClient,
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    reason: str,
) -> None:
    """Reconnecting sockets cannot reuse an old membership, identity or collaboration entitlement."""
    server, app, draft, sid = loro_client
    if reason == "unjoined":
        sid = "unjoined-socket"
    elif reason == "identity-changed":
        server.save_session(sid, {"tenant_id": app.tenant_id, "user_id": "another-user"})
    elif reason == "disabled":
        config_overrides(ENABLE_COLLABORATION_MODE=False)
    elif reason == "wrong-tenant":
        server.save_session(sid, {"tenant_id": "another-tenant", "user_id": draft.created_by})
    else:
        membership = sqlite_session.scalar(
            select(TenantAccountJoin).where(TenantAccountJoin.account_id == draft.created_by)
        )
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
        sqlite_session.commit()
    assert server.handlers["/"]["loro_draft_sync"](sid, {"epoch": draft.id}) == ({"msg": "unauthorized"}, 401)
    sqlite_session.refresh(draft)
    assert draft.loro_draft_snapshot is None


@pytest.mark.parametrize("unavailable", [False, True])
def test_loro_distinguishes_revoked_entitlement_from_billing_failure(
    loro_client: LoroClient,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    unavailable: bool,
) -> None:
    """A revoked plan returns 403; a temporarily unavailable entitlement service returns 503."""
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    server, _, draft, sid = loro_client

    def plan(_tenant_id: str) -> CloudPlan:
        if unavailable:
            raise BillingUpstreamUnavailableError("billing unavailable")
        return CloudPlan.SANDBOX

    monkeypatch.setattr("services.feature_service.FeatureService.get_workspace_plan", plan)
    expected = ({"msg": "collaboration_unavailable"}, 503) if unavailable else ({"msg": "not_entitled"}, 403)
    assert server.handlers["/"]["loro_draft_sync"](sid, {"epoch": draft.id}) == expected


def test_loro_rejects_old_epochs_and_reports_a_missing_draft(loro_client: LoroClient, sqlite_session: Session) -> None:
    """Old queued edits receive an epoch conflict; deleting the draft has a separate 404 outcome."""
    server, _, draft, sid = loro_client
    old_epoch = draft.id
    draft.loro_draft_epoch = str(uuid4())
    sqlite_session.commit()
    assert server.handlers["/"]["loro_draft_sync"](sid, {"epoch": old_epoch}) == ({"msg": "epoch_changed"}, 409)
    sqlite_session.delete(draft)
    sqlite_session.commit()
    assert server.handlers["/"]["loro_draft_sync"](sid, {"epoch": old_epoch}) == (
        {"msg": "draft_workflow_not_exist"},
        404,
    )


def test_loro_requires_explicit_empty_graph_confirmation(
    loro_client: LoroClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """An accidental empty graph is rejected until the client explicitly confirms clearing it."""
    server, _, draft, sid = loro_client
    doc, baseline = _seed_loro_client(loro_client)
    doc.get_map("nodes").delete("llm")
    doc.commit()
    payload = {
        "epoch": draft.id,
        "version": baseline,
        "update": doc.export(ExportMode.Updates(VersionVector.decode(baseline))),
    }
    assert server.handlers["/"]["loro_draft_sync"](sid, payload) == ({"msg": "empty_graph_confirmation_required"}, 409)
    _, status = server.handlers["/"]["loro_draft_sync"](sid, {**payload, "allow_empty": True})
    assert status == 200
    with sqlite_session_factory() as session:
        durable = session.get(Workflow, draft.id)
        assert durable is not None
        assert durable.graph_dict == {"nodes": [], "edges": []}
