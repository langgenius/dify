"""Client rotation disconnects grants atomically without forwarding old secrets."""

import json
from collections.abc import Mapping
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from click.testing import CliRunner
from sqlalchemy.orm import Session, sessionmaker

from commands import plugin as plugin_commands
from constants.end_user_connections import ConnectionCredentialStatus, OAuthClientSource
from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from models.tools import ToolOAuthSystemClient, ToolOAuthTenantClient
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services import end_user_connection_oauth_adapters
from services.end_user_connections.errors import ConnectionReauthorizationRequiredError
from services.tools import builtin_tools_manage_service
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from tests.helpers.end_user_api_key import PROVIDER
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


class ClientCipher:
    def decrypt(self, value: Mapping[str, object]) -> dict[str, object]:
        return dict(value)

    def encrypt(self, value: Mapping[str, object]) -> dict[str, object]:
        return dict(value)


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    harness = make_oauth_harness(sqlite_session_factory, monkeypatch)
    monkeypatch.setattr(builtin_tools_manage_service, "db", SimpleNamespace(engine=sqlite_session_factory.kw["bind"]))
    monkeypatch.setattr(
        builtin_tools_manage_service.ToolManager, "get_builtin_provider", lambda *_args: harness.providers.controller
    )
    monkeypatch.setattr(
        builtin_tools_manage_service, "create_provider_encrypter", lambda **_kwargs: (ClientCipher(), None)
    )
    monkeypatch.setattr(
        end_user_connection_oauth_adapters, "create_provider_encrypter", lambda **_kwargs: (ClientCipher(), None)
    )
    return harness


def save_choices(harness: OAuthHarness, connection_ids: list[str]) -> None:
    base = harness.base
    with base.sessions.begin() as session:
        for index, connection_id in enumerate(connection_ids):
            session.add(
                AppConnection(
                    tenant_id=base.context.tenant_id,
                    app_id=base.context.app_id,
                    workflow_id=base.workflow_id,
                    end_user_id=base.context.end_user_id,
                    node_id=f"tool-{index}",
                    provider=PROVIDER,
                    connection_id=connection_id,
                    source_run_id=str(uuid4()),
                )
            )
            session.add(
                SessionConnection(
                    tenant_id=base.context.tenant_id,
                    app_id=base.context.app_id,
                    workflow_id=base.workflow_id,
                    session_id=str(uuid4()),
                    node_id=f"tool-{index}",
                    provider=PROVIDER,
                    connection_id=connection_id,
                )
            )


@pytest.mark.parametrize(
    ("change", "verified_upgrade"),
    [("secret", False), ("secret", True), ("client_id", False), ("disable", False), ("delete", False)],
)
def test_workspace_client_changes_clear_all_live_choices_and_require_reauthorization(
    harness: OAuthHarness, change: str, verified_upgrade: bool
) -> None:
    one = harness.finish(harness.start())
    two = harness.finish(harness.start())
    api_key = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    save_choices(harness, [one.id, two.id])
    if verified_upgrade:
        upgraded = "vendor/calendar:2.0.0@" + "b" * 64
        harness.providers.controller.plugin_unique_identifier = upgraded
        harness.providers.trusted_artifacts.add(upgraded)
    if change == "delete":
        BuiltinToolManageService.delete_custom_oauth_client_params(harness.base.context.tenant_id, PROVIDER)
    else:
        values = {"client_id": "changed-client" if change == "client_id" else "public-client"}
        if change == "secret":
            values["client_secret"] = "rotated-secret"
        BuiltinToolManageService.save_custom_oauth_client_params(
            harness.base.context.tenant_id,
            PROVIDER,
            client_params=None if change == "disable" else values,
            enable_oauth_custom_client=False if change == "disable" else None,
        )
    with harness.base.sessions() as session:
        for connection_id in (one.id, two.id):
            row = session.get(EndUserConnection, connection_id)
            assert row is not None
            assert row.name == one.name
            assert row.status == ConnectionCredentialStatus.RECONNECT_REQUIRED
            assert row.encrypted_credentials == ""
            assert row.revision == 2
        untouched = session.get(EndUserConnection, api_key.id)
        assert untouched is not None
        assert untouched.status == ConnectionCredentialStatus.CONNECTED
        for selection in (AppConnection, SessionConnection):
            assert session.scalar(sa.select(sa.func.count()).select_from(selection)) == 0
    assert harness.base.auth.revocations == []
    if change == "secret":
        started = harness.service.reauthorize_oauth(
            harness.base.context,
            one.id,
            callback_url="https://web.example/callback",
            connection_revision=harness.base.connection_revision,
        )
        assert harness.finish(started).id == one.id
        current = harness.base.repository.find(harness.base.context, one.id)
        assert current is not None
        assert current.access.credential_status == ConnectionCredentialStatus.CONNECTED


def test_saving_unchanged_client_values_preserves_grants(harness: OAuthHarness) -> None:
    connection = harness.finish(harness.start())
    BuiltinToolManageService.save_custom_oauth_client_params(
        harness.base.context.tenant_id, PROVIDER, client_params={"client_id": "public-client"}
    )
    record = harness.base.repository.find(harness.base.context, connection.id)
    assert record is not None
    assert record.access.credential_status == ConnectionCredentialStatus.CONNECTED
    assert record.access.revision == 1


