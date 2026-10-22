from collections.abc import Iterator
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from controllers.web import app as app_controller
from controllers.web import bp, connection_preflight, wraps
from models.model import App, AppMode, EndUser
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connections.preflight import ConnectionPreflightService
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def client(harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    def identity() -> tuple[App, EndUser]:
        with harness.base.sessions() as session:
            app = session.get(App, harness.base.context.app_id)
            user = session.get(EndUser, harness.base.context.end_user_id)
            assert app is not None
            assert user is not None
            return app, user

    service = ConnectionPreflightService(
        connections=harness.base.repository,
        checks=harness.base.service,
        requirements=PublishedPreflightRequirements(
            workflows=harness.base.repository, providers=harness.providers, oauth=harness.gateway
        ),
    )
    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    monkeypatch.setattr(
        connection_preflight, "application_services", lambda: SimpleNamespace(end_user_connection_preflight=service)
    )
    definitions = AppDefinitionQueryService(
        definitions=AppDefinitionQueryRepository(session_factory=harness.base.sessions),
        builtin_icon_url_prefix="",
    )
    monkeypatch.setattr(app_controller, "application_services", lambda: SimpleNamespace(app_definitions=definitions))
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with app.test_client() as client:
        yield client


def test_explicit_version_and_selection_response(client: FlaskClient, harness: OAuthHarness) -> None:
    parameters = client.get("/api/parameters")
    assert parameters.status_code == 200
    version = parameters.get_json()["workflow_id"]
    assert version == harness.base.workflow_id
    assert parameters.get_json()["requires_end_user_connections"] is True
    assert harness.base.auth.calls == []
    response = client.post("/api/connections/preflight", json={"workflow_id": version, "connections": {}})
    assert response.status_code == 200
    data = response.get_json()
    assert data["workflow_id"] == harness.base.workflow_id
    assert data["ready"] is False
    assert data["requirements"][0]["status"] == "disconnected"
    assert data["requirements"][0]["connection_id"] is None
    created = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    response = client.post(
        "/api/connections/preflight", json={"workflow_id": data["workflow_id"], "connections": {"tool-1": created.id}}
    )
    assert response.status_code == 200
    assert response.get_json()["ready"] is True
    assert response.get_json()["requirements"][0]["connection_id"] == created.id
    assert "original-secret" not in response.get_data(as_text=True)
    assert "revision" not in response.get_data(as_text=True)
    assert "account_id" not in response.get_data(as_text=True)


@pytest.mark.parametrize(
    "payload", [{}, {"connections": {"tool-1": str(uuid4())}}, {"connections": {}, "owner": "private-injected-value"}]
)
def test_invalid_or_unversioned_selections_fail_safely(client: FlaskClient, payload: dict[str, object]) -> None:
    response = client.post("/api/connections/preflight", json=payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"
    assert "private-injected-value" not in response.get_data(as_text=True)


def test_temporary_check_failure_has_unknown_effective_state(client: FlaskClient, harness: OAuthHarness) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.base.auth.result = CredentialCheckResult(
        status="temporarily_unavailable", reason_code="provider_timeout", retryable=True, checked_at=1
    )
    response = client.post(
        "/api/connections/preflight",
        json={"workflow_id": harness.base.workflow_id, "connections": {"tool-1": connection.id}},
    )
    assert response.status_code == 200
    assert response.get_json()["ready"] is False
    requirement = response.get_json()["requirements"][0]
    assert requirement["status"] is None
    assert requirement["check"]["status"] == "temporarily_unavailable"


def test_stale_workflow_is_documented_conflict(client: FlaskClient, harness: OAuthHarness) -> None:
    response = client.post("/api/connections/preflight", json={"workflow_id": str(uuid4()), "connections": {}})
    assert response.status_code == 409
    assert response.get_json()["code"] == "workflow_changed"
    assert harness.base.auth.calls == []


def test_foreign_or_missing_chatflow_session_is_not_found(client: FlaskClient, harness: OAuthHarness) -> None:
    with harness.base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == harness.base.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
    response = client.post(
        "/api/connections/preflight",
        json={"workflow_id": harness.base.workflow_id, "conversation_id": str(uuid4()), "connections": {}},
    )
    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"


def test_guest_can_discover_requirements(client: FlaskClient, harness: OAuthHarness) -> None:
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == harness.base.context.end_user_id).values(account_id=None)
        )
    response = client.post(
        "/api/connections/preflight", json={"workflow_id": harness.base.workflow_id, "connections": {}}
    )
    assert response.status_code == 200
    assert response.get_json()["ready"] is False


@pytest.mark.parametrize(
    ("payload", "valid"),
    [
        ({"connections": {}}, False),
        ({"connections": {}, "workflow_id": str(uuid4())}, True),
        ({"connections": {}, "workflow_id": None}, False),
        ({"connections": {"tool-1": None}}, False),
        ({"connections": {"tool-1": str(uuid4())}, "workflow_id": None}, False),
        ({"connections": {"tool-1": str(uuid4())}, "workflow_id": str(uuid4())}, True),
        ({}, False),
    ],
)
def test_request_schema_always_requires_a_version(payload: dict[str, object], valid: bool) -> None:
    from jsonschema import Draft202012Validator

    schema = connection_preflight.EndUserConnectionPreflightPayload.model_json_schema()
    assert Draft202012Validator(schema).is_valid(payload) == valid
