import json
from datetime import datetime
from uuid import uuid4

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult, OAuthRevokeResult
from clients.plugin.errors import PluginNotImplementedError
from constants.end_user_connections import ConnectionCredentialStatus
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.exc import PluginDaemonInternalServerError
from models.account import Account, AccountStatus
from models.end_user_connection import EndUserConnection
from models.model import EndUser
from models.tools import ToolOAuthTenantClient
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConflictError,
    ConnectionIdentityError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
)
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


def create(harness: OAuthHarness, *, expired: bool) -> str:
    connection = harness.finish(harness.start())
    if expired:
        with harness.base.sessions.begin() as session:
            session.execute(
                sa.update(EndUserConnection)
                .where(EndUserConnection.id == connection.id)
                .values(expires_at=datetime(2000, 1, 1))
            )
    return connection.id


def test_check_refreshes_and_preserves_refresh_token_identity_and_activity(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=True)
    before = harness.base.repository.find(harness.base.context, connection_id)
    assert before is not None
    result = harness.base.service.check_connection(harness.base.context, connection_id)
    assert result.check.status == "valid"
    assert result.credential_status == ConnectionCredentialStatus.CONNECTED
    assert harness.base.auth.credential_types == [CredentialType.OAUTH2]
    assert len(harness.handler.refreshes) == 1
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.access.revision == before.access.revision + 1
    assert record.summary.expires_at == datetime(2033, 5, 18, 3, 33, 20)
    assert record.summary.last_active_at == before.summary.last_active_at
    assert record.summary.account_label == before.summary.account_label
    assert record.access.oauth_client == before.access.oauth_client
    assert harness.base.cipher.decrypt(harness.base.context.tenant_id, record.encrypted_credentials) == {
        "access_token": "new-access-secret",
        "refresh_token": "refresh-secret",
    }
    assert "secret" not in result.model_dump_json()


@pytest.mark.parametrize("status", ["valid", "invalid", "unsupported", "temporarily_unavailable"])
def test_check_updates_only_definitive_status_without_touching_activity(harness: OAuthHarness, status: str) -> None:
    connection_id = create(harness, expired=False)
    before = harness.base.repository.find(harness.base.context, connection_id)
    assert before is not None
    harness.base.auth.result = CredentialCheckResult.model_validate(
        {"status": status, "reason_code": None, "retryable": False, "checked_at": 1}
    )
    result = harness.base.service.check_connection(harness.base.context, connection_id)
    expected = ConnectionCredentialStatus.INVALID if status == "invalid" else ConnectionCredentialStatus.CONNECTED
    assert result.credential_status == expected
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.access.revision == before.access.revision + (status == "invalid")
    assert record.summary.last_active_at == before.summary.last_active_at
    assert record.encrypted_credentials == before.encrypted_credentials
    assert harness.handler.refreshes == []


@pytest.mark.parametrize("failure", ["network", "empty", "unsupported"])
def test_failed_refresh_distinguishes_temporary_failures_from_unrefreshable_expiry(
    harness: OAuthHarness, failure: str
) -> None:
    connection_id = create(harness, expired=True)
    before = harness.base.repository.find(harness.base.context, connection_id)
    assert before is not None
    if failure == "network":
        harness.handler.refresh_error = ValueError("private-provider-secret")
    elif failure == "empty":
        harness.handler.refresh_result = harness.handler.refresh_result.model_copy(update={"credentials": {}})
    else:
        outer = ValueError("private-provider-secret")
        outer.__context__ = PluginNotImplementedError("unsupported-secret")
        harness.handler.refresh_error = outer
    result = harness.base.service.check_connection(harness.base.context, connection_id)
    assert result.check.status == ("invalid" if failure == "unsupported" else "temporarily_unavailable")
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.encrypted_credentials == before.encrypted_credentials
    assert record.summary.expires_at == before.summary.expires_at
    assert record.summary.last_active_at == before.summary.last_active_at
    assert record.access.revision == before.access.revision + (failure == "unsupported")
    assert "secret" not in result.model_dump_json()


def test_rotated_refresh_token_is_saved_even_when_check_temporarily_fails(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=True)
    harness.handler.refresh_result = harness.handler.refresh_result.model_copy(
        update={
            "credentials": {"access_token": "rotated-access", "refresh_token": "rotated-refresh"},
            "metadata": {"email": "ab@example.com"},
        }
    )
    harness.base.auth.check_error = httpx.ConnectError("private-token")
    result = harness.base.service.check_connection(harness.base.context, connection_id)
    assert result.check.status == "temporarily_unavailable"
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.access.revision == 2
    assert record.summary.account_label == "a*@example.com"
    assert (
        harness.base.cipher.decrypt(harness.base.context.tenant_id, record.encrypted_credentials)["refresh_token"]
        == "rotated-refresh"
    )