@pytest.mark.parametrize("legacy", [False, True])
def test_credential_fingerprint_blocks_out_of_band_secret_changes_without_plugin_io(
    harness: OAuthHarness, legacy: bool
) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        if legacy:
            session.execute(
                sa.update(EndUserConnection)
                .where(EndUserConnection.id == connection.id)
                .values(oauth_client_fingerprint=None)
            )
        else:
            session.execute(
                sa.update(ToolOAuthTenantClient)
                .where(ToolOAuthTenantClient.id == harness.client_id)
                .values(encrypted_oauth_params='{"client_id":"public-client","client_secret":"rotated"}')
            )
    harness.base.auth.calls.clear()
    with pytest.raises(ConnectionReauthorizationRequiredError):
        harness.base.service.check_connection(
            harness.base.context, connection.id, connection_revision=harness.base.connection_revision
        )
    assert harness.base.auth.calls == []
    assert harness.handler.refreshes == []


def test_invalidation_is_scoped_to_the_client_tenant_and_source(harness: OAuthHarness) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        assert (
            EndUserConnectionRepository.disconnect_oauth_client_connections(
                session,
                tenant_id=str(uuid4()),
                provider=PROVIDER,
                source=OAuthClientSource.WORKSPACE,
                configuration_id=harness.client_id,
            )
            == 0
        )
        assert (
            EndUserConnectionRepository.disconnect_oauth_client_connections(
                session,
                tenant_id=None,
                provider=PROVIDER,
                source=OAuthClientSource.PLATFORM,
                configuration_id=harness.client_id,
            )
            == 0
        )
    record = harness.base.repository.find(harness.base.context, connection.id)
    assert record is not None
    assert record.access.revision == 1


def test_platform_client_rotation_disconnects_associated_grants_across_tenants(
    harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dataclasses import replace

    workspace = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        client = ToolOAuthSystemClient(
            plugin_id="vendor/calendar", provider="calendar", encrypted_oauth_params='{"client_id":"platform-client"}'
        )
        session.add(client)
        session.flush()
        original = session.get(EndUserConnection, workspace.id)
        assert original is not None
        first = replace(
            original,
            oauth_client_source=OAuthClientSource.PLATFORM,
            oauth_client_configuration_id=client.id,
            oauth_client_id="platform-client",
        )
        second = replace(first, tenant_id=str(uuid4()), account_id=str(uuid4()))
        session.add_all([first, second])
        ids = [first.id, second.id]
        client_id = client.id
    save_choices(harness, [first.id])
    monkeypatch.setattr(plugin_commands, "db", SimpleNamespace(engine=harness.base.sessions.kw["bind"]))
    monkeypatch.setattr(plugin_commands, "encrypt_system_params", json.dumps)
    monkeypatch.setattr(plugin_commands, "decrypt_system_params", json.loads)
    result = CliRunner().invoke(
        plugin_commands.setup_system_tool_oauth_client,
        [
            "--provider",
            PROVIDER,
            "--client-params",
            '{"client_id":"platform-client","client_secret":"private-sentinel"}',
        ],
    )
    assert result.exit_code == 0, result.output
    assert "private-sentinel" not in result.output
    with harness.base.sessions() as session:
        current = session.get(ToolOAuthSystemClient, client_id)
        assert current is not None
        for connection_id in ids:
            row = session.get(EndUserConnection, connection_id)
            assert row is not None
            assert row.status == ConnectionCredentialStatus.RECONNECT_REQUIRED
            assert row.encrypted_credentials == ""
        unaffected = session.get(EndUserConnection, workspace.id)
        assert unaffected is not None
        assert unaffected.status == ConnectionCredentialStatus.CONNECTED
        for selection in (AppConnection, SessionConnection):
            assert session.scalar(sa.select(sa.func.count()).select_from(selection)) == 0


def test_client_rotation_invalidates_a_pending_oauth_attempt(harness: OAuthHarness) -> None:
    started = harness.start()
    BuiltinToolManageService.save_custom_oauth_client_params(
        harness.base.context.tenant_id,
        PROVIDER,
        client_params={"client_id": "public-client", "client_secret": "rotated-secret"},
    )
    with pytest.raises(ConnectionReauthorizationRequiredError):
        harness.finish(started)
    assert harness.handler.exchanges == 0
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0


def test_stale_run_acceptance_cannot_restore_disconnected_choices(harness: OAuthHarness) -> None:
    from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
    from services.end_user_connections.errors import ConnectionConflictError
    from services.end_user_connections.selections import ConnectionSelectionService

    connection = harness.finish(harness.start())
    identity = harness.base.context
    accepted = ConnectionExecutionContext(
        tenant_id=identity.tenant_id,
        app_id=identity.app_id,
        end_user_id=identity.end_user_id,
        account_id=identity.account_id,
        workflow_id=harness.base.workflow_id,
        connection_revision=harness.base.connection_revision,
        selections=(ExecutionConnectionSelection(node_id="tool-1", provider=PROVIDER, connection_id=connection.id),),
    )
    BuiltinToolManageService.save_custom_oauth_client_params(
        identity.tenant_id,
        PROVIDER,
        client_params={"client_id": "public-client", "client_secret": "rotated-secret"},
    )
    service = ConnectionSelectionService(store=harness.base.repository)
    with pytest.raises(ConnectionConflictError):
        service.save_run(accepted, str(uuid4()), None, update_conversation=True)
    with harness.base.sessions() as session:
        for selection in (AppConnection, SessionConnection):
            assert session.scalar(sa.select(sa.func.count()).select_from(selection)) == 0
