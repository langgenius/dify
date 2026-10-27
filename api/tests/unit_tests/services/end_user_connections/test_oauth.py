import json
from dataclasses import replace
from datetime import datetime
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialStatus, OAuthClientSource
from core.tools.utils.system_encryption import encrypt_system_params
from models.account import Account, AccountStatus
from models.end_user_connection import (
    AppConnection,
    EndUserConnection,
    EndUserConnectionRevisionAcceptance,
    SessionConnection,
)
from models.model import App, EndUser, Site
from models.tools import ToolOAuthSystemClient, ToolOAuthTenantClient
from models.workflow import Workflow
from services.end_user_connection_oauth_adapters import PluginService
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionIdentityError,
    ConnectionNotFoundError,
    ConnectionOAuthError,
    ConnectionReauthorizationRequiredError,
    ConnectionRevisionChangedError,
)
from tests.helpers.end_user_api_key import PROVIDER
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


def test_authorization_persists_encrypted_grant_and_masked_identity_only(harness: OAuthHarness) -> None:
    started = harness.start()
    assert started.model_dump() == {"authorization_url": started.authorization_url}
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0
    connection = harness.finish(started)
    assert connection.account_label == "al***@example.com"
    assert connection.credential_status == ConnectionCredentialStatus.CONNECTED
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.oauth_client is not None
    assert stored.access.oauth_client.configuration_id == harness.client_id
    assert stored.access.oauth_client.client_id == "public-client"
    assert harness.base.cipher.decrypt(harness.base.context.tenant_id, stored.encrypted_credentials) == {
        "access_token": "access-secret",
        "refresh_token": "refresh-secret",
    }
    assert "access-secret" not in connection.model_dump_json()
    assert "alice@example.com" not in connection.model_dump_json()
    assert "hidden-metadata" not in str(harness.redis_values)
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AppConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(SessionConnection)) == 0
        acceptance = session.scalar(sa.select(EndUserConnectionRevisionAcceptance))
        assert acceptance is not None
        assert acceptance.reason == "approved"
        assert acceptance.source_revision_id is None
        assert acceptance.account_id == harness.base.context.account_id
        assert acceptance.end_user_id == harness.base.context.end_user_id
    with pytest.raises(ConnectionOAuthError):
        harness.finish(started)
    assert harness.handler.exchanges == 1


@pytest.mark.parametrize(
    "query", [b"code=secret", b"state=wrong&code=secret", b"state=a&state=b", b"error=denied", b"\xff"]
)
def test_state_and_denial_fail_before_exchange(harness: OAuthHarness, query: bytes) -> None:
    started = harness.start()
    attempt = harness.service.consume_attempt(started.context_id, provider=PROVIDER)
    with pytest.raises(ConnectionOAuthError):
        harness.service.complete_oauth(attempt, query_string=query)
    assert harness.handler.exchanges == 0
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0


def test_wrong_provider_cannot_route_or_consume_attempt(harness: OAuthHarness) -> None:
    started = harness.start()
    state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
    with pytest.raises(ConnectionOAuthError):
        harness.service.callback_url(state, "vendor/other/other")
    with pytest.raises(ConnectionOAuthError):
        harness.service.consume_attempt(started.context_id, provider="vendor/other/other")
    assert harness.handler.exchanges == 0


@pytest.mark.parametrize("phase", ["before_exchange", "during_exchange"])
@pytest.mark.parametrize("change", ["client", "workflow", "owner", "account"])
def test_callback_revalidates_context_after_redirect_and_external_io(
    harness: OAuthHarness, phase: str, change: str
) -> None:
    started = harness.start()

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            if change == "client":
                session.execute(
                    sa.update(ToolOAuthTenantClient)
                    .where(ToolOAuthTenantClient.id == harness.client_id)
                    .values(encrypted_oauth_params='{"client_id":"changed"}')
                )
            elif change == "workflow":
                session.execute(
                    sa.update(App).where(App.id == harness.base.context.app_id).values({"workflow_id": str(uuid4())})
                )
            elif change == "owner":
                session.execute(
                    sa.update(EndUser)
                    .where(EndUser.id == harness.base.context.end_user_id)
                    .values(account_id=str(uuid4()))
                )
            else:
                session.execute(
                    sa.update(Account)
                    .where(Account.id == harness.base.context.account_id)
                    .values(status=AccountStatus.BANNED)
                )

    if phase == "before_exchange":
        mutate()
    else:
        harness.handler.on_exchange = mutate
    error = {"client": ConnectionReauthorizationRequiredError, "workflow": ConnectionRevisionChangedError}.get(
        change, ConnectionIdentityError
    )
    with pytest.raises(error):
        harness.finish(started)
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0