def test_remote_expiry_without_local_expiration_refreshes_once(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=False)
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection).where(EndUserConnection.id == connection_id).values(expires_at=None)
        )
    harness.base.auth.result = CredentialCheckResult(
        status="invalid", reason_code="credential_expired", retryable=False, checked_at=1
    )
    result = harness.base.service.check_connection(harness.base.context, connection_id)
    assert result.credential_status == ConnectionCredentialStatus.INVALID
    assert len(harness.handler.refreshes) == 1
    assert len(harness.base.auth.calls) == 2


def test_successful_refresh_repairs_invalid_status_even_when_check_is_unsupported(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=True)
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection_id)
            .values(status=ConnectionCredentialStatus.INVALID)
        )
    harness.base.auth.check_error = PluginNotImplementedError("private-message")
    result = harness.base.service.check_connection(harness.base.context, connection_id)
    assert result.check.status == "unsupported"
    assert result.credential_status == ConnectionCredentialStatus.CONNECTED


@pytest.mark.parametrize("phase", ["before", "during"])
def test_client_change_requires_reauthorization_without_global_status_mutation(
    harness: OAuthHarness, phase: str
) -> None:
    connection_id = create(harness, expired=True)

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            session.execute(
                sa.update(ToolOAuthTenantClient)
                .where(ToolOAuthTenantClient.id == harness.client_id)
                .values(encrypted_oauth_params=json.dumps({"client_id": "different-client"}))
            )

    if phase == "before":
        mutate()
    else:
        harness.handler.on_refresh = mutate
    with pytest.raises(ConnectionReauthorizationRequiredError):
        harness.base.service.check_connection(harness.base.context, connection_id)
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.access.revision == 1
    assert record.access.credential_status == ConnectionCredentialStatus.CONNECTED
    assert (
        harness.base.cipher.decrypt(harness.base.context.tenant_id, record.encrypted_credentials)["access_token"]
        == "access-secret"
    )


@pytest.mark.parametrize("change", ["revision", "owner", "deleted", "end_user", "account"])
def test_refresh_cannot_overwrite_identity_or_connection_changes(harness: OAuthHarness, change: str) -> None:
    connection_id = create(harness, expired=True)

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            if change == "revision":
                session.execute(
                    sa.update(EndUserConnection).where(EndUserConnection.id == connection_id).values(revision=2)
                )
            elif change == "owner":
                session.execute(
                    sa.update(EndUserConnection)
                    .where(EndUserConnection.id == connection_id)
                    .values(account_id=str(uuid4()))
                )
            elif change == "deleted":
                session.execute(sa.delete(EndUserConnection).where(EndUserConnection.id == connection_id))
            elif change == "end_user":
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

    harness.handler.on_refresh = mutate
    with pytest.raises((ConnectionConflictError, ConnectionIdentityError)):
        harness.base.service.check_connection(harness.base.context, connection_id)
    with harness.base.sessions() as session:
        row = session.get(EndUserConnection, connection_id)
        assert (
            row is None
            or harness.base.cipher.decrypt(harness.base.context.tenant_id, row.encrypted_credentials)["access_token"]
            == "access-secret"
        )


def test_overlapping_checks_cannot_rotate_refresh_token_twice(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=True)

    def overlapping() -> None:
        with pytest.raises(ConnectionCheckUnavailableError):
            harness.base.service.check_connection(harness.base.context, connection_id)

    harness.handler.on_refresh = overlapping
    assert harness.base.service.check_connection(harness.base.context, connection_id).check.status == "valid"
    assert len(harness.handler.refreshes) == 1


def test_lost_refresh_lease_cannot_persist_remote_result(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=True)
    harness.handler.on_refresh = lambda: next(iter(harness.locks.values())).release()
    with pytest.raises(ConnectionCheckUnavailableError):
        harness.base.service.check_connection(harness.base.context, connection_id)
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.access.revision == 1


