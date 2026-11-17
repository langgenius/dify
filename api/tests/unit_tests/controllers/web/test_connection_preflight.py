import json
from collections.abc import Callable, Iterator
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
from models.model import App, AppMode, EndUser, Site
from models.workflow import Workflow
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
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
            workflows=harness.base.repository,
            snapshots=harness.base.repository,
            providers=harness.providers,
            oauth=harness.gateway,
        ),
    )
    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    monkeypatch.setattr(
        connection_preflight, "application_services", lambda: SimpleNamespace(end_user_connection_preflight=service)
    )

    def plugin_readme(tenant_id: str, identifier: str, language: str) -> str:
        assert tenant_id == harness.base.context.tenant_id
        assert identifier == harness.providers.controller.plugin_unique_identifier
        return f"# Plugin documentation ({language})"

    definitions = AppDefinitionQueryService(
        definitions=AppDefinitionQueryRepository(session_factory=harness.base.sessions),
        plugin_readme=plugin_readme,
        plugin_asset=lambda *_args: b"",
        builtin_icon_url_prefix="",
        connection_revisions=PluginConnectionRevisions(providers=harness.providers, snapshots=harness.base.repository),
    )
    monkeypatch.setattr(app_controller, "application_services", lambda: SimpleNamespace(app_definitions=definitions))
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with app.test_client() as client:
        yield client


def test_explicit_version_and_selection_response(client: FlaskClient, harness: OAuthHarness) -> None:
    from core.plugin.plugin_service import PluginService

    harness.providers.controller.entity.identity.label.pt_BR = "Calendario"
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(Site).where(Site.app_id == harness.base.context.app_id).values(default_language="pt-BR")
        )
    parameters = client.get("/api/parameters")
    assert parameters.status_code == 200
    version = parameters.get_json()["connection_revision"]
    assert version == harness.base.connection_revision
    assert parameters.get_json()["requires_end_user_connections"] is True
    assert parameters.get_json()["connection_requirements"] == [
        {
            "node_id": "tool-1",
            "node_ids": ["tool-1"],
            "title": "tool-1",
            "purpose": "Read calendar",
            "provider": "vendor/calendar/calendar",
            "provider_label": "Calendario",
            "plugin_unique_identifier": harness.providers.controller.plugin_unique_identifier,
            "icon": PluginService.get_plugin_icon_url(tenant_id=harness.base.context.tenant_id, filename="icon.svg"),
            "icon_dark": None,
            "allowed_credential_types": ["api-key", "oauth2"],
        }
    ]
    assert harness.base.auth.calls == []
    readme = client.get(
        "/api/connections/readme",
        query_string={
            "plugin_unique_identifier": parameters.get_json()["connection_requirements"][0]["plugin_unique_identifier"],
            "language": "pt_BR",
        },
    )
    assert readme.status_code == 200
    assert readme.get_json() == {"readme": "# Plugin documentation (pt_BR)"}
    response = client.post("/api/connections/preflight", json={"connection_revision": version, "connections": {}})
    assert response.status_code == 200
    data = response.get_json()
    assert data["connection_revision"] == harness.base.connection_revision
    assert data["ready"] is False
    assert data["connections"][0]["status"] == "disconnected"
    assert data["connections"] == [
        {"node_id": "tool-1", "connection_id": None, "status": "disconnected", "check": None}
    ]
    assert set(data) == {"connection_revision", "connections", "ready"}
    created = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    response = client.post(
        "/api/connections/preflight",
        json={"connection_revision": data["connection_revision"], "connections": {"tool-1": created.id}},
    )
    assert response.status_code == 200
    assert response.get_json()["ready"] is True
    assert response.get_json()["connections"][0]["connection_id"] == created.id
    assert "original-secret" not in response.get_data(as_text=True)
    assert "encrypted_credentials" not in response.get_data(as_text=True)
    assert "account_id" not in response.get_data(as_text=True)


@pytest.mark.parametrize(
    "identifier",
    ["vendor/other:1.0.0@" + "a" * 64, "vendor/calendar:0.0.1@" + "b" * 64],
)
def test_readme_rejects_plugins_outside_current_requirements(client: FlaskClient, identifier: str) -> None:
    response = client.get("/api/connections/readme", query_string={"plugin_unique_identifier": identifier})
    assert response.status_code == 400
    assert response.get_json()["code"] == "app_unavailable"


def test_readme_defaults_to_console_language(client: FlaskClient) -> None:
    requirement = client.get("/api/parameters").get_json()["connection_requirements"][0]
    response = client.get(
        "/api/connections/readme", query_string={"plugin_unique_identifier": requirement["plugin_unique_identifier"]}
    )
    assert response.status_code == 200
    assert response.get_json() == {"readme": "# Plugin documentation (en-US)"}


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
        json={"connection_revision": harness.base.connection_revision, "connections": {"tool-1": connection.id}},
    )
    assert response.status_code == 200
    assert response.get_json()["ready"] is False
    requirement = response.get_json()["connections"][0]
    assert requirement["status"] is None
    assert requirement["check"]["status"] == "temporarily_unavailable"


def test_stale_workflow_is_documented_conflict(client: FlaskClient, harness: OAuthHarness) -> None:
    response = client.post(
        "/api/connections/preflight",
        json={"connection_revision": "00000000-0000-7000-8000-000000000001", "connections": {}},
    )
    assert response.status_code == 409
    assert response.get_json()["code"] == "connection_revision_changed"
    assert harness.base.auth.calls == []