@pytest.mark.parametrize("operation", ["create", "reauthorize"])
@pytest.mark.parametrize("phase", ["before_exchange", "during_exchange"])
@pytest.mark.parametrize("change", ["code", "deleted"])
def test_oauth_does_not_depend_on_site_after_authenticated_start(
    harness: OAuthHarness, operation: str, phase: str, change: str
) -> None:
    original = harness.finish(harness.start()) if operation == "reauthorize" else None
    started = (
        harness.service.reauthorize_oauth(
            harness.base.context,
            original.id,
            callback_url="http://web-api.example/api/connections/oauth",
            connection_revision=harness.base.connection_revision,
        )
        if original is not None
        else harness.start()
    )
    assert all('"app_code"' not in value for value in harness.redis_values.values())

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            query = sa.update(Site).where(Site.app_id == harness.base.context.app_id)
            if change == "code":
                session.execute(query.values(code="rotated-code"))
            else:
                session.execute(sa.delete(Site).where(Site.app_id == harness.base.context.app_id))

    if phase == "before_exchange":
        mutate()
    else:
        harness.handler.on_exchange = mutate

    connection = harness.finish(started)
    assert connection.credential_status == ConnectionCredentialStatus.CONNECTED
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.tenant_id == harness.base.context.tenant_id
    assert stored.access.owner == harness.base.context.owner
    if original is not None:
        assert connection.id == original.id
        assert stored.access.revision == 2


def test_reauthorization_preserves_id_and_name_and_replaces_grant(harness: OAuthHarness) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(status=ConnectionCredentialStatus.RECONNECT_REQUIRED)
        )
        session.execute(
            sa.update(ToolOAuthTenantClient)
            .where(ToolOAuthTenantClient.id == harness.client_id)
            .values(encrypted_oauth_params='{"client_id":"new-client"}')
        )
    started = harness.service.reauthorize_oauth(
        harness.base.context,
        connection.id,
        callback_url="http://web-api.example/api/connections/oauth",
        connection_revision=harness.base.connection_revision,
    )
    harness.handler.result = harness.handler.result.model_copy(
        update={"credentials": {"access_token": "new-secret"}, "metadata": {"name": "xy"}, "expires_at": -1}
    )
    updated = harness.finish(started)
    assert updated.id == connection.id
    assert updated.name == connection.name
    assert updated.credential_status == ConnectionCredentialStatus.CONNECTED
    assert updated.account_label == "x*"
    assert updated.expires_at is None
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.oauth_client is not None
    assert stored.access.revision == 2
    assert stored.access.oauth_client.client_id == "new-client"


@pytest.mark.parametrize("phase", ["before_exchange", "during_exchange"])
@pytest.mark.parametrize("change", ["revision", "deleted", "owner"])
def test_reauthorization_never_overwrites_concurrent_changes(harness: OAuthHarness, phase: str, change: str) -> None:
    connection = harness.finish(harness.start())
    started = harness.service.reauthorize_oauth(
        harness.base.context,
        connection.id,
        callback_url="http://web-api.example/api/connections/oauth",
        connection_revision=harness.base.connection_revision,
    )

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            query = sa.update(EndUserConnection).where(EndUserConnection.id == connection.id)
            if change == "revision":
                session.execute(query.values(revision=2, name="Concurrent edit"))
            elif change == "owner":
                session.execute(query.values(account_id=str(uuid4())))
            else:
                session.execute(sa.delete(EndUserConnection).where(EndUserConnection.id == connection.id))

    if phase == "before_exchange":
        mutate()
    else:
        harness.handler.on_exchange = mutate
    with pytest.raises((ConnectionConflictError, ConnectionNotFoundError)):
        harness.finish(started)
    with harness.base.sessions() as session:
        row = session.get(EndUserConnection, connection.id)
        assert row is None or row.revision == (2 if change == "revision" else 1)


