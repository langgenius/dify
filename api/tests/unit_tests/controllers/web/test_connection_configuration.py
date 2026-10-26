import json
from collections.abc import Iterator
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialStatus
from controllers.web import bp, connections, wraps
from extensions import ext_application_services
from models.end_user_connection import EndUserConnection
from models.enums import EndUserType
from models.model import App, AppMode, Conversation, EndUser
from models.workflow import Workflow
from services.end_user_connections.errors import ConnectionRequiredError
from tests.helpers.end_user_conversation import ConversationHarness, make_conversation_harness
from tests.helpers.end_user_oauth import make_oauth_harness

pytestmark = pytest.mark.usefixtures("connection_revision_key")


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConversationHarness:
    harness = make_conversation_harness(make_oauth_harness(sqlite_session_factory, monkeypatch))
    services = SimpleNamespace(
        end_user_connection_execution=harness.execution,
        connection_selections=harness.service,
        end_user_connections=harness.oauth.base.service,
    )
    monkeypatch.setattr(ext_application_services, "application_services", lambda: services)
    monkeypatch.setattr(connections, "application_services", lambda: services)
    return harness


@pytest.fixture
def client(harness: ConversationHarness, monkeypatch: pytest.MonkeyPatch) -> Iterator[FlaskClient]:
    def identity() -> tuple[App, EndUser]:
        base = harness.oauth.base
        with harness.sessions() as session:
            app = session.get(App, base.context.app_id)
            user = session.get(EndUser, base.context.end_user_id)
            assert app is not None
            assert user is not None
            return app, user

    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with app.test_client() as http:
        yield http


@pytest.mark.parametrize("credential_type", ["api-key", "oauth2"])
def test_read_configuration_without_provider_io(
    harness: ConversationHarness, client: FlaskClient, monkeypatch: pytest.MonkeyPatch, credential_type: str
) -> None:
    base = harness.oauth.base
    selected = (
        harness.oauth.finish(harness.oauth.start())
        if credential_type == "oauth2"
        else base.service.create_api_key(base.context, base.command())
    )
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": selected.id})
    base.auth.calls.clear()

    def unexpected(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Reading saved references must not resolve Providers.")

    monkeypatch.setattr(harness.oauth.providers, "provider", unexpected)
    detail = client.get(f"/api/connections/{selected.id}").get_json()
    assert detail["id"] == selected.id
    assert detail["name"] == selected.name
    assert detail["credential_type"] == credential_type
    assert detail["provider"] == selected.provider
    for field in ("created_at", "updated_at", "last_active_at"):
        assert isinstance(detail[field], int)
    assert detail["expires_at"] is None or isinstance(detail["expires_at"], int)
    assert set(detail) == {
        "id",
        "name",
        "provider",
        "credential_type",
        "credential_status",
        "account_label",
        "expires_at",
        "created_at",
        "updated_at",
        "last_active_at",
    }
    queries: tuple[dict[str, str], ...] = ({}, {"conversation_id": conversation_id})
    for query in queries:
        response = client.get("/api/connections/configuration", query_string=query)
        assert response.status_code == 200
        assert response.get_json() == {"connections": {"tool-1": detail}}
        assert "secret" not in response.get_data(as_text=True)
    assert base.auth.calls == []


@pytest.mark.parametrize("publication", ["changed", "missing"])
def test_read_does_not_require_current_publication(
    harness: ConversationHarness, client: FlaskClient, publication: str
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": selected.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(App)
            .where(App.id == base.context.app_id)
            .values({"workflow_id": str(uuid4()) if publication == "changed" else None})
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections"}
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id


@pytest.mark.parametrize("field", ["from_end_user_id", "app_id", "is_deleted"])
def test_inaccessible_empty_conversation_is_not_found(
    harness: ConversationHarness, client: FlaskClient, field: str
) -> None:
    conversation_id = harness.create_conversation()
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(Conversation)
            .where(Conversation.id == conversation_id)
            .values({field: True if field == "is_deleted" else str(uuid4())})
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"


def test_invalid_credentials_remain_a_saved_reference_without_a_readiness_claim(
    harness: ConversationHarness, client: FlaskClient
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": selected.id})
    base.auth.calls.clear()
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == selected.id)
            .values(status=ConnectionCredentialStatus.INVALID)
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections"}
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id
    assert response.get_json()["connections"]["tool-1"]["credential_status"] == "invalid"
    assert base.auth.calls == []


def test_plain_workflow_has_no_conversation_configuration(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    with harness.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=AppMode.WORKFLOW))
    response = client.get("/api/connections/configuration", query_string={"conversation_id": str(uuid4())})
    assert response.status_code == 400
    assert response.get_json()["code"] == "connection_configuration_invalid"


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_app_defaults_support_workflow_and_new_chatflow(
    harness: ConversationHarness, client: FlaskClient, mode: AppMode
) -> None:
    base = harness.oauth.base
    with harness.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=mode))
    assert client.get("/api/connections/configuration").get_json() == {"connections": {}}
    selected = base.service.create_api_key(base.context, base.command())
    harness.run(None, {"tool-1": selected.id})
    response = client.get("/api/connections/configuration")
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections"}
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id

    with pytest.raises(ConnectionRequiredError):
        harness.run(None)