def test_foreign_or_missing_chatflow_session_is_not_found(client: FlaskClient, harness: OAuthHarness) -> None:
    with harness.base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == harness.base.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
    response = client.post(
        "/api/connections/preflight",
        json={
            "connection_revision": harness.base.connection_revision,
            "conversation_id": str(uuid4()),
            "connections": {},
        },
    )
    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"


def test_guest_can_discover_requirements(
    client: FlaskClient, harness: OAuthHarness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == harness.base.context.end_user_id).values(account_id=None)
        )
    response = client.get("/api/parameters")
    assert response.status_code == 200
    assert response.get_json()["connection_requirements"][0]["node_id"] == "tool-1"
    assert harness.base.auth.calls == []


@pytest.mark.parametrize(
    ("payload", "valid"),
    [
        ({"connections": {}}, False),
        ({"connections": {}, "connection_revision": "00000000-0000-7000-8000-000000000001"}, True),
        ({"connections": {}, "connection_revision": None}, False),
        ({"connections": {"tool-1": None}}, False),
        ({"connections": {"tool-1": str(uuid4())}, "connection_revision": None}, False),
        (
            {"connections": {"tool-1": str(uuid4())}, "connection_revision": "00000000-0000-7000-8000-000000000001"},
            True,
        ),
        ({}, False),
    ],
)
def test_request_schema_always_requires_a_version(payload: dict[str, object], valid: bool) -> None:
    from jsonschema import Draft202012Validator

    schema = connection_preflight.EndUserConnectionPreflightPayload.model_json_schema()
    assert Draft202012Validator(schema).is_valid(payload) == valid


@pytest.mark.parametrize("personal_tools", [False, True])
def test_anonymous_policy_preserves_page_access_and_workflows_without_personal_credentials(
    client: FlaskClient, harness: OAuthHarness, config_overrides: Callable[..., None], personal_tools: bool
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == harness.base.context.end_user_id).values(account_id=None)
        )
        if not personal_tools:
            workflow = session.get(Workflow, harness.base.workflow_id)
            assert workflow is not None
            graph = workflow.graph_dict
            node = graph["nodes"][0]["data"]
            node["credential_source"] = "workspace"
            node.pop("end_user_auth")
            workflow.graph = json.dumps(graph)
    parameters = client.get("/api/parameters")
    assert parameters.status_code == 200
    assert parameters.get_json()["allow_anonymous_end_user_auth"] is False
    assert bool(parameters.get_json()["connection_requirements"]) is personal_tools
    response = client.post(
        "/api/connections/preflight",
        json={"connection_revision": parameters.get_json()["connection_revision"], "connections": {}},
    )
    if personal_tools:
        assert response.status_code == 401
        assert response.get_json()["code"] == "end_user_login_required"
    else:
        assert response.status_code == 200
        assert response.get_json()["connections"] == []
        assert response.get_json()["ready"] is True
    assert harness.base.auth.calls == []


def test_parameters_replace_workflow_id_and_plugin_upgrade_invalidates_the_revision(
    client: FlaskClient, harness: OAuthHarness
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.base.auth.calls.clear()
    before = client.get("/api/parameters").get_json()
    assert "workflow_id" not in before
    harness.providers.controller.plugin_unique_identifier = "vendor/calendar:1.0.0@" + "b" * 64
    after = client.get("/api/parameters").get_json()
    assert before["connection_revision"] != after["connection_revision"]
    old_requirement = before["connection_requirements"][0]
    new_requirement = after["connection_requirements"][0]
    assert old_requirement["plugin_unique_identifier"] != new_requirement["plugin_unique_identifier"]
    assert {key: value for key, value in old_requirement.items() if key != "plugin_unique_identifier"} == {
        key: value for key, value in new_requirement.items() if key != "plugin_unique_identifier"
    }
    assert (
        client.get(
            "/api/connections/readme",
            query_string={"plugin_unique_identifier": old_requirement["plugin_unique_identifier"]},
        ).status_code
        == 400
    )
    assert (
        client.get(
            "/api/connections/readme",
            query_string={"plugin_unique_identifier": new_requirement["plugin_unique_identifier"]},
        ).status_code
        == 200
    )
    snapshot = harness.base.repository.get_revision(
        harness.base.context.tenant_id, harness.base.context.app_id, after["connection_revision"]
    )
    assert snapshot is not None
    assert new_requirement["provider"] == snapshot.providers[0].provider
    assert new_requirement["plugin_unique_identifier"] == snapshot.providers[0].plugin_unique_identifier
    response = client.post(
        "/api/connections/preflight", json={"connection_revision": before["connection_revision"], "connections": {}}
    )
    assert response.status_code == 409
    assert response.get_json()["code"] == "connection_revision_changed"
    assert harness.base.auth.calls == []
    current = client.post(
        "/api/connections/preflight",
        json={"connection_revision": after["connection_revision"], "connections": {"tool-1": connection.id}},
    )
    assert current.status_code == 200
    assert current.get_json()["ready"] is True
    assert current.get_json()["connection_revision"] == after["connection_revision"]
    assert harness.base.auth.check_artifacts[-1] == new_requirement["plugin_unique_identifier"]


def test_unverified_plugin_change_returns_only_current_revision(client: FlaskClient, harness: OAuthHarness) -> None:
    previous = harness.base.connection_revision
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    harness.providers.controller.plugin_unique_identifier = upgraded
    response = client.post("/api/connections/preflight", json={"connection_revision": previous, "connections": {}})
    assert response.status_code == 409
    payload = response.get_json()
    assert payload["code"] == "connection_revision_changed"
    details = payload["details"]
    assert set(details) == {"connection_revision"}
    assert details["connection_revision"] != previous
    assert harness.base.auth.calls == []