def test_failed_reauthorization_keeps_working_credentials(harness: OAuthHarness) -> None:
    connection = harness.finish(harness.start())
    started = harness.service.reauthorize_oauth(
        harness.base.context,
        connection.id,
        callback_url="http://web-api.example/api/connections/oauth",
        connection_revision=harness.base.connection_revision,
    )
    harness.handler.result = harness.handler.result.model_copy(update={"credentials": {}})
    with pytest.raises(ConnectionOAuthError):
        harness.finish(started)
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.revision == 1
    assert stored.access.credential_status == ConnectionCredentialStatus.CONNECTED


@pytest.mark.parametrize("custom_client_schema", [False, True])
def test_platform_client_requires_verified_provider_and_tracks_source(
    harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch, custom_client_schema: bool
) -> None:
    if not custom_client_schema:
        schema = harness.providers.controller.entity.oauth_schema
        assert schema is not None
        schema.client_schema = []
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["oauth_client_type"] = "default"
        workflow.graph = json.dumps(graph)
        system = ToolOAuthSystemClient(
            plugin_id="vendor/calendar",
            provider="calendar",
            encrypted_oauth_params=encrypt_system_params(
                {"client_id": "platform-client", "client_secret": "private-client-secret"}
            ),
        )
        session.add(system)
    monkeypatch.setattr(PluginService, "is_plugin_verified", lambda _tenant_id, _unique_id: True)
    connection = harness.finish(harness.start())
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.oauth_client is not None
    assert stored.access.oauth_client.source == OAuthClientSource.PLATFORM
    assert stored.access.oauth_client.client_id == "platform-client"
    assert "private-client-secret" not in str(harness.redis_values)
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(expires_at=datetime(2000, 1, 1))
        )
    assert (
        harness.base.service.check_connection(
            harness.base.context, connection.id, connection_revision=harness.base.connection_revision
        ).check.status
        == "valid"
    )
    assert len(harness.handler.refreshes) == 1
    started = harness.service.reauthorize_oauth(
        harness.base.context,
        connection.id,
        callback_url="http://web-api.example/api/connections/oauth",
        connection_revision=harness.base.connection_revision,
    )
    assert harness.finish(started).id == connection.id
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.oauth_client is not None
    assert stored.access.oauth_client.source == OAuthClientSource.PLATFORM


def test_foreign_owner_cannot_reauthorize(harness: OAuthHarness) -> None:
    connection = harness.finish(harness.start())
    foreign = replace(harness.base.context, account_id=str(uuid4()))
    with pytest.raises(ConnectionIdentityError):
        harness.service.reauthorize_oauth(
            foreign,
            connection.id,
            callback_url="http://web-api.example/api/connections/oauth",
            connection_revision=harness.base.connection_revision,
        )


def test_unverified_provider_cannot_use_platform_client(harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch) -> None:
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["oauth_client_type"] = "default"
        workflow.graph = json.dumps(graph)
        session.add(
            ToolOAuthSystemClient(
                plugin_id="vendor/calendar",
                provider="calendar",
                encrypted_oauth_params=encrypt_system_params({"client_id": "platform-client"}),
            )
        )
    monkeypatch.setattr(PluginService, "is_plugin_verified", lambda _tenant_id, _unique_id: False)
    with pytest.raises(ConnectionConfigurationError):
        harness.start()
    assert harness.redis_values == {}


@pytest.mark.parametrize(("client_type", "missing"), [("default", True), ("custom", False), ("custom", True)])
def test_unavailable_selected_client_never_falls_back(
    harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch, client_type: str, missing: bool
) -> None:
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["oauth_client_type"] = client_type
        workflow.graph = json.dumps(graph)
        if client_type == "custom":
            session.add(
                ToolOAuthSystemClient(
                    plugin_id="vendor/calendar",
                    provider="calendar",
                    encrypted_oauth_params=encrypt_system_params({"client_id": "platform-client"}),
                )
            )
            if missing:
                session.execute(sa.delete(ToolOAuthTenantClient).where(ToolOAuthTenantClient.id == harness.client_id))
            else:
                session.execute(
                    sa.update(ToolOAuthTenantClient)
                    .where(ToolOAuthTenantClient.id == harness.client_id)
                    .values(enabled=False)
                )
    monkeypatch.setattr(PluginService, "is_plugin_verified", lambda _tenant_id, _unique_id: True)

    with pytest.raises(ConnectionReauthorizationRequiredError):
        harness.start()
    assert harness.redis_values == {}


