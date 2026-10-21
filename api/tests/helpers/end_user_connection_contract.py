"""Persistence contracts shared by local SQLite and CI PostgreSQL tests."""

from dataclasses import replace
from datetime import datetime
from uuid import UUID

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from libs.uuid_utils import uuidv7
from models.end_user_connection import (
    AppConnection,
    ConnectionCredentialType,
    ConnectionStatus,
    EndUserConnection,
    OAuthClientSource,
    SessionConnection,
)


def new_connection() -> EndUserConnection:
    return EndUserConnection(
        tenant_id=str(uuidv7()),
        account_id=str(uuidv7()),
        end_user_id=None,
        provider="vendor/calendar/calendar",
        credential_type=ConnectionCredentialType.API_KEY,
        name="Personal calendar",
        encrypted_credentials="encrypted-credential-payload",
        status=ConnectionStatus.CONNECTED,
        oauth_client_source=None,
        oauth_client_configuration_id=None,
        oauth_client_id=None,
        expires_at=None,
    )


def new_app_selection(connection: EndUserConnection) -> AppConnection:
    return AppConnection(
        tenant_id=connection.tenant_id,
        app_id=str(uuidv7()),
        workflow_id=str(uuidv7()),
        node_id="tool-1",
        end_user_id=connection.end_user_id or str(uuidv7()),
        provider=connection.provider,
        connection_id=connection.id,
        source_run_id=str(uuidv7()),
    )


def new_session_selection(connection: EndUserConnection) -> SessionConnection:
    return SessionConnection(
        tenant_id=connection.tenant_id,
        app_id=str(uuidv7()),
        workflow_id=str(uuidv7()),
        node_id="tool-1",
        session_id=str(uuidv7()),
        provider=connection.provider,
        connection_id=connection.id,
    )