@pytest.mark.parametrize("revoke_status", ["revoked", "unsupported", "failed", "temporarily_unavailable"])
def test_delete_commits_before_best_effort_revocation(harness: OAuthHarness, revoke_status: str) -> None:
    connection_id = create(harness, expired=False)
    harness.base.auth.revoke_result = OAuthRevokeResult.model_validate(
        {"status": revoke_status, "reason_code": None, "retryable": False}
    )

    def assert_deleted() -> None:
        with harness.base.sessions() as session:
            assert session.get(EndUserConnection, connection_id) is None

    harness.base.auth.on_revoke = assert_deleted
    harness.base.service.delete_connection(harness.base.context, connection_id)
    assert harness.base.repository.find(harness.base.context, connection_id) is None
    assert len(harness.base.auth.revocations) == 1
    tenant_id, user_id, _, client, credentials = harness.base.auth.revocations[0]
    assert tenant_id == harness.base.context.tenant_id
    assert user_id == harness.base.context.end_user_id
    assert client == {"client_id": "public-client"}
    assert credentials["access_token"] == "access-secret"


@pytest.mark.parametrize(
    "change", ["missing_client", "changed_client", "disabled_client", "secret_error", "revoke_error"]
)
def test_configuration_and_provider_failures_do_not_prevent_local_delete(
    harness: OAuthHarness, change: str, caplog: pytest.LogCaptureFixture
) -> None:
    connection_id = create(harness, expired=False)
    with harness.base.sessions.begin() as session:
        if change == "missing_client":
            session.execute(sa.delete(ToolOAuthTenantClient).where(ToolOAuthTenantClient.id == harness.client_id))
        elif change == "changed_client":
            session.execute(
                sa.update(ToolOAuthTenantClient)
                .where(ToolOAuthTenantClient.id == harness.client_id)
                .values(encrypted_oauth_params='{"client_id":"different-client"}')
            )
        elif change == "disabled_client":
            session.execute(
                sa.update(ToolOAuthTenantClient)
                .where(ToolOAuthTenantClient.id == harness.client_id)
                .values(enabled=False)
            )
    if change == "secret_error":
        harness.base.cipher.values.clear()
    elif change == "revoke_error":

        def fail() -> None:
            raise PluginDaemonInternalServerError("private-access-token")

        harness.base.auth.on_revoke = fail
    harness.base.service.delete_connection(harness.base.context, connection_id)
    assert harness.base.repository.find(harness.base.context, connection_id) is None
    assert len(harness.base.auth.revocations) == (1 if change in {"disabled_client", "revoke_error"} else 0)
    assert "private-access-token" not in caplog.text


def test_missing_connection_has_no_remote_side_effect(harness: OAuthHarness) -> None:
    with pytest.raises(ConnectionNotFoundError):
        harness.base.service.delete_connection(harness.base.context, str(uuid4()))
    assert harness.base.auth.revocations == []


def test_expired_refresh_response_is_saved_but_not_reported_as_connected(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=True)
    harness.handler.refresh_result = harness.handler.refresh_result.model_copy(update={"expires_at": 1})
    result = harness.base.service.check_connection(harness.base.context, connection_id)
    assert result.credential_status == ConnectionCredentialStatus.INVALID
    assert result.check.reason_code == "credential_expired"
    assert harness.base.auth.calls == []
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.access.revision == 2


def test_client_secret_change_during_check_cannot_persist_a_stale_result(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=False)

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            session.execute(
                sa.update(ToolOAuthTenantClient)
                .where(ToolOAuthTenantClient.id == harness.client_id)
                .values(encrypted_oauth_params='{"client_id":"public-client","client_secret":"replacement"}')
            )

    harness.base.auth.on_check = mutate
    harness.base.auth.result = CredentialCheckResult(
        status="invalid", reason_code="credential_revoked", retryable=False, checked_at=1
    )
    with pytest.raises(ConnectionReauthorizationRequiredError):
        harness.base.service.check_connection(harness.base.context, connection_id)
    record = harness.base.repository.find(harness.base.context, connection_id)
    assert record is not None
    assert record.access.revision == 1
    assert record.access.credential_status == ConnectionCredentialStatus.CONNECTED


def test_revocation_never_resolves_another_tenants_client(harness: OAuthHarness) -> None:
    connection_id = create(harness, expired=False)
    with harness.base.sessions.begin() as session:
        other = ToolOAuthTenantClient(tenant_id=str(uuid4()), plugin_id="vendor/calendar", provider="calendar")
        other.encrypted_oauth_params = '{"client_id":"public-client","client_secret":"foreign-secret"}'
        session.add(other)
        session.flush()
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection_id)
            .values(oauth_client_configuration_id=other.id)
        )
    harness.base.service.delete_connection(harness.base.context, connection_id)
    assert harness.base.repository.find(harness.base.context, connection_id) is None
    assert harness.base.auth.revocations == []
