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
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.preflight import ConnectionPreflightInput, ConnectionPreflightService
from services.end_user_connections.revision import ConnectionProviderMetadata
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@dataclass
class InstalledPlugins:
    identifiers: Mapping[str, str]
    calls: list[tuple[str, str]] = field(default_factory=list)
    icon: str = "/plugin-icon.svg"

    def provider_metadata(self, tenant_id: str, provider: str) -> ConnectionProviderMetadata:
        return ConnectionProviderMetadata(provider, self.plugin_unique_identifier(tenant_id, provider), self.icon, None)

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


def test_revision_tracks_only_involved_plugins_and_ignores_node_order_and_duplicates(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    calendar = "vendor/calendar/calendar"
    mail = "vendor/mail/mail"
    identifiers = {calendar: "vendor/calendar:1.0@first", mail: "vendor/mail:1.0@second"}
    installed = InstalledPlugins(identifiers)
    revisions = PluginConnectionRevisions(
        providers=installed, snapshots=EndUserConnectionRepository(session_factory=sqlite_session_factory)
    )
    app_id = str(uuid4())
    graph = {"nodes": [tool("one", calendar), tool("two", mail), tool("three", calendar)]}
    expected, providers = revisions.resolve("tenant", app_id, graph)
    assert [(item.provider, item.plugin_unique_identifier) for item in providers] == sorted(identifiers.items())
    assert installed.calls == [("tenant", calendar), ("tenant", mail)]
    graph["nodes"].reverse()
    graph["nodes"].extend([tool("workspace", "vendor/other/other", "workspace"), tool("reuse", calendar, "reuse_node")])
    graph["nodes"].append({**tool("note", "vendor/ignored/ignored"), "type": "custom-note"})
    assert revisions.resolve("tenant", app_id, graph)[0] == expected
    assert revisions.resolve("tenant", str(uuid4()), graph)[0] != expected
    # The artifact digest matters even when the semantic version stays unchanged.
    identifiers[mail] = "vendor/mail:1.0@rebuilt"
    assert revisions.resolve("tenant", app_id, graph)[0] != expected


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


def preflight(harness: OAuthHarness) -> ConnectionPreflightService:
    return ConnectionPreflightService(
        connections=harness.base.repository,
        checks=harness.base.service,
        requirements=PublishedPreflightRequirements(
            workflows=harness.base.repository,
            snapshots=harness.base.repository,
            providers=harness.providers,
            oauth=harness.gateway,
        ),
    )


@pytest.mark.parametrize("entry", ["preflight", "api_key", "oauth"])
def test_old_contract_is_rejected_before_credentials_are_checked(harness: OAuthHarness, entry: str) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.base.auth.calls.clear()
    harness.providers.controller.plugin_unique_identifier = "vendor/calendar:2.0@upgraded"
    command = {"connection_revision": harness.base.connection_revision, "connections": {"tool-1": connection.id}}

    def invoke() -> None:
        if entry == "preflight":
            preflight(harness).check(harness.base.context, ConnectionPreflightInput.model_validate(command))
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


@pytest.mark.parametrize("entry", ["preflight", "api_key", "oauth"])
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
    elif entry == "api_key":
        assert harness.base.service.create_api_key(harness.base.context, command).id
    else:
        harness.service.start_oauth(harness.base.context, oauth, callback_url="https://example.com/callback")
        assert harness.finish(started).id


def test_revision_tracks_authentication_content_and_ignores_presentation_changes(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from copy import deepcopy

    provider = "vendor/calendar/calendar"
    installed = InstalledPlugins({provider: "vendor/calendar:1.0@first"})
    revisions = PluginConnectionRevisions(
        providers=installed,
        snapshots=EndUserConnectionRepository(session_factory=sqlite_session_factory),
    )
    graph = {"nodes": [tool("root", provider)]}
    before, _ = revisions.resolve("tenant", "app", graph)
    installed.icon = "/updated-plugin-icon.svg"
    current, metadata = revisions.resolve("tenant", "app", graph)
    assert current == before
    assert metadata[0].icon == installed.icon
    presentation = deepcopy(graph)
    presentation["nodes"][0]["position"] = {"x": 100, "y": 100}
    cast(dict[str, object], presentation["nodes"][0]["data"])["title"] = "Renamed tool"
    assert revisions.resolve("tenant", "app", presentation)[0] == before
    changed = deepcopy(graph)
    data = cast(dict[str, object], changed["nodes"][0]["data"])
    cast(dict[str, object], data["end_user_auth"])["purpose"] = "Different access purpose"
    assert revisions.resolve("tenant", "app", changed)[0] != before


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
        harness.base.service.delete_connection(harness.base.context, connection.id)
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
    assert error.value.current_revision is not None
    assert error.value.current_revision != previous


@pytest.mark.parametrize("tamper", ["unknown", "scope"])
def test_revision_cannot_forge_trust_or_cross_application_scope(harness: OAuthHarness, tamper: str) -> None:
    revision = harness.base.connection_revision
    if tamper == "scope":
        snapshot = harness.base.repository.get_revision(
            harness.base.context.tenant_id, harness.base.context.app_id, revision
        )
        assert snapshot is not None
        revision = harness.base.repository.save_revision(snapshot.model_copy(update={"app_id": "another-app"}))
    else:
        revision = "00000000-0000-7000-8000-000000000000"
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


def test_reading_contracts_and_starting_oauth_do_not_record_acceptance(harness: OAuthHarness) -> None:
    from models.end_user_connection import EndUserConnectionRevisionAcceptance
    from services.end_user_connection_revision_adapters import PluginConnectionProviderRevisions
    from tests.helpers.end_user_api_key import PROVIDER

    assert harness.base.connection_revision
    PluginConnectionProviderRevisions(providers=harness.providers, snapshots=harness.base.repository).resolve(
        harness.base.context, PROVIDER
    )
    harness.start()
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0


def test_ready_preflight_records_the_end_users_first_approved_revision(harness: OAuthHarness) -> None:
    from constants.end_user_connections import ConnectionRevisionAcceptanceReason
    from models.end_user_connection import EndUserConnectionRevisionAcceptance

    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    revision = harness.base.connection_revision
    command = ConnectionPreflightInput(connection_revision=revision, connections={"tool-1": UUID(connection.id)})
    for _ in range(2):
        assert preflight(harness).check(harness.base.context, command).ready
    with harness.base.sessions() as session:
        rows = session.scalars(
            sa.select(EndUserConnectionRevisionAcceptance).where(
                EndUserConnectionRevisionAcceptance.revision_id == revision
            )
        ).all()
        assert len(rows) == 1
        acceptance = rows[0]
        assert acceptance.reason == ConnectionRevisionAcceptanceReason.APPROVED
        assert acceptance.source_revision_id is None
        assert acceptance.end_user_id == harness.base.context.end_user_id
        assert acceptance.app_id == harness.base.context.app_id
        assert acceptance.tenant_id == harness.base.context.tenant_id


def test_unverified_replacement_does_not_approve_the_submitted_app_revision(harness: OAuthHarness) -> None:
    from models.end_user_connection import EndUserConnectionRevisionAcceptance

    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    original = harness.base.connection_revision
    harness.providers.controller.plugin_unique_identifier = "vendor/calendar:2.0.0@" + "b" * 64
    with pytest.raises(ConnectionRevisionChangedError):
        preflight(harness).check(
            harness.base.context,
            ConnectionPreflightInput(connection_revision=original, connections={"tool-1": UUID(connection.id)}),
        )
    with harness.base.sessions() as session:
        assert (
            session.scalar(
                sa.select(EndUserConnectionRevisionAcceptance).where(
                    EndUserConnectionRevisionAcceptance.revision_id == original
                )
            )
            is None
        )


def test_credential_replacement_records_provider_inheritance_without_approving_the_app(harness: OAuthHarness) -> None:
    from constants.end_user_connections import ConnectionRevisionAcceptanceReason
    from models.end_user_connection import EndUserConnectionRevisionAcceptance
    from services.end_user_connections.contracts import UpdateConnectionInput

    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    source = harness.base.service.get_connection_revision(harness.base.context, connection.id).connection_revision
    artifact = "vendor/calendar:2.0.0@" + "b" * 64
    harness.providers.controller.plugin_unique_identifier = artifact
    harness.providers.trusted_artifacts.add(artifact)
    current = harness.base.service.get_connection_revision(harness.base.context, connection.id).connection_revision
    harness.base.service.update_connection(harness.base.context, connection.id, UpdateConnectionInput(name="Renamed"))
    with harness.base.sessions() as session:
        assert (
            session.scalar(
                sa.select(EndUserConnectionRevisionAcceptance).where(
                    EndUserConnectionRevisionAcceptance.revision_id == current
                )
            )
            is None
        )
    harness.base.service.update_connection(
        harness.base.context,
        connection.id,
        UpdateConnectionInput(credentials={"api_key": "replacement"}, connection_revision=source),
    )
    with harness.base.sessions() as session:
        acceptance = session.scalar(
            sa.select(EndUserConnectionRevisionAcceptance).where(
                EndUserConnectionRevisionAcceptance.revision_id == current
            )
        )
        assert acceptance is not None
        assert acceptance.reason == ConnectionRevisionAcceptanceReason.INHERITED
        assert acceptance.source_revision_id == source
        assert (
            session.scalar(
                sa.select(EndUserConnectionRevisionAcceptance).where(
                    EndUserConnectionRevisionAcceptance.revision_id == harness.base.connection_revision
                )
            )
            is None
        )


def test_failed_credential_replacement_does_not_record_the_new_revision(harness: OAuthHarness) -> None:
    from models.end_user_connection import EndUserConnectionRevisionAcceptance
    from services.end_user_connections.contracts import UpdateConnectionInput
    from services.end_user_connections.errors import ConnectionConflictError

    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    source = harness.base.service.get_connection_revision(harness.base.context, connection.id).connection_revision
    artifact = "vendor/calendar:2.0.0@" + "b" * 64
    harness.providers.controller.plugin_unique_identifier = artifact
    harness.providers.trusted_artifacts.add(artifact)
    current = harness.base.service.get_connection_revision(harness.base.context, connection.id).connection_revision

    def concurrent_update() -> None:
        with harness.base.sessions.begin() as session:
            session.execute(
                sa.update(EndUserConnection)
                .where(EndUserConnection.id == connection.id)
                .values(revision=EndUserConnection.revision + 1)
            )

    harness.base.auth.on_check = concurrent_update
    with pytest.raises(ConnectionConflictError):
        harness.base.service.update_connection(
            harness.base.context,
            connection.id,
            UpdateConnectionInput(credentials={"api_key": "replacement"}, connection_revision=source),
        )
    with harness.base.sessions() as session:
        assert (
            session.scalar(
                sa.select(EndUserConnectionRevisionAcceptance).where(
                    EndUserConnectionRevisionAcceptance.revision_id == current
                )
            )
            is None
        )


def test_verified_inheritance_keeps_sources_across_connection_setup_and_retries(harness: OAuthHarness) -> None:
    from models.end_user_connection import EndUserConnectionRevisionAcceptance

    original = harness.base.connection_revision
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    harness.providers.controller.plugin_unique_identifier = upgraded
    harness.providers.trusted_artifacts.add(upgraded)
    pending = preflight(harness).check(
        harness.base.context, ConnectionPreflightInput(connection_revision=original, connections={})
    )
    assert not pending.ready
    current = pending.connection_revision
    connection = harness.base.service.create_api_key(
        harness.base.context, harness.base.command().model_copy(update={"connection_revision": current})
    )
    command = ConnectionPreflightInput(connection_revision=current, connections={"tool-1": UUID(connection.id)})
    assert preflight(harness).check(harness.base.context, command).ready
    upgraded = "vendor/calendar:3.0.0@" + "c" * 64
    harness.providers.controller.plugin_unique_identifier = upgraded
    harness.providers.trusted_artifacts.add(upgraded)
    latest = preflight(harness).check(harness.base.context, command)
    assert latest.ready
    assert (
        preflight(harness)
        .check(harness.base.context, command.model_copy(update={"connection_revision": latest.connection_revision}))
        .ready
    )
    with harness.base.sessions() as session:
        rows = {
            row.revision_id: row
            for row in session.scalars(
                sa.select(EndUserConnectionRevisionAcceptance).where(
                    EndUserConnectionRevisionAcceptance.revision_id.in_([original, current, latest.connection_revision])
                )
            )
        }
        assert original not in rows
        assert rows[current].reason == rows[latest.connection_revision].reason == "inherited"
        assert rows[current].source_revision_id == original
        assert rows[latest.connection_revision].source_revision_id == current
