from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from flask import Flask, current_app
from werkzeug.test import EnvironBuilder

from controllers.console.socketio import workflow


@dataclass
class FakeCollaborationService:
    calls: list[tuple[str, tuple[object, ...]]] = field(default_factory=list)
    authenticated: bool = True
    authentication_error: Exception | None = None
    joined: tuple[str, bool] | None = ("account-1", True)

    def authenticate_socket(self, token: str, sid: str) -> bool:
        self.calls.append(("authenticate", (token, sid)))
        if self.authentication_error is not None:
            raise self.authentication_error
        return self.authenticated

    def authorize_and_join_workflow_room(self, workflow_id: str, sid: str) -> tuple[str, bool] | None:
        self.calls.append(("join", (workflow_id, sid)))
        return self.joined

    def disconnect_session(self, sid: str) -> None:
        self.calls.append(("disconnect", (sid,)))

    def relay_collaboration_event(self, sid: str, data: dict[str, object]) -> tuple[dict[str, object], int]:
        self.calls.append(("collaboration", (sid, data)))
        return {"success": True}, 200

    def relay_graph_event(self, sid: str, data: dict[str, object]) -> tuple[dict[str, object], int]:
        self.calls.append(("graph", (sid, data)))
        return {"success": True}, 200


@dataclass
class FakeApplicationServices:
    workflow_collaboration: FakeCollaborationService


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> FakeCollaborationService:
    app = Flask(__name__)
    collaboration = FakeCollaborationService()
    services = FakeApplicationServices(collaboration)

    def application_services() -> FakeApplicationServices:
        assert current_app == app
        return services

    monkeypatch.setattr(workflow.sio, "app", app, raising=False)
    monkeypatch.setattr(workflow, "application_services", application_services)
    return collaboration


@pytest.mark.parametrize("authenticated", [False, True])
def test_connect_delegates_authentication_with_app_context(
    service: FakeCollaborationService, authenticated: bool
) -> None:
    service.authenticated = authenticated
    environ = EnvironBuilder(headers=[("Authorization", "Bearer access-token")]).get_environ()

    assert workflow.socket_connect("sid-1", environ, None) is authenticated
    assert service.calls == [("authenticate", ("access-token", "sid-1"))]


def test_connect_rejects_authentication_errors(service: FakeCollaborationService) -> None:
    service.authentication_error = ValueError("Invalid Console access token")
    environ = EnvironBuilder(headers=[("Authorization", "Bearer invalid-token")]).get_environ()

    assert workflow.socket_connect("sid-1", environ, None) is False


def test_connect_rejects_missing_tokens(service: FakeCollaborationService) -> None:
    assert workflow.socket_connect("sid-1", EnvironBuilder().get_environ(), None) is False
    assert service.calls == []


def test_user_connect_preserves_join_response(service: FakeCollaborationService) -> None:
    assert workflow.handle_user_connect("sid-1", {"workflow_id": "workflow-1"}) == {
        "msg": "connected",
        "user_id": "account-1",
        "sid": "sid-1",
        "isLeader": True,
    }
    assert service.calls == [("join", ("workflow-1", "sid-1"))]


def test_user_connect_preserves_access_rejection(service: FakeCollaborationService) -> None:
    service.joined = None

    assert workflow.handle_user_connect("sid-1", {"workflow_id": "workflow-1"}) == ({"msg": "unauthorized"}, 401)


def test_user_connect_requires_workflow_id(service: FakeCollaborationService) -> None:
    assert workflow.handle_user_connect("sid-1", {}) == ({"msg": "workflow_id is required"}, 400)
    assert service.calls == []


def test_disconnect_delegates_with_app_context(service: FakeCollaborationService) -> None:
    workflow.handle_disconnect("sid-1")

    assert service.calls == [("disconnect", ("sid-1",))]


@pytest.mark.parametrize(
    ("handler", "event"),
    [(workflow.handle_collaboration_event, "collaboration"), (workflow.handle_graph_event, "graph")],
)
def test_event_handlers_preserve_payloads_and_responses(
    service: FakeCollaborationService,
    handler: Callable[[str, dict[str, object]], object],
    event: str,
) -> None:
    payload: dict[str, object] = {"type": "workflow_update", "data": {"nodes": []}}

    assert handler("sid-1", payload) == ({"success": True}, 200)
    assert service.calls == [(event, ("sid-1", payload))]