class ConnectionPersistenceTests:
    @pytest.mark.parametrize("account_owned", [True, False])
    def test_multiple_connections_per_owner_and_provider(
        self, connection_session: Session, account_owned: bool
    ) -> None:
        first = new_connection()
        if not account_owned:
            first.account_id = None
            first.end_user_id = str(uuidv7())
        second = replace(first)
        connection_session.add_all([first, second])
        connection_session.flush()
        connection_session.expire_all()

        assert first.id != second.id
        assert UUID(first.id).version == 7
        assert first.account_id == second.account_id
        assert first.end_user_id == second.end_user_id
        assert first.name == second.name
        assert first.revision == 1
        assert first.encrypted_credentials not in repr(first)

    @pytest.mark.parametrize(
        ("assignment", "constraint"),
        [
            ("account_id = NULL", "owner"),
            ("end_user_id = account_id", "owner"),
            ("credential_type = 'unknown'", "credential_type"),
            ("status = 'unknown'", "status"),
            ("revision = 0", "revision"),
            ("name = ''", "name"),
            ("credential_type = 'oauth2'", "oauth"),
            ("oauth_client_source = 'workspace'", "oauth"),
            ("oauth_client_configuration_id = account_id", "oauth"),
            ("oauth_client_id = 'public-client'", "oauth"),
            ("credential_type = 'oauth2', oauth_client_source = 'unknown'", "oauth"),
            ("expires_at = CURRENT_TIMESTAMP", "oauth"),
        ],
    )
    def test_database_rejects_invalid_credential_state(
        self, connection_session: Session, assignment: str, constraint: str
    ) -> None:
        connection = new_connection()
        connection_session.add(connection)
        connection_session.flush()

        # Raw SQL exercises database checks independently of Python enum validation.
        with pytest.raises(IntegrityError, match=f"end_user_connection_{constraint}_check"):
            with connection_session.begin_nested():
                connection_session.execute(
                    sa.text(f"UPDATE end_user_connections SET {assignment} WHERE id = :id"), {"id": connection.id}
                )

    @pytest.mark.parametrize("source", list(OAuthClientSource))
    @pytest.mark.parametrize("known_client", [True, False])
    def test_oauth_client_columns_round_trip(
        self, connection_session: Session, source: OAuthClientSource, known_client: bool
    ) -> None:
        configuration_id = str(uuidv7()) if known_client else None
        client_id = "public-client" if known_client else None
        connection = replace(
            new_connection(),
            credential_type=ConnectionCredentialType.OAUTH2,
            oauth_client_source=source,
            oauth_client_configuration_id=configuration_id,
            oauth_client_id=client_id,
            expires_at=datetime(2030, 1, 1),
        )
        connection_session.add(connection)
        connection_session.flush()
        connection_session.expire(connection)
        assert connection.oauth_client_source == source
        assert connection.oauth_client_configuration_id == configuration_id
        assert connection.oauth_client_id == client_id
        assert connection.expires_at == datetime(2030, 1, 1)

    def test_name_limit_counts_characters(self, connection_session: Session) -> None:
        connection = replace(new_connection(), name="\u00e9" * 100)
        connection_session.add(connection)
        connection_session.flush()
        with connection_session.begin_nested() as savepoint:
            connection.name += "x"
            with pytest.raises((IntegrityError, DataError)):
                connection_session.flush()
            savepoint.rollback()

    def test_end_user_owned_connections_can_save_selections(self, connection_session: Session) -> None:
        connection = replace(new_connection(), account_id=None, end_user_id=str(uuidv7()))
        connection_session.add(connection)
        connection_session.flush()
        app_default = new_app_selection(connection)
        session_selection = replace(new_session_selection(connection), app_id=app_default.app_id)
        connection_session.add_all([app_default, session_selection])
        connection_session.flush()
        assert app_default.end_user_id == connection.end_user_id
        assert app_default.connection_id == session_selection.connection_id == connection.id

    def test_app_defaults_and_sessions_are_independent(self, connection_session: Session) -> None:
        first = new_connection()
        second = replace(first)
        connection_session.add_all([first, second])
        connection_session.flush()
        app_default = new_app_selection(first)
        other_app_default = replace(app_default, app_id=str(uuidv7()), end_user_id=str(uuidv7()))
        first_session = replace(new_session_selection(second), app_id=app_default.app_id)
        second_session = replace(first_session, session_id=str(uuidv7()), connection_id=first.id)
        connection_session.add_all([app_default, other_app_default, first_session, second_session])
        connection_session.flush()
        connection_session.expire_all()
        assert app_default.connection_id == other_app_default.connection_id == first.id
        assert first_session.connection_id == second.id
        assert second_session.connection_id == first.id

    @pytest.mark.parametrize("relation", ["app", "session"])
    def test_selection_requires_workflow_version(self, connection_session: Session, relation: str) -> None:
        connection = new_connection()
        connection_session.add(connection)
        connection_session.flush()
        selection = new_app_selection(connection) if relation == "app" else new_session_selection(connection)
        connection_session.add(selection)
        connection_session.flush()
        with pytest.raises(IntegrityError):
            with connection_session.begin_nested():
                connection_session.execute(
                    sa.text(f"UPDATE {selection.__tablename__} SET workflow_id = NULL WHERE id = :id"),
                    {"id": selection.id},
                )

    @pytest.mark.parametrize("relation", ["app", "session"])
    def test_new_workflow_version_replaces_current_choice_instead_of_adding_history(
        self, connection_session: Session, relation: str
    ) -> None:
        first = new_connection()
        second = replace(first)
        connection_session.add_all([first, second])
        connection_session.flush()
        selection = new_app_selection(first) if relation == "app" else new_session_selection(first)
        connection_session.add(selection)
        connection_session.flush()
        original_version = selection.workflow_id
        connection_session.expire(selection)
        assert selection.workflow_id == original_version

        new_version = str(uuidv7())
        with connection_session.begin_nested() as savepoint:
            connection_session.add(replace(selection, workflow_id=new_version, connection_id=second.id))
            with pytest.raises(IntegrityError):
                connection_session.flush()
            savepoint.rollback()

        selection.workflow_id = new_version
        selection.connection_id = second.id
        if isinstance(selection, AppConnection):
            selection.source_run_id = str(uuidv7())
        connection_session.flush()
        connection_session.expire(selection)
        assert selection.workflow_id == new_version
        assert selection.connection_id == second.id
        assert connection_session.scalar(sa.select(sa.func.count()).select_from(type(selection))) == 1

    @pytest.mark.parametrize("relation", ["app", "session"])
    def test_distinct_nodes_can_select_different_connections_for_same_provider(
        self, connection_session: Session, relation: str
    ) -> None:
        first = new_connection()
        second = replace(first)
        connection_session.add_all([first, second])
        connection_session.flush()
        selection = new_app_selection(first) if relation == "app" else new_session_selection(first)
        other_node = replace(selection, node_id="tool-2", connection_id=second.id)
        connection_session.add_all([selection, other_node])
        connection_session.flush()
        connection_session.expire_all()
        assert selection.provider == other_node.provider
        assert selection.connection_id != other_node.connection_id

    def test_same_node_id_has_independent_defaults_for_different_users(self, connection_session: Session) -> None:
        first = new_connection()
        second = replace(first, account_id=str(uuidv7()))
        connection_session.add_all([first, second])
        connection_session.flush()
        selection = new_app_selection(first)
        other_user = replace(selection, end_user_id=str(uuidv7()), connection_id=second.id)
        connection_session.add_all([selection, other_user])
        connection_session.flush()
        assert selection.node_id == other_user.node_id
        assert selection.connection_id != other_user.connection_id

    @pytest.mark.parametrize("relation", ["app", "session"])
    def test_selection_requires_nonempty_node_id(self, connection_session: Session, relation: str) -> None:
        connection = new_connection()
        connection_session.add(connection)
        connection_session.flush()
        selection = new_app_selection(connection) if relation == "app" else new_session_selection(connection)
        selection.node_id = ""
        with connection_session.begin_nested() as savepoint:
            connection_session.add(selection)
            with pytest.raises(IntegrityError):
                connection_session.flush()
            savepoint.rollback()

    @pytest.mark.parametrize("relation", ["app", "session"])
    @pytest.mark.parametrize("different_provider", [True, False])
    def test_duplicate_node_selection_is_rejected(
        self, connection_session: Session, relation: str, different_provider: bool
    ) -> None:
        first = new_connection()
        second = replace(first, provider="vendor/other/other" if different_provider else first.provider)
        connection_session.add_all([first, second])
        connection_session.flush()
        selection = new_app_selection(first) if relation == "app" else new_session_selection(first)
        connection_session.add(selection)
        connection_session.flush()
        with connection_session.begin_nested() as savepoint:
            connection_session.add(replace(selection, connection_id=second.id, provider=second.provider))
            with pytest.raises(IntegrityError):
                connection_session.flush()
            savepoint.rollback()

    @pytest.mark.parametrize("relation", ["app", "session"])
    @pytest.mark.parametrize("mismatch", ["tenant", "provider", "connection"])
    def test_selection_must_reference_matching_credential_namespace(
        self, connection_session: Session, relation: str, mismatch: str
    ) -> None:
        connection = new_connection()
        connection_session.add(connection)
        connection_session.flush()
        selection = new_app_selection(connection) if relation == "app" else new_session_selection(connection)
        if mismatch == "tenant":
            selection.tenant_id = str(uuidv7())
        elif mismatch == "provider":
            selection.provider = "vendor/other/other"
        else:
            selection.connection_id = str(uuidv7())
        with connection_session.begin_nested() as savepoint:
            connection_session.add(selection)
            with pytest.raises(IntegrityError):
                connection_session.flush()
            savepoint.rollback()

    def test_unlink_and_credential_delete_have_different_cascade_scopes(self, connection_session: Session) -> None:
        first = new_connection()
        second = replace(first)
        connection_session.add_all([first, second])
        connection_session.flush()
        app = new_app_selection(first)
        other_app = new_app_selection(first)
        session = new_session_selection(first)
        other_session = new_session_selection(second)
        connection_session.add_all([app, other_app, session, other_session])
        connection_session.flush()

        connection_session.delete(app)
        connection_session.flush()
        assert connection_session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 2
        assert connection_session.scalar(sa.select(sa.func.count()).select_from(SessionConnection)) == 2

        connection_session.delete(first)
        connection_session.flush()
        assert connection_session.scalars(sa.select(AppConnection.id)).all() == []
        assert connection_session.scalars(sa.select(SessionConnection.id)).all() == [other_session.id]
        assert connection_session.scalars(sa.select(EndUserConnection.id)).all() == [second.id]

    def test_read_and_metadata_change_preserve_activity(self, connection_session: Session) -> None:
        connection = new_connection()
        connection.last_active_at = datetime(2020, 1, 1)
        connection_session.add(connection)
        connection_session.flush()
        connection_session.expire_all()
        assert connection_session.get(EndUserConnection, connection.id) is connection
        connection.status = ConnectionStatus.RECONNECT_REQUIRED
        connection_session.flush()
        connection_session.expire_all()
        assert connection.last_active_at == datetime(2020, 1, 1)
