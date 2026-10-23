from collections.abc import Callable, Iterator
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from controllers.web import bp, connections, wraps
from models.end_user_connection import EndUserConnection
from models.model import App, EndUser
from tests.helpers.end_user_api_key import ConnectionHarness, make_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> ConnectionHarness:
    return make_harness(sqlite_session_factory)


@pytest.fixture
def client(harness: ConnectionHarness, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    def identity() -> tuple[App, EndUser]:
        with harness.sessions() as session:
            app = session.get(App, harness.context.app_id)
            user = session.get(EndUser, harness.context.end_user_id)
            assert app is not None
            assert user is not None
            return app, user

    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    monkeypatch.setattr(
        connections, "application_services", lambda: SimpleNamespace(end_user_connections=harness.service)
    )
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with app.test_client() as client:
        yield client


@pytest.mark.parametrize("anonymous", [False, True])
@pytest.mark.parametrize("allow_anonymous", [False, True])
def test_http_api_key_management_round_trip(
    client: FlaskClient,
    harness: ConnectionHarness,
    config_overrides: Callable[..., None],
    anonymous: bool,
    allow_anonymous: bool,
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=allow_anonymous)
    if anonymous:
        with harness.sessions.begin() as session:
            session.execute(sa.update(EndUser).where(EndUser.id == harness.context.end_user_id).values(account_id=None))
        harness.context = replace(harness.context, account_id=None)
    response = client.post("/api/connections", json=harness.command().model_dump(mode="json"))
    if anonymous and not allow_anonymous:
        assert response.status_code == 401
        assert response.get_json()["code"] == "end_user_login_required"
        assert harness.auth.calls == []
        return
    assert response.status_code == 201
    data = response.get_json()
    assert data["credential_status"] == "connected"
    assert isinstance(data["created_at"], int)
    assert "original-secret" not in response.get_data(as_text=True)
    assert "encrypted_credentials" not in data
    connection_id = data["id"]
    assert client.get(f"/api/connections/{connection_id}").get_json() == data
    page = client.get("/api/connections?limit=1").get_json()
    assert page == {"data": [data], "has_more": False, "next_cursor": None}
    changed = client.patch(f"/api/connections/{connection_id}", json={"credentials": {"api_key": "replacement-secret"}})
    assert changed.status_code == 200
    assert "replacement-secret" not in changed.get_data(as_text=True)
    assert client.post(f"/api/connections/{connection_id}/check").get_json()["check"]["status"] == "valid"
    deleted = client.delete(f"/api/connections/{connection_id}")
    assert deleted.status_code == 204
    assert deleted.data == b""
    assert client.get(f"/api/connections/{connection_id}").status_code == 404


@pytest.mark.parametrize("field", ["tenant_id", "account_id", "end_user_id", "provider", "revision"])
def test_request_authority_and_secret_values_never_echo_in_validation_errors(
    client: FlaskClient, harness: ConnectionHarness, field: str
) -> None:
    payload = {**harness.command().model_dump(mode="json"), field: "injected-secret"}
    response = client.post("/api/connections", json=payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"
    assert "injected-secret" not in response.get_data(as_text=True)
    assert "original-secret" not in response.get_data(as_text=True)
    assert harness.auth.calls == []


@pytest.mark.parametrize(
    ("status", "http_status", "code"),
    [
        ("invalid", 400, "connection_credentials_invalid"),
        ("temporarily_unavailable", 503, "credential_check_unavailable"),
    ],
)
def test_create_exposes_safe_business_errors(
    client: FlaskClient, harness: ConnectionHarness, status: str, http_status: int, code: str
) -> None:
    harness.auth.result = CredentialCheckResult.model_validate(
        {"status": status, "reason_code": None, "retryable": False, "checked_at": 1}
    )
    response = client.post("/api/connections", json=harness.command().model_dump(mode="json"))
    assert response.status_code == http_status
    assert response.get_json()["code"] == code


def test_foreign_and_missing_ids_return_same_not_found(client: FlaskClient, harness: ConnectionHarness) -> None:
    other = make_harness(harness.sessions)
    foreign = other.service.create_api_key(other.context, other.command())
    missing = client.get(f"/api/connections/{uuid4()}")
    denied = client.get(f"/api/connections/{foreign.id}")
    assert denied.status_code == missing.status_code == 404
    assert denied.get_json() == missing.get_json()


def test_disabling_anonymous_connections_blocks_existing_guest_management(
    client: FlaskClient, harness: ConnectionHarness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=True)
    with harness.sessions.begin() as session:
        session.execute(sa.update(EndUser).where(EndUser.id == harness.context.end_user_id).values(account_id=None))
    created = client.post("/api/connections", json=harness.command().model_dump(mode="json"))
    assert created.status_code == 201
    connection_id = created.get_json()["id"]
    harness.auth.calls.clear()
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    for method, path, payload in [
        ("GET", "/api/connections", None),
        ("GET", f"/api/connections/{connection_id}", None),
        ("PATCH", f"/api/connections/{connection_id}", {"credentials": {"api_key": "replacement"}}),
        ("POST", f"/api/connections/{connection_id}/check", None),
        ("DELETE", f"/api/connections/{connection_id}", None),
    ]:
        response = client.open(path, method=method, json=payload)
        assert response.status_code == 401
        assert response.get_json()["code"] == "end_user_login_required"
    assert harness.auth.calls == []
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=True)
    assert client.get(f"/api/connections/{connection_id}").status_code == 200


def test_stale_workflow_request_is_rejected_before_plugin_calls(
    client: FlaskClient, harness: ConnectionHarness
) -> None:
    payload = {**harness.command().model_dump(mode="json"), "workflow_id": str(uuid4())}
    response = client.post("/api/connections", json=payload)
    assert response.status_code == 409
    assert response.get_json()["code"] == "workflow_changed"
    assert harness.auth.calls == []


def test_lost_check_race_returns_conflict(client: FlaskClient, harness: ConnectionHarness) -> None:
    created = harness.service.create_api_key(harness.context, harness.command())

    def change() -> None:
        with harness.sessions.begin() as session:
            session.execute(sa.update(EndUserConnection).where(EndUserConnection.id == created.id).values(revision=2))

    harness.auth.on_check = change
    response = client.post(f"/api/connections/{created.id}/check")
    assert response.status_code == 409
    assert response.get_json()["code"] == "connection_conflict"


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "limit=invalid", "cursor=not-a-uuid"])
def test_invalid_pagination_is_a_client_error(client: FlaskClient, query: str) -> None:
    response = client.get(f"/api/connections?{query}")
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"


@pytest.mark.parametrize("payload", [{}, {"name": None}, {"credentials": None}])
def test_patch_rejects_empty_or_null_changes(
    client: FlaskClient, harness: ConnectionHarness, payload: dict[str, object]
) -> None:
    created = harness.service.create_api_key(harness.context, harness.command())
    response = client.patch(f"/api/connections/{created.id}", json=payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"


def test_public_schemas_match_patch_and_timestamp_semantics() -> None:
    payload = connections.EndUserConnectionUpdatePayload.model_json_schema()
    assert payload["minProperties"] == 1
    assert payload["properties"]["name"]["type"] == "string"
    assert payload["properties"]["credentials"]["type"] == "object"
    assert "default" not in payload["properties"]["name"]
    assert "default" not in payload["properties"]["credentials"]
    response = connections.EndUserConnectionResponse.model_json_schema(mode="serialization")
    assert response["properties"]["created_at"]["type"] == "integer"
