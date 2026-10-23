from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus
from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from models.enums import EndUserType
from models.model import App, EndUser
from services.end_user_connections.contracts import ListConnectionsInput, UpdateConnectionInput
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConflictError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionWorkflowChangedError,
)
from tests.helpers.end_user_api_key import ConnectionHarness, make_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> ConnectionHarness:
    return make_harness(sqlite_session_factory)


def test_api_key_crud_and_metadata_queries_never_expose_or_decrypt_secrets(harness: ConnectionHarness) -> None:
    service, context = harness.service, harness.context
    connection = service.create_api_key(context, harness.command())
    assert "original-secret" not in connection.model_dump_json()
    assert connection.credential_status == ConnectionCredentialStatus.CONNECTED
    assert service.get_connection(context, connection.id) == connection
    assert service.list_connections(context, ListConnectionsInput()).data == (connection,)
    with harness.sessions() as session:
        row = session.get(EndUserConnection, connection.id)
        assert row is not None
        assert row.encrypted_credentials.startswith("cipher:")
        assert row.revision == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(AppConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(SessionConnection)) == 0
    renamed = service.update_connection(context, connection.id, UpdateConnectionInput(name="Renamed"))
    assert renamed.name == "Renamed"
    assert len(harness.auth.calls) == 1
    service.update_connection(context, connection.id, UpdateConnectionInput(credentials={"api_key": "replacement"}))
    checked = service.check_connection(context, connection.id)
    assert checked.check.status == "valid"
    assert harness.auth.calls[-1][3] == {"api_key": "replacement"}
    service.delete_connection(context, connection.id)
    with pytest.raises(ConnectionNotFoundError):
        service.get_connection(context, connection.id)


@pytest.mark.parametrize("status", ["invalid", "temporarily_unavailable"])
def test_rejected_create_or_update_does_not_store_or_replace_credentials(
    harness: ConnectionHarness, status: str
) -> None:
    original = harness.service.create_api_key(harness.context, harness.command())
    before = harness.repository.find(harness.context, original.id)
    harness.auth.result = CredentialCheckResult.model_validate(
        {"status": status, "reason_code": None, "retryable": False, "checked_at": 1}
    )
    error = ConnectionInvalidCredentialsError if status == "invalid" else ConnectionCheckUnavailableError
    with pytest.raises(error):
        harness.service.create_api_key(harness.context, harness.command("rejected-secret"))
    with pytest.raises(error):
        harness.service.update_connection(
            harness.context, original.id, UpdateConnectionInput(credentials={"api_key": "rejected-secret"})
        )
    after = harness.repository.find(harness.context, original.id)
    assert after == before
    assert len(harness.service.list_connections(harness.context, ListConnectionsInput()).data) == 1


@pytest.mark.parametrize("credentials", [{"unknown": "secret"}, {"api_key": 42}, {"api_key": "*****"}])
def test_schema_and_mask_placeholders_are_rejected_before_remote_calls(
    harness: ConnectionHarness, credentials: dict[str, object]
) -> None:
    command = harness.command().model_copy(update={"credentials": credentials})
    with pytest.raises(ConnectionInvalidCredentialsError):
        harness.service.create_api_key(harness.context, command)
    assert harness.auth.calls == []


def test_unsupported_checks_allow_schema_valid_creation(harness: ConnectionHarness) -> None:
    harness.auth.result = CredentialCheckResult(status="unsupported", reason_code=None, retryable=False, checked_at=1)
    connection = harness.service.create_api_key(harness.context, harness.command())
    assert connection.credential_status == ConnectionCredentialStatus.CONNECTED


@pytest.mark.parametrize("status", ["invalid", "temporarily_unavailable", "unsupported"])
def test_check_updates_only_definitive_status_without_touching_activity(
    harness: ConnectionHarness, status: str
) -> None:
    connection = harness.service.create_api_key(harness.context, harness.command())
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(last_active_at=datetime(2020, 1, 1))
        )
    harness.auth.result = CredentialCheckResult.model_validate(
        {"status": status, "reason_code": None, "retryable": False, "checked_at": 1}
    )
    result = harness.service.check_connection(harness.context, connection.id)
    assert result.credential_status == (
        ConnectionCredentialStatus.INVALID if status == "invalid" else ConnectionCredentialStatus.CONNECTED
    )
    with harness.sessions() as session:
        row = session.get(EndUserConnection, connection.id)
        assert row is not None
        assert row.last_active_at == datetime(2020, 1, 1)
        assert row.revision == (2 if status == "invalid" else 1)


