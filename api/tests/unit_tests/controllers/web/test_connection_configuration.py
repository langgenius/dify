from collections.abc import Iterator
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialStatus
from controllers.web import bp, connections, wraps
from extensions import ext_application_services
from models.end_user_connection import EndUserConnection
from models.enums import EndUserType
from models.model import App, AppMode, Conversation, EndUser
from services.end_user_connections.errors import ConnectionRequiredError
from tests.helpers.end_user_conversation import ConversationHarness, make_conversation_harness
from tests.helpers.end_user_oauth import make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConversationHarness:
    harness = make_conversation_harness(make_oauth_harness(sqlite_session_factory, monkeypatch))
    services = SimpleNamespace(end_user_connection_execution=harness.execution, connection_selections=harness.service)
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


def test_read_configuration_without_provider_io(
    harness: ConversationHarness, client: FlaskClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": selected.id})
    base.auth.calls.clear()

    def unexpected(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Reading saved references must not resolve Providers.")

    monkeypatch.setattr(harness.oauth.providers, "provider", unexpected)
    queries: tuple[dict[str, str], ...] = ({}, {"conversation_id": conversation_id})
    for query in queries:
        response = client.get("/api/connections/configuration", query_string=query)
        assert response.status_code == 200
        assert response.get_json() == {"workflow_id": base.workflow_id, "connections": {"tool-1": selected.id}}
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
    assert response.get_json() == {"workflow_id": base.workflow_id, "connections": {"tool-1": selected.id}}


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
    assert response.get_json() == {"workflow_id": base.workflow_id, "connections": {"tool-1": selected.id}}
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
    assert client.get("/api/connections/configuration").get_json() == {"workflow_id": None, "connections": {}}
    selected = base.service.create_api_key(base.context, base.command())
    harness.run(None, {"tool-1": selected.id})
    response = client.get("/api/connections/configuration")
    assert response.status_code == 200
    assert response.get_json() == {"workflow_id": base.workflow_id, "connections": {"tool-1": selected.id}}

    with pytest.raises(ConnectionRequiredError):
        harness.run(None)


def test_app_and_conversation_choices_are_independent(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    a = base.service.create_api_key(base.context, base.command("a"))
    b = base.service.create_api_key(base.context, base.command("b"))
    first, second = harness.create_conversation(), harness.create_conversation()
    harness.run(first, {"tool-1": a.id})
    harness.run(second, {"tool-1": b.id})
    assert client.get("/api/connections/configuration").get_json()["connections"] == {"tool-1": b.id}
    assert client.get("/api/connections/configuration", query_string={"conversation_id": first}).get_json()[
        "connections"
    ] == {"tool-1": a.id}
    harness.run(first)
    assert client.get("/api/connections/configuration").get_json()["connections"] == {"tool-1": a.id}
    assert client.get("/api/connections/configuration", query_string={"conversation_id": second}).get_json()[
        "connections"
    ] == {"tool-1": b.id}
    assert client.get(
        "/api/connections/configuration", query_string={"conversation_id": harness.create_conversation()}
    ).get_json()["connections"] == {"tool-1": a.id}


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
    assert client.get("/api/connections/configuration").get_json()["connections"] == {"tool-1": selected.id}


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
    assert response.get_json() == {"workflow_id": base.workflow_id, "connections": {"tool-1": selected.id}}
    assert base.auth.calls == []
    assert base.repository.conversation_selections(base.context, conversation_id) == ()
    with pytest.raises(ConnectionRequiredError):
        harness.run(conversation_id)
    harness.run(conversation_id, response.get_json()["connections"])
    assert harness.saved(conversation_id) == {"tool-1": selected.id}


def test_inaccessible_saved_choice_does_not_fall_back_to_app(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    saved = base.service.create_api_key(base.context, base.command("saved"))
    default = base.service.create_api_key(base.context, base.command("default"))
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": saved.id})
    harness.run(None, {"tool-1": default.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection).where(EndUserConnection.id == saved.id).values(account_id=str(uuid4()))
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.get_json() == {"workflow_id": base.workflow_id, "connections": {"tool-1": None}}


def test_missing_conversation_does_not_fall_back_to_app(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.run(None, {"tool-1": selected.id})
    response = client.get("/api/connections/configuration", query_string={"conversation_id": str(uuid4())})
    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"
