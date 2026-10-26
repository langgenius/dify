"""Plugin upgrades invalidate client authorization contracts without republishing."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import cast
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.end_user_connection import EndUserConnection
from models.workflow import Workflow
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.execution import ConnectionExecutionService, ConnectionRunInput
from services.end_user_connections.preflight import ConnectionPreflightInput, ConnectionPreflightService
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@dataclass
class InstalledPlugins:
    identifiers: Mapping[str, str]
    calls: list[tuple[str, str]] = field(default_factory=list)

    def is_plugin_trusted(self, tenant_id: str, identifier: str) -> bool:
        assert tenant_id
        assert identifier
        return False

    def plugin_unique_identifier(self, tenant_id: str, provider: str) -> str:
        self.calls.append((tenant_id, provider))
        return self.identifiers[provider]


def tool(node_id: str, provider: str, source: str = "end_user") -> dict[str, object]:
    return {
        "id": node_id,
        "data": {
            "type": "tool",
            "provider_id": provider,
            "tool_name": "read",
            "credential_source": source,
            "end_user_auth": {"allowed_credential_types": ["api-key"], "purpose": "Read events"},
        },
    }


def test_revision_tracks_only_involved_plugins_and_ignores_node_order_and_duplicates() -> None:
    calendar = "vendor/calendar/calendar"
    mail = "vendor/mail/mail"
    identifiers = {calendar: "vendor/calendar:1.0@first", mail: "vendor/mail:1.0@second"}
    installed = InstalledPlugins(identifiers)
    revisions = PluginConnectionRevisions(providers=installed)
    app_id = str(uuid4())
    graph = {"nodes": [tool("one", calendar), tool("two", mail), tool("three", calendar)]}
    expected = revisions.resolve("tenant", app_id, graph)
    assert installed.calls == [("tenant", calendar), ("tenant", mail)]
    graph["nodes"].reverse()
    graph["nodes"].extend([tool("workspace", "vendor/other/other", "workspace"), tool("reuse", calendar, "reuse_node")])
    graph["nodes"].append({**tool("note", "vendor/ignored/ignored"), "type": "custom-note"})
    assert revisions.resolve("tenant", app_id, graph) == expected
    assert revisions.resolve("tenant", str(uuid4()), graph) != expected
    # The artifact digest matters even when the semantic version stays unchanged.
    identifiers[mail] = "vendor/mail:1.0@rebuilt"
    assert revisions.resolve("tenant", app_id, graph) != expected


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


def preflight(harness: OAuthHarness) -> ConnectionPreflightService:
    return ConnectionPreflightService(
        connections=harness.base.repository,
        checks=harness.base.service,
        requirements=PublishedPreflightRequirements(
            workflows=harness.base.repository, providers=harness.providers, oauth=harness.gateway
        ),
    )


@pytest.mark.parametrize("entry", ["preflight", "run", "api_key", "oauth"])
def test_old_contract_is_rejected_before_credentials_are_checked(harness: OAuthHarness, entry: str) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.base.auth.calls.clear()
    harness.providers.controller.plugin_unique_identifier = "vendor/calendar:2.0@upgraded"
    command = {"connection_revision": harness.base.connection_revision, "connections": {"tool-1": connection.id}}

    def invoke() -> None:
        if entry == "preflight":
            preflight(harness).check(harness.base.context, ConnectionPreflightInput.model_validate(command))
        elif entry == "run":
            ConnectionExecutionService(preflight=preflight(harness)).prepare(
                harness.base.context,
                ConnectionRunInput.model_validate(command),
                workflow_id=harness.base.workflow_id,
                conversation_id=None,
            )
        elif entry == "api_key":
            harness.base.service.create_api_key(harness.base.context, harness.base.command())
        else:
            harness.start()

    with pytest.raises(ConnectionRevisionChangedError):
        invoke()
    assert harness.base.auth.calls == []
    assert harness.handler.exchanges == 0


@pytest.mark.parametrize("entry", ["preflight", "api_key"])
def test_upgrade_during_credential_check_rejects_the_operation(harness: OAuthHarness, entry: str) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.base.auth.on_check = lambda: setattr(
        harness.providers.controller, "plugin_unique_identifier", "vendor/calendar:2.0@upgraded"
    )

    def invoke() -> None:
        if entry == "preflight":
            preflight(harness).check(
                harness.base.context,
                ConnectionPreflightInput(
                    connection_revision=harness.base.connection_revision, connections={"tool-1": UUID(connection.id)}
                ),
            )
        else:
            harness.base.service.create_api_key(harness.base.context, harness.base.command("replacement-secret"))

    with pytest.raises(ConnectionRevisionChangedError):
        invoke()
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 1


def test_reloaded_contract_accepts_the_new_plugin_artifact(harness: OAuthHarness) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.providers.controller.plugin_unique_identifier = "vendor/calendar:2.0@upgraded"
    with harness.base.sessions() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        revision = PluginConnectionRevisions(providers=harness.providers).resolve(
            harness.base.context.tenant_id, harness.base.context.app_id, workflow.graph_dict
        )
    result = preflight(harness).check(
        harness.base.context,
        ConnectionPreflightInput.model_validate(
            {"connection_revision": revision, "connections": {"tool-1": connection.id}}
        ),
    )
    assert result.ready
    assert result.connection_revision == revision
    assert "workflow_id" not in result.model_dump()


@pytest.mark.parametrize("phase", ["redirect", "exchange"])
def test_oauth_callback_rejects_plugin_changes_after_start(harness: OAuthHarness, phase: str) -> None:
    started = harness.start()

    def upgrade() -> None:
        harness.providers.controller.plugin_unique_identifier = "vendor/calendar:2.0@upgraded"

    if phase == "redirect":
        upgrade()
    else:
        harness.handler.on_exchange = upgrade
    with pytest.raises(ConnectionRevisionChangedError):
        harness.finish(started)
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0


def republish(harness: OAuthHarness) -> None:
    with harness.base.sessions.begin() as session:
        previous = session.get(Workflow, harness.base.workflow_id)
        assert previous is not None
        current = Workflow(
            tenant_id=previous.tenant_id,
            app_id=previous.app_id,
            type=previous.type,
            version="republished",
            graph=previous.graph,
            _features=previous.features,
            created_by=previous.created_by,
        )
        session.add(current)
        session.flush()
        from models.model import App

        app = session.get(App, previous.app_id)
        assert app is not None
        app.workflow_id = current.id
        harness.base.workflow_id = current.id


@pytest.mark.parametrize("entry", ["preflight", "run", "api_key", "oauth"])
def test_republishing_unchanged_requirements_keeps_the_confirmed_revision(harness: OAuthHarness, entry: str) -> None:
    command = harness.base.command()
    oauth = harness.command()
    connection = harness.base.service.create_api_key(harness.base.context, command)
    started = harness.start()
    revision = harness.base.connection_revision
    previous_workflow_id = harness.base.workflow_id
    republish(harness)
    assert previous_workflow_id != harness.base.workflow_id
    assert harness.base.connection_revision == revision
    if entry == "preflight":
        result = preflight(harness).check(
            harness.base.context,
            ConnectionPreflightInput(connection_revision=revision, connections={"tool-1": UUID(connection.id)}),
        )
        assert result.ready
        assert result.workflow_id == harness.base.workflow_id
    elif entry == "run":
        result = ConnectionExecutionService(preflight=preflight(harness)).prepare(
            harness.base.context,
            ConnectionRunInput(connection_revision=revision, connections={"tool-1": UUID(connection.id)}),
            workflow_id=harness.base.workflow_id,
            conversation_id=None,
        )
        assert result.workflow_id == harness.base.workflow_id
    elif entry == "api_key":
        assert harness.base.service.create_api_key(harness.base.context, command).id
    else:
        harness.service.start_oauth(harness.base.context, oauth, callback_url="https://example.com/callback")
        assert harness.finish(started).id


def test_revision_tracks_authentication_content_and_ignores_presentation_changes() -> None:
    from copy import deepcopy

    provider = "vendor/calendar/calendar"
    revisions = PluginConnectionRevisions(providers=InstalledPlugins({provider: "vendor/calendar:1.0@first"}))
    graph = {"nodes": [tool("root", provider)]}
    before = revisions.resolve("tenant", "app", graph)
    presentation = deepcopy(graph)
    presentation["nodes"][0]["position"] = {"x": 100, "y": 100}
    cast(dict[str, object], presentation["nodes"][0]["data"])["title"] = "Renamed tool"
    assert revisions.resolve("tenant", "app", presentation) == before
    changed = deepcopy(graph)
    data = cast(dict[str, object], changed["nodes"][0]["data"])
    cast(dict[str, object], data["end_user_auth"])["purpose"] = "Different access purpose"
    assert revisions.resolve("tenant", "app", changed) != before


def test_republishing_during_a_check_preserves_the_confirmed_contract(harness: OAuthHarness) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    revision = harness.base.connection_revision
    selected_workflow = harness.base.workflow_id
    harness.base.auth.on_check = lambda: republish(harness)
    result = preflight(harness).check(
        harness.base.context,
        ConnectionPreflightInput(connection_revision=revision, connections={"tool-1": UUID(connection.id)}),
    )
    assert result.ready
    assert result.workflow_id == selected_workflow
    assert result.workflow_id != harness.base.workflow_id
    assert result.connection_revision == harness.base.connection_revision


def test_republished_authorization_changes_require_a_new_revision(harness: OAuthHarness) -> None:
    import json

    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    previous = harness.base.connection_revision
    republish(harness)
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["purpose"] = "Changed purpose"
        workflow.graph = json.dumps(graph)
    command = ConnectionPreflightInput(connection_revision=previous, connections={"tool-1": UUID(connection.id)})
    with pytest.raises(ConnectionRevisionChangedError):
        preflight(harness).check(harness.base.context, command)
    assert (
        preflight(harness)
        .check(
            harness.base.context, command.model_copy(update={"connection_revision": harness.base.connection_revision})
        )
        .ready
    )


@pytest.mark.parametrize("credential_type", ["api-key", "oauth2"])
def test_verified_upgrade_inherits_selections_and_returns_current_revision(
    harness: OAuthHarness, credential_type: str
) -> None:
    previous = harness.base.connection_revision
    connection = (
        harness.finish(harness.start())
        if credential_type == "oauth2"
        else harness.base.service.create_api_key(harness.base.context, harness.base.command())
    )
    original = harness.providers.controller.plugin_unique_identifier
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    harness.providers.controller.plugin_unique_identifier = upgraded
    harness.providers.trusted_artifacts.add(upgraded)
    result = preflight(harness).check(
        harness.base.context,
        ConnectionPreflightInput(connection_revision=previous, connections={"tool-1": UUID(connection.id)}),
    )
    assert result.ready
    assert result.connection_revision != previous
    assert harness.base.auth.check_artifacts[-1] == upgraded
    if credential_type == "oauth2":
        stored = harness.base.repository.find(harness.base.context, connection.id)
        assert stored is not None
        assert stored.access.oauth_client is not None
        assert stored.access.oauth_client.plugin_unique_identifier == original
        harness.base.service.delete_connection(
            harness.base.context, connection.id, connection_revision=harness.base.connection_revision
        )
        assert harness.base.auth.revocation_artifacts == [original]


def test_verified_upgrade_does_not_inherit_changed_authorization_requirements(harness: OAuthHarness) -> None:
    import json

    previous = harness.base.connection_revision
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    harness.providers.controller.plugin_unique_identifier = upgraded
    harness.providers.trusted_artifacts.add(upgraded)
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["purpose"] = "Write events"
        workflow.graph = json.dumps(graph)
    with pytest.raises(ConnectionRevisionChangedError) as error:
        preflight(harness).check(
            harness.base.context, ConnectionPreflightInput(connection_revision=previous, connections={})
        )
    assert error.value.previous is not None
    assert error.value.current is not None
    assert error.value.previous.requirements[0].purpose != error.value.current.requirements[0].purpose


@pytest.mark.parametrize("tamper", ["signature", "scope", "payload"])
def test_revision_cannot_forge_trust_or_cross_application_scope(harness: OAuthHarness, tamper: str) -> None:
    import jwt

    from services.end_user_connection_revision_adapters import ConnectionRevisionCodec

    revision = harness.base.connection_revision
    if tamper == "scope":
        snapshot = ConnectionRevisionCodec.decode(revision)
        revision = ConnectionRevisionCodec.encode(snapshot.model_copy(update={"app_id": "another-app"}))
    elif tamper == "payload":
        snapshot = ConnectionRevisionCodec.decode(revision)
        revision = jwt.encode(
            {"aud": "connection_revision", "version": 1, "snapshot": snapshot.model_dump(mode="json")},
            "attacker-secret-key-with-sufficient-length",
            algorithm="HS256",
        )
    else:
        header, payload, signature = revision.split(".")
        revision = ".".join([header, payload, ("A" if signature[0] != "A" else "B") + signature[1:]])
    with pytest.raises(ConnectionRevisionChangedError):
        preflight(harness).check(
            harness.base.context, ConnectionPreflightInput(connection_revision=revision, connections={})
        )
    assert harness.base.auth.calls == []


def test_verified_oauth_upgrade_during_redirect_exchanges_only_with_original_artifact(harness: OAuthHarness) -> None:
    started = harness.start()
    original = harness.providers.controller.plugin_unique_identifier
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    harness.providers.controller.plugin_unique_identifier = upgraded
    harness.providers.trusted_artifacts.add(upgraded)
    assert harness.finish(started).id
    assert harness.handler.requested_artifacts == [original, original]