def test_app_and_conversation_choices_are_independent(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    a = base.service.create_api_key(base.context, base.command("a"))
    b = base.service.create_api_key(base.context, base.command("b"))
    first, second = harness.create_conversation(), harness.create_conversation()
    harness.run(first, {"tool-1": a.id})
    harness.run(second, {"tool-1": b.id})
    assert client.get("/api/connections/configuration").get_json()["connections"]["tool-1"]["id"] == b.id
    assert (
        client.get("/api/connections/configuration", query_string={"conversation_id": first}).get_json()["connections"][
            "tool-1"
        ]["id"]
        == a.id
    )
    harness.run(first)
    assert client.get("/api/connections/configuration").get_json()["connections"]["tool-1"]["id"] == a.id
    assert (
        client.get("/api/connections/configuration", query_string={"conversation_id": second}).get_json()[
            "connections"
        ]["tool-1"]["id"]
        == b.id
    )
    assert (
        client.get(
            "/api/connections/configuration", query_string={"conversation_id": harness.create_conversation()}
        ).get_json()["connections"]["tool-1"]["id"]
        == a.id
    )


def test_app_configuration_is_scoped_to_the_end_user(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.run(None, {"tool-1": selected.id})
    with harness.sessions.begin() as session:
        other = EndUser(
            tenant_id=base.context.tenant_id,
            app_id=base.context.app_id,
            type=EndUserType.BROWSER,
            account_id=None,
            session_id=str(uuid4()),
        )
        session.add(other)
        session.flush()
        other_context = replace(base.context, end_user_id=other.id, account_id=None)
    assert harness.service.get(other_context, None).connections == {}
    assert client.get("/api/connections/configuration").get_json()["connections"]["tool-1"]["id"] == selected.id


def test_invalid_configuration_query_does_not_fall_back_to_app(client: FlaskClient) -> None:
    response = client.get("/api/connections/configuration", query_string={"conversation_id": "invalid"})
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"


def test_empty_conversation_uses_app_choices_only_for_form_initialization(
    harness: ConversationHarness, client: FlaskClient
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.run(None, {"tool-1": selected.id})
    conversation_id = harness.create_conversation()
    base.auth.calls.clear()
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections"}
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id
    assert base.auth.calls == []
    assert base.repository.conversation_selections(base.context, conversation_id) == ()
    with pytest.raises(ConnectionRequiredError):
        harness.run(conversation_id)
    harness.run(conversation_id, {node: detail["id"] for node, detail in response.get_json()["connections"].items()})
    assert harness.saved(conversation_id) == {"tool-1": selected.id}


@pytest.mark.parametrize("field", ["account_id", "tenant_id"])
def test_inaccessible_saved_choice_does_not_fall_back_to_app(
    harness: ConversationHarness, client: FlaskClient, field: str
) -> None:
    base = harness.oauth.base
    saved = base.service.create_api_key(base.context, base.command("saved"))
    default = base.service.create_api_key(base.context, base.command("default"))
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": saved.id})
    harness.run(None, {"tool-1": default.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection).where(EndUserConnection.id == saved.id).values({field: str(uuid4())})
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.get_json() == {"connections": {"tool-1": None}}


def test_missing_conversation_does_not_fall_back_to_app(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.run(None, {"tool-1": selected.id})
    response = client.get("/api/connections/configuration", query_string={"conversation_id": str(uuid4())})
    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"


def test_configuration_loads_multiple_connection_details_without_secrets_in_one_query(
    harness: ConversationHarness, client: FlaskClient
) -> None:
    base = harness.oauth.base
    first = base.service.create_api_key(base.context, base.command().model_copy(update={"name": "First"}))
    second = base.service.create_api_key(base.context, base.command().model_copy(update={"name": "Second"}))
    with harness.sessions.begin() as session:
        workflow = session.get(Workflow, base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        for node_id in ("tool-2", "tool-3"):
            node = deepcopy(graph["nodes"][0])
            node["id"] = node_id
            graph["nodes"].append(node)
        workflow.graph = json.dumps(graph)
    harness.run(None, {"tool-1": first.id, "tool-2": second.id, "tool-3": first.id})
    base.auth.calls.clear()
    engine = harness.sessions.kw["bind"]
    assert isinstance(engine, sa.Engine)
    statements: list[str] = []

    def capture(
        _connection: sa.Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: sa.ExecutionContext,
        _executemany: bool,
    ) -> None:
        if "FROM end_user_connections" in statement:
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get("/api/connections/configuration")
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 200
    details = response.get_json()["connections"]
    assert {node: item["id"] for node, item in details.items()} == {
        "tool-1": first.id,
        "tool-2": second.id,
        "tool-3": first.id,
    }
    assert details["tool-1"]["name"] == "First"
    assert details["tool-2"]["name"] == "Second"
    assert len(statements) == 1
    assert "encrypted_credentials" not in statements[0]
    assert "oauth_client_id" not in statements[0]
    assert base.auth.calls == []
