from collections.abc import Iterator, Mapping
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from controllers.common import session as controller_session
from controllers.web import bp, wraps
from models.model import App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionSecretUnavailableError,
    ConnectionWorkflowChangedError,
)
from tests.helpers.end_user_api_key import ConnectionHarness, make_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> ConnectionHarness:
    return make_harness(sqlite_session_factory)


@pytest.fixture(params=[("/api/workflows/run", AppMode.WORKFLOW), ("/api/chat-messages", AppMode.ADVANCED_CHAT)])
def client(
    request: pytest.FixtureRequest, harness: ConnectionHarness, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[FlaskClient, str]]:
    path, mode = request.param
    with harness.sessions.begin() as session:
        app = session.get(App, harness.context.app_id)
        assert app is not None
        app.mode = mode

    def identity() -> tuple[App, EndUser]:
        with harness.sessions() as session:
            app = session.get(App, harness.context.app_id)
            user = session.get(EndUser, harness.context.end_user_id)
            assert app is not None
            assert user is not None
            return app, user

    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    monkeypatch.setattr(controller_session.session_factory, "create_session", harness.sessions)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with app.test_client() as http:
        yield http, path


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (ConnectionConfigurationError(), 400, "connection_configuration_invalid"),
        (ConnectionNotFoundError(), 404, "connection_not_found"),
        (ConnectionWorkflowChangedError(), 409, "workflow_changed"),
        (ConnectionReauthorizationRequiredError(), 409, "connection_reauthorization_required"),
        (ConnectionCheckUnavailableError(), 503, "credential_check_unavailable"),
        (ConnectionSecretUnavailableError(), 503, "connection_credentials_unavailable"),
        (ConnectionIdentityError(), 401, "unauthorized"),
    ],
)
def test_connection_errors_are_served_with_documented_contract(
    client: tuple[FlaskClient, str],
    harness: ConnectionHarness,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    status: int,
    code: str,
) -> None:
    def fail(**_kwargs: object) -> None:
        raise error

    monkeypatch.setattr(AppGenerateService, "generate", fail)
    http, path = client
    response = http.post(
        path, json={"inputs": {}, "query": "hello", "workflow_id": harness.workflow_id, "connections": {}}
    )
    assert response.status_code == status
    assert response.get_json()["code"] == code


def test_identity_fields_are_not_forwarded_as_request_authority(
    client: tuple[FlaskClient, str],
    harness: ConnectionHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def generate(*, args: Mapping[str, object], **_kwargs: object) -> dict[str, str]:
        captured.update(args)
        return {"result": "ok"}

    monkeypatch.setattr(AppGenerateService, "generate", generate)
    http, path = client
    selected = str(uuid4())
    response = http.post(
        path,
        json={
            "inputs": {},
            "query": "hello",
            "workflow_id": harness.workflow_id,
            "connections": {"tool-1": selected},
            "tenant_id": "foreign",
            "account_id": "foreign",
            "connection_context": {"identity": "foreign"},
        },
    )
    assert response.status_code == 200
    assert captured["workflow_id"] == harness.workflow_id
    assert captured["connections"] == {"tool-1": selected}
    assert not {"tenant_id", "account_id", "connection_context"} & captured.keys()