@pytest.mark.parametrize("capability", ["oauth", "custom_client"])
def test_selected_oauth_method_must_be_supported_by_provider(harness: OAuthHarness, capability: str) -> None:
    schema = harness.providers.controller.entity.oauth_schema
    assert schema is not None
    if capability == "oauth":
        schema.credentials_schema = []
    else:
        schema.client_schema = []

    with pytest.raises(ConnectionConfigurationError):
        harness.start()
    assert harness.redis_values == {}


def test_callback_rejects_changed_graph_client_selection_before_exchange(harness: OAuthHarness) -> None:
    started = harness.start()
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["oauth_client_type"] = "default"
        workflow.graph = json.dumps(graph)

    with pytest.raises(ConnectionRevisionChangedError):
        harness.finish(started)
    assert harness.handler.exchanges == 0


def test_expired_context_cannot_complete_even_with_matching_state(harness: OAuthHarness) -> None:
    started = harness.start()
    harness.redis_values.clear()
    with pytest.raises(ConnectionOAuthError):
        harness.finish(started)
    assert harness.handler.exchanges == 0


def test_denial_with_valid_state_does_not_create_connection(harness: OAuthHarness) -> None:
    started = harness.start()
    attempt = harness.service.consume_attempt(started.context_id, provider=PROVIDER)
    with pytest.raises(ConnectionOAuthError):
        harness.service.complete_oauth(
            attempt, query_string=harness.query(started) + b"&error=access_denied&error_description=secret"
        )
    assert harness.handler.exchanges == 0


def test_missing_metadata_does_not_copy_credentials_into_label(harness: OAuthHarness) -> None:
    harness.handler.result = harness.handler.result.model_copy(update={"metadata": {"account": "unapproved-identity"}})
    connection = harness.finish(harness.start())
    assert connection.account_label is None


def test_oauth_operations_use_the_resolved_plugin_declaration(harness: OAuthHarness) -> None:
    identifier = harness.providers.controller.plugin_unique_identifier
    connection = harness.finish(harness.start())
    assert harness.handler.requested_artifacts == [identifier, identifier]
    harness.base.service.check_connection(
        harness.base.context, connection.id, connection_revision=harness.base.connection_revision
    )
    assert harness.base.auth.check_artifacts[-1] == identifier
    harness.base.service.delete_connection(
        harness.base.context, connection.id, connection_revision=harness.base.connection_revision
    )
    assert harness.base.auth.revocation_artifacts == [identifier]


@pytest.mark.parametrize("phase", ["redirect", "exchange"])
def test_reauthorization_callback_rechecks_the_provider_revision(harness: OAuthHarness, phase: str) -> None:
    from services.end_user_connections.errors import ConnectionRevisionChangedError

    connection = harness.finish(harness.start())
    original = harness.base.repository.find(harness.base.context, connection.id)
    assert original is not None
    revision = harness.base.service.get_connection_revision(harness.base.context, connection.id).connection_revision
    started = harness.service.reauthorize_oauth(
        harness.base.context,
        connection.id,
        connection_revision=revision,
        callback_url="https://web-api.example/api/connections/oauth",
    )

    def upgrade() -> None:
        harness.providers.controller.plugin_unique_identifier = "vendor/calendar:2.0.0@" + "b" * 64

    if phase == "redirect":
        upgrade()
    else:
        harness.handler.on_exchange = upgrade
    with pytest.raises(ConnectionRevisionChangedError):
        harness.finish(started)
    assert harness.handler.exchanges == (1 if phase == "redirect" else 2)
    latest = harness.base.repository.find(harness.base.context, connection.id)
    assert latest is not None
    assert latest.encrypted_credentials == original.encrypted_credentials
