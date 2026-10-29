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
def test_read_configuration_without_credential_io(
    harness: ConversationHarness, client: FlaskClient, monkeypatch: pytest.MonkeyPatch, credential_type: str
) -> None:
    base = harness.oauth.base
    selected = (
        harness.oauth.finish(harness.oauth.start())
        if credential_type == "oauth2"
        else base.service.create_api_key(base.context, base.command())
    )
    conversation_id = harness.create_conversation()
    harness.save(conversation_id, {"tool-1": selected.id})
    base.auth.calls.clear()

    def unexpected(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Reading saved references must not validate credentials.")

    monkeypatch.setattr(base.service, "check_connection_result", unexpected)
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
        assert response.get_json() == {"connections": {"tool-1": detail}, "reauthorization_required": False}
        assert "secret" not in response.get_data(as_text=True)
    assert base.auth.calls == []


@pytest.mark.parametrize("publication", ["changed", "missing"])
def test_read_does_not_require_current_publication(
    harness: ConversationHarness, client: FlaskClient, publication: str
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.save(conversation_id, {"tool-1": selected.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(App)
            .where(App.id == base.context.app_id)
            .values({"workflow_id": str(uuid4()) if publication == "changed" else None})
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections", "reauthorization_required"}
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
    harness.save(conversation_id, {"tool-1": selected.id})
    base.auth.calls.clear()
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == selected.id)
            .values(status=ConnectionCredentialStatus.INVALID)
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections", "reauthorization_required"}
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
    assert client.get("/api/connections/configuration").get_json() == {
        "connections": {},
        "reauthorization_required": True,
    }
    selected = base.service.create_api_key(base.context, base.command())
    harness.save(None, {"tool-1": selected.id})
    response = client.get("/api/connections/configuration")
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections", "reauthorization_required"}
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id

    with pytest.raises(ConnectionRequiredError):
        harness.run(None)


def test_app_and_conversation_choices_are_independent(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    a = base.service.create_api_key(base.context, base.command("a"))
    b = base.service.create_api_key(base.context, base.command("b"))
    first, second = harness.create_conversation(), harness.create_conversation()
    harness.save(first, {"tool-1": a.id})
    harness.save(second, {"tool-1": b.id})
    assert client.get("/api/connections/configuration").get_json()["connections"]["tool-1"]["id"] == b.id
    assert (
        client.get("/api/connections/configuration", query_string={"conversation_id": first}).get_json()["connections"][
            "tool-1"
        ]["id"]
        == a.id
    )
    harness.run(first)
    assert client.get("/api/connections/configuration").get_json()["connections"]["tool-1"]["id"] == b.id
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
        == b.id
    )


def test_app_configuration_is_scoped_to_the_end_user(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.save(None, {"tool-1": selected.id})
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
    harness.save(None, {"tool-1": selected.id})
    conversation_id = harness.create_conversation()
    base.auth.calls.clear()
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert set(response.get_json()) == {"connections", "reauthorization_required"}
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id
    assert base.auth.calls == []
    assert not base.repository.configuration(base.context, conversation_id).initialized
    with pytest.raises(ConnectionRequiredError):
        harness.run(conversation_id)
    harness.save(conversation_id, {node: detail["id"] for node, detail in response.get_json()["connections"].items()})
    assert harness.saved(conversation_id) == {"tool-1": selected.id}


@pytest.mark.parametrize("field", ["account_id", "tenant_id"])
def test_inaccessible_saved_choice_does_not_fall_back_to_app(
    harness: ConversationHarness, client: FlaskClient, field: str
) -> None:
    base = harness.oauth.base
    saved = base.service.create_api_key(base.context, base.command("saved"))
    default = base.service.create_api_key(base.context, base.command("default"))
    conversation_id = harness.create_conversation()
    harness.save(conversation_id, {"tool-1": saved.id})
    harness.save(None, {"tool-1": default.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection).where(EndUserConnection.id == saved.id).values({field: str(uuid4())})
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.get_json() == {"connections": {"tool-1": None}, "reauthorization_required": False}


def test_missing_conversation_does_not_fall_back_to_app(harness: ConversationHarness, client: FlaskClient) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.save(None, {"tool-1": selected.id})
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
    harness.save(None, {"tool-1": first.id, "tool-2": second.id, "tool-3": first.id})
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


@pytest.mark.parametrize("scope", ["app", "conversation"])
def test_save_authorizes_without_execution_or_credential_checks(
    harness: ConversationHarness, client: FlaskClient, scope: str
) -> None:
    from models.end_user_connection import AppConnection, EndUserConnectionRevisionAcceptance
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation() if scope == "conversation" else None
    revision = base.connection_revision
    with harness.sessions.begin() as session:
        session.execute(sa.delete(EndUserConnectionRevisionAcceptance))
    base.auth.calls.clear()
    payload = {"connection_revision": revision, "connections": {"tool-1": selected.id}}
    if conversation_id is not None:
        payload["conversation_id"] = conversation_id
    response = client.put("/api/connections/configuration", json=payload)
    assert response.status_code == 200
    assert response.get_json()["reauthorization_required"] is False
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id
    assert "secret" not in response.get_data(as_text=True)
    assert base.auth.calls == []
    with harness.sessions() as session:
        acceptance = session.scalar(sa.select(EndUserConnectionRevisionAcceptance))
        assert acceptance is not None
        assert acceptance.revision_id == revision
        assert acceptance.reason == "approved"
        saved = session.scalar(sa.select(AppConnection))
        assert saved is not None
        assert saved.source_run_id is None
        assert session.scalar(sa.select(sa.func.count()).select_from(WorkflowRun)) == 0
    query: dict[str, str] = {"conversation_id": conversation_id} if conversation_id is not None else {}
    assert client.get("/api/connections/configuration", query_string=query).get_json() == response.get_json()


@pytest.mark.parametrize("scope", ["app", "conversation"])
def test_clear_configuration_does_not_restore_newer_app_defaults(
    harness: ConversationHarness, client: FlaskClient, scope: str
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation() if scope == "conversation" else None
    harness.save(conversation_id, {"tool-1": selected.id})
    response = client.put(
        "/api/connections/configuration",
        json={
            "conversation_id": conversation_id,
            "connection_revision": base.connection_revision,
            "connections": {},
        },
    )
    assert response.status_code == 200
    assert response.get_json() == {"connections": {}, "reauthorization_required": False}
    if conversation_id is not None:
        harness.save(None, {"tool-1": selected.id})
    query: dict[str, str] = {"conversation_id": conversation_id} if conversation_id is not None else {}
    assert client.get("/api/connections/configuration", query_string=query).get_json() == response.get_json()
    if conversation_id is not None:
        with pytest.raises(ConnectionRequiredError):
            harness.run(conversation_id)


@pytest.mark.parametrize("change", ["purpose", "tool", "credential_type", "add_node", "remove_node", "layout"])
def test_builder_changes_report_reauthorization_without_losing_choices_or_recording_consent(
    harness: ConversationHarness, client: FlaskClient, change: str
) -> None:
    from models.end_user_connection import EndUserConnectionRevisionAcceptance

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.save(conversation_id, {"tool-1": selected.id})
    with harness.sessions.begin() as session:
        session.execute(sa.delete(EndUserConnectionRevisionAcceptance))
        old = session.get(Workflow, base.workflow_id)
        assert old is not None
        graph = old.graph_dict
        data = graph["nodes"][0]["data"]
        if change == "purpose":
            data["end_user_auth"]["purpose"] = "Write calendar"
        elif change == "tool":
            data["tool_name"] = "write"
        elif change == "credential_type":
            data["end_user_auth"]["allowed_credential_types"] = ["api-key"]
            data["end_user_auth"].pop("oauth_client_type", None)
        elif change == "add_node":
            node = deepcopy(graph["nodes"][0])
            node["id"] = "tool-2"
            graph["nodes"].append(node)
        elif change == "remove_node":
            graph["nodes"].clear()
        else:
            graph["nodes"][0]["position"] = {"x": 100, "y": 200}
        current = Workflow(
            tenant_id=old.tenant_id,
            app_id=old.app_id,
            type=old.type,
            version="updated",
            graph=json.dumps(graph),
            _features=old.features,
            created_by=old.created_by,
        )
        session.add(current)
        session.flush()
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(workflow_id=current.id))
    base.auth.calls.clear()
    queries: tuple[dict[str, str], ...] = ({}, {"conversation_id": conversation_id})
    for query in queries:
        response = client.get("/api/connections/configuration", query_string=query)
        assert response.status_code == 200
        assert response.get_json()["connections"]["tool-1"]["id"] == selected.id
        assert response.get_json()["reauthorization_required"] is (change not in {"layout", "remove_node"})
    assert base.auth.calls == []
    with harness.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0


@pytest.mark.parametrize("trusted", [False, True])
def test_configuration_reports_plugin_upgrade_compatibility(
    harness: ConversationHarness, client: FlaskClient, trusted: bool
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.save(None, {"tool-1": selected.id})
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    harness.oauth.providers.controller.plugin_unique_identifier = upgraded
    if trusted:
        harness.oauth.providers.trusted_artifacts.add(upgraded)
    response = client.get("/api/connections/configuration")
    assert response.status_code == 200
    assert response.get_json()["reauthorization_required"] is not trusted
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id


def test_oauth_client_rotation_requires_new_app_authorization(
    harness: ConversationHarness, client: FlaskClient
) -> None:
    from models.tools import ToolOAuthTenantClient

    selected = harness.oauth.finish(harness.oauth.start())
    harness.save(None, {"tool-1": selected.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(ToolOAuthTenantClient)
            .where(ToolOAuthTenantClient.tenant_id == harness.oauth.base.context.tenant_id)
            .values(encrypted_oauth_params=json.dumps({"client_id": "different-client"}))
        )
    response = client.get("/api/connections/configuration")
    assert response.status_code == 200
    assert response.get_json()["reauthorization_required"] is True


def test_reauthorization_is_scoped_to_the_returned_configuration(
    harness: ConversationHarness, client: FlaskClient
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    first, second = harness.create_conversation(), harness.create_conversation()
    harness.save(first, {"tool-1": selected.id})
    harness.save(second, {"tool-1": selected.id})
    with harness.sessions.begin() as session:
        workflow = session.get(Workflow, base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["purpose"] = "Read additional calendar data"
        workflow.graph = json.dumps(graph)
    assert client.get("/api/connections/configuration").get_json()["reauthorization_required"] is True
    harness.save(first, {"tool-1": selected.id})
    assert client.get("/api/connections/configuration").get_json()["reauthorization_required"] is False
    assert (
        client.get("/api/connections/configuration", query_string={"conversation_id": first}).get_json()[
            "reauthorization_required"
        ]
        is False
    )
    assert (
        client.get("/api/connections/configuration", query_string={"conversation_id": second}).get_json()[
            "reauthorization_required"
        ]
        is True
    )


@pytest.mark.parametrize(
    "invalid", ["stale_revision", "unknown_node", "foreign_connection", "missing_revision", "foreign_conversation"]
)
def test_rejected_save_preserves_choices_and_does_not_record_authorization(
    harness: ConversationHarness, client: FlaskClient, invalid: str
) -> None:
    from models.end_user_connection import EndUserConnectionRevisionAcceptance

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    harness.save(None, {"tool-1": selected.id})
    before = client.get("/api/connections/configuration").get_json()
    payload = {"connection_revision": base.connection_revision, "connections": {"tool-1": selected.id}}
    if invalid == "stale_revision":
        payload["connection_revision"] = str(uuid4())
    elif invalid == "unknown_node":
        payload["connections"] = {"missing": selected.id}
    elif invalid == "foreign_connection":
        payload["connections"] = {"tool-1": str(uuid4())}
    elif invalid == "missing_revision":
        payload.pop("connection_revision")
    else:
        payload["conversation_id"] = str(uuid4())
    with harness.sessions.begin() as session:
        session.execute(sa.delete(EndUserConnectionRevisionAcceptance))
    response = client.put("/api/connections/configuration", json=payload)
    assert response.status_code == {"stale_revision": 409, "foreign_connection": 404, "foreign_conversation": 404}.get(
        invalid, 400
    )
    assert client.get("/api/connections/configuration").get_json() == before
    with harness.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0


def test_partial_and_invalid_credential_choices_can_be_saved_without_readiness(
    harness: ConversationHarness, client: FlaskClient
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    with harness.sessions.begin() as session:
        workflow = session.get(Workflow, base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        node = deepcopy(graph["nodes"][0])
        node["id"] = "tool-2"
        graph["nodes"].append(node)
        workflow.graph = json.dumps(graph)
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == selected.id)
            .values(status=ConnectionCredentialStatus.INVALID)
        )
    base.auth.calls.clear()
    response = client.put(
        "/api/connections/configuration",
        json={
            "connection_revision": base.connection_revision,
            "connections": {"tool-1": selected.id, "tool-2": None},
        },
    )
    assert response.status_code == 200
    assert response.get_json()["reauthorization_required"] is False
    assert response.get_json()["connections"]["tool-1"]["credential_status"] == "invalid"
    assert base.auth.calls == []


def test_authorization_failure_rolls_back_both_scopes(
    harness: ConversationHarness, client: FlaskClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.end_user_connection import EndUserConnectionRevisionAcceptance
    from services.end_user_connections.entities import WebConnectionContext
    from services.end_user_connections.errors import ConnectionConflictError
    from services.end_user_connections.revision import ConnectionRevisionAcceptance

    base = harness.oauth.base
    first = base.service.create_api_key(base.context, base.command("first"))
    second = base.service.create_api_key(base.context, base.command("second"))
    conversation_id = harness.create_conversation()
    harness.save(conversation_id, {"tool-1": first.id})
    with harness.sessions.begin() as session:
        session.execute(sa.delete(EndUserConnectionRevisionAcceptance))
    record = base.repository._record_revision_acceptance

    def fail_after_acceptance(
        session: Session, context: WebConnectionContext, acceptance: ConnectionRevisionAcceptance
    ) -> None:
        record(session, context, acceptance)
        raise ConnectionConflictError()

    monkeypatch.setattr(base.repository, "_record_revision_acceptance", fail_after_acceptance)
    response = client.put(
        "/api/connections/configuration",
        json={
            "conversation_id": conversation_id,
            "connection_revision": base.connection_revision,
            "connections": {"tool-1": second.id},
        },
    )
    assert response.status_code == 409
    queries: tuple[dict[str, str], ...] = ({}, {"conversation_id": conversation_id})
    for query in queries:
        assert (
            client.get("/api/connections/configuration", query_string=query).get_json()["connections"]["tool-1"]["id"]
            == first.id
        )
    with harness.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0


@pytest.mark.parametrize("change", ["connection", "requirements", "client"])
def test_save_rechecks_database_state_after_metadata_resolution(
    harness: ConversationHarness, client: FlaskClient, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    from collections.abc import Mapping

    from models.end_user_connection import AppConnection, EndUserConnectionRevisionAcceptance
    from models.tools import ToolOAuthTenantClient
    from services.end_user_connections.entities import ConnectionAccessRecord, WebConnectionContext
    from services.end_user_connections.revision import ConnectionRevisionAcceptance
    from services.end_user_connections.selections import SavedConnectionSelection

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    revision = base.connection_revision
    with harness.sessions.begin() as session:
        session.execute(sa.delete(EndUserConnectionRevisionAcceptance))
    save = base.repository.save_configuration

    def mutate_before_commit(
        context: WebConnectionContext,
        *,
        workflow_id: str,
        conversation_id: str | None,
        selections: tuple[SavedConnectionSelection, ...],
        records: Mapping[str, ConnectionAccessRecord],
        acceptance: ConnectionRevisionAcceptance,
    ) -> None:
        with harness.sessions.begin() as session:
            if change == "connection":
                session.execute(
                    sa.update(EndUserConnection).where(EndUserConnection.id == selected.id).values(revision=2)
                )
            elif change == "client":
                session.execute(
                    sa.update(ToolOAuthTenantClient)
                    .where(ToolOAuthTenantClient.tenant_id == base.context.tenant_id)
                    .values(encrypted_oauth_params=json.dumps({"client_id": "rotated"}))
                )
            else:
                workflow = session.get(Workflow, base.workflow_id)
                assert workflow is not None
                graph = workflow.graph_dict
                graph["nodes"][0]["data"]["end_user_auth"]["purpose"] = "Changed before commit"
                workflow.graph = json.dumps(graph)
        save(
            context,
            workflow_id=workflow_id,
            conversation_id=conversation_id,
            selections=selections,
            records=records,
            acceptance=acceptance,
        )

    monkeypatch.setattr(base.repository, "save_configuration", mutate_before_commit)
    response = client.put(
        "/api/connections/configuration",
        json={
            "connection_revision": revision,
            "connections": {"tool-1": selected.id},
        },
    )
    assert response.status_code == 409
    with harness.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AppConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0
        end_user = session.get(EndUser, base.context.end_user_id)
        assert end_user is not None
        assert end_user.connection_configuration_revision is None


def test_repeated_save_is_idempotent(harness: ConversationHarness, client: FlaskClient) -> None:
    from models.end_user_connection import AppConnection, EndUserConnectionRevisionAcceptance

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    payload = {"connection_revision": base.connection_revision, "connections": {"tool-1": selected.id}}
    first = client.put("/api/connections/configuration", json=payload)
    second = client.put("/api/connections/configuration", json=payload)
    assert first.status_code == second.status_code == 200
    assert first.get_json() == second.get_json()
    with harness.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AppConnection)) == 1
        assert (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(EndUserConnectionRevisionAcceptance)
                .where(EndUserConnectionRevisionAcceptance.revision_id == base.connection_revision)
            )
            == 1
        )


def test_legacy_choices_remain_readable_until_explicit_authorization(
    harness: ConversationHarness, client: FlaskClient
) -> None:
    from services.end_user_connections.errors import ConnectionRevisionChangedError

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.save(conversation_id, {"tool-1": selected.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(Conversation)
            .where(Conversation.id == conversation_id)
            .values(connection_configuration_revision=None)
        )
    response = client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert response.get_json()["connections"]["tool-1"]["id"] == selected.id
    assert response.get_json()["reauthorization_required"] is True
    with pytest.raises(ConnectionRevisionChangedError):
        harness.run(conversation_id)
    harness.save(conversation_id, {"tool-1": selected.id})
    assert (
        client.get("/api/connections/configuration", query_string={"conversation_id": conversation_id}).get_json()[
            "reauthorization_required"
        ]
        is False
    )