@pytest.mark.parametrize("change", ["revision", "owner", "delete"])
def test_in_flight_check_cannot_overwrite_concurrent_mutation(harness: ConnectionHarness, change: str) -> None:
    connection = harness.service.create_api_key(harness.context, harness.command())

    def mutate() -> None:
        with harness.sessions.begin() as session:
            if change == "delete":
                session.execute(sa.delete(EndUserConnection).where(EndUserConnection.id == connection.id))
            else:
                values: dict[str, object] = {"revision": EndUserConnection.revision + 1}
                if change == "owner":
                    values["account_id"] = str(uuid4())
                session.execute(
                    sa.update(EndUserConnection).where(EndUserConnection.id == connection.id).values(**values)
                )

    harness.auth.on_check = mutate
    harness.auth.result = CredentialCheckResult(status="invalid", reason_code=None, retryable=False, checked_at=1)
    with pytest.raises(ConnectionConflictError):
        harness.service.check_connection(harness.context, connection.id)


@pytest.mark.parametrize("change", ["workflow", "identity"])
def test_creation_revalidates_after_external_check(harness: ConnectionHarness, change: str) -> None:
    def mutate() -> None:
        with harness.sessions.begin() as session:
            if change == "workflow":
                session.execute(
                    sa.update(App).where(App.id == harness.context.app_id).values({"workflow_id": str(uuid4())})
                )
            else:
                session.execute(
                    sa.update(EndUser).where(EndUser.id == harness.context.end_user_id).values(account_id=str(uuid4()))
                )

    harness.auth.on_check = mutate
    with pytest.raises(ConnectionWorkflowChangedError if change == "workflow" else ConnectionIdentityError):
        harness.service.create_api_key(harness.context, harness.command())
    with harness.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0


def test_scope_and_cursor_cannot_expose_other_owners_connections(harness: ConnectionHarness) -> None:
    other = make_harness(harness.sessions)
    foreign = other.service.create_api_key(other.context, other.command())
    one = harness.service.create_api_key(harness.context, harness.command())
    two = harness.service.create_api_key(harness.context, harness.command())
    with pytest.raises(ConnectionNotFoundError):
        harness.service.get_connection(harness.context, foreign.id)
    first_page = harness.service.list_connections(harness.context, ListConnectionsInput(limit=1))
    second_page = harness.service.list_connections(
        harness.context, ListConnectionsInput(limit=1, cursor=first_page.next_cursor)
    )
    assert [first_page.data[0].id, second_page.data[0].id] == sorted([one.id, two.id])
    assert second_page.next_cursor is None
    with pytest.raises(ConnectionIdentityError):
        harness.service.list_connections(
            replace(harness.context, tenant_id=other.context.tenant_id), ListConnectionsInput()
        )


def test_deleting_api_key_cascades_live_selections_only(harness: ConnectionHarness) -> None:
    with harness.sessions() as session:
        session.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
    connection = harness.service.create_api_key(harness.context, harness.command())
    with harness.sessions.begin() as session:
        session.add(
            AppConnection(
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                workflow_id=harness.workflow_id,
                end_user_id=harness.context.end_user_id,
                node_id="tool-1",
                provider=connection.provider,
                connection_id=connection.id,
                source_run_id=str(uuid4()),
            )
        )
        session.add(
            SessionConnection(
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                workflow_id=harness.workflow_id,
                session_id=str(uuid4()),
                node_id="tool-1",
                provider=connection.provider,
                connection_id=connection.id,
            )
        )
    harness.service.delete_connection(harness.context, connection.id)
    with harness.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AppConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(SessionConnection)) == 0
        assert session.get(App, harness.context.app_id) is not None


def test_anonymous_store_scope_isolated_by_end_user(
    harness: ConnectionHarness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=True)
    with harness.sessions.begin() as session:
        session.execute(sa.update(EndUser).where(EndUser.id == harness.context.end_user_id).values(account_id=None))
    guest = replace(harness.context, account_id=None)
    connection = harness.service.create_api_key(guest, harness.command())
    stored = harness.repository.find(guest, connection.id)
    assert stored is not None
    assert stored.access.owner.end_user_id == guest.end_user_id
    assert stored.access.owner.account_id is None
    with harness.sessions.begin() as session:
        other = EndUser(
            tenant_id=guest.tenant_id,
            app_id=guest.app_id,
            type=EndUserType.BROWSER,
            account_id=None,
            session_id=str(uuid4()),
        )
        session.add(other)
        session.flush()
        other_id = other.id
    with pytest.raises(ConnectionNotFoundError):
        harness.service.get_connection(replace(guest, end_user_id=other_id), connection.id)


def test_foreign_account_in_same_tenant_is_not_visible(harness: ConnectionHarness) -> None:
    connection = harness.service.create_api_key(harness.context, harness.command())
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection).where(EndUserConnection.id == connection.id).values(account_id=str(uuid4()))
        )
    with pytest.raises(ConnectionNotFoundError):
        harness.service.get_connection(harness.context, connection.id)
    assert harness.service.list_connections(harness.context, ListConnectionsInput()).data == ()
