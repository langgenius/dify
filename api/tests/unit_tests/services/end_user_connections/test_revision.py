"""Plugin upgrades invalidate client authorization contracts without republishing."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.end_user_connection import EndUserConnection
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
from services.end_user_connections.errors import ConnectionWorkflowChangedError
from services.end_user_connections.execution import ConnectionExecutionService, ConnectionRunInput
from services.end_user_connections.preflight import ConnectionPreflightInput, ConnectionPreflightService
from services.end_user_connections.revision import connection_revision
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@dataclass
class InstalledPlugins:
    identifiers: Mapping[str, str]
    calls: list[tuple[str, str]] = field(default_factory=list)

    def plugin_unique_identifier(self, tenant_id: str, provider: str) -> str:
        self.calls.append((tenant_id, provider))
        return self.identifiers[provider]


def tool(node_id: str, provider: str, source: str = "end_user") -> dict[str, object]:
    return {
        "id": node_id,
        "data": {
            "type": "tool",
            "provider_id": provider,
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
    workflow_id = str(uuid4())
    graph = {"nodes": [tool("one", calendar), tool("two", mail), tool("three", calendar)]}
    expected = revisions.resolve("tenant", workflow_id, graph)
    assert installed.calls == [("tenant", calendar), ("tenant", mail)]
    graph["nodes"].reverse()
    graph["nodes"].extend([tool("workspace", "vendor/other/other", "workspace"), tool("reuse", calendar, "reuse_node")])
    graph["nodes"].append({**tool("note", "vendor/ignored/ignored"), "type": "custom-note"})
    assert revisions.resolve("tenant", workflow_id, graph) == expected
    assert revisions.resolve("tenant", str(uuid4()), graph) != expected
    # The artifact digest matters even when the semantic version stays unchanged.
    identifiers[mail] = "vendor/mail:1.0@rebuilt"
    assert revisions.resolve("tenant", workflow_id, graph) != expected


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

    with pytest.raises(ConnectionWorkflowChangedError):
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

    with pytest.raises(ConnectionWorkflowChangedError):
        invoke()
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 1


def test_reloaded_contract_accepts_the_new_plugin_artifact(harness: OAuthHarness) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.providers.controller.plugin_unique_identifier = "vendor/calendar:2.0@upgraded"
    revision = connection_revision(harness.base.workflow_id, ["vendor/calendar:2.0@upgraded"])
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
    with pytest.raises(ConnectionWorkflowChangedError):
        harness.finish(started)
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0
