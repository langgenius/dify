from dataclasses import replace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import (
    ConnectionCredentialType,
    ConnectionRevisionAcceptanceReason,
    OAuthClientSource,
)
from models.end_user_connection import (
    AppConnection,
    EndUserConnection,
    EndUserConnectionRevision,
    EndUserConnectionRevisionAcceptance,
    SessionConnection,
)
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connections.cleanup import ConnectionCleanupService
from services.end_user_connections.revision import ConnectionContractSnapshot
from tests.helpers.end_user_connection_contract import new_app_selection, new_connection, new_session_selection


@pytest.mark.parametrize("account_owned", [True, False])
@pytest.mark.parametrize("credential_type", [ConnectionCredentialType.API_KEY, ConnectionCredentialType.OAUTH2])
def test_cleanup_preserves_unreferenced_credentials_and_consent(
    sqlite_session_factory: sessionmaker[Session], account_owned: bool, credential_type: ConnectionCredentialType
) -> None:
    connection = new_connection()
    if not account_owned:
        connection.account_id = None
        connection.end_user_id = str(uuid4())
    if credential_type == ConnectionCredentialType.OAUTH2:
        connection.credential_type = credential_type
        connection.oauth_client_source = OAuthClientSource.WORKSPACE
    app_selection = new_app_selection(connection)
    session_selection = replace(new_session_selection(connection), app_id=app_selection.app_id)
    snapshot = ConnectionContractSnapshot(
        tenant_id=connection.tenant_id, app_id=app_selection.app_id, providers=(), requirements=()
    )
    revision = EndUserConnectionRevision(
        fingerprint="a" * 64,
        tenant_id=connection.tenant_id,
        app_id=app_selection.app_id,
        snapshot=snapshot.canonical_json(),
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([connection, revision])
        session.flush()
        acceptance = EndUserConnectionRevisionAcceptance(
            tenant_id=connection.tenant_id,
            app_id=app_selection.app_id,
            end_user_id=app_selection.end_user_id,
            revision_id=revision.id,
            reason=ConnectionRevisionAcceptanceReason.APPROVED,
            source_revision_id=None,
        )
        session.add_all([app_selection, session_selection, acceptance])
    service = ConnectionCleanupService(store=EndUserConnectionRepository(session_factory=sqlite_session_factory))

    assert service.delete_app_connections(tenant_id=connection.tenant_id, app_id=app_selection.app_id) == 2
    assert service.delete_app_connections(tenant_id=connection.tenant_id, app_id=app_selection.app_id) == 0
    with sqlite_session_factory() as session:
        assert session.get(AppConnection, app_selection.id) is None
        assert session.get(SessionConnection, session_selection.id) is None
        assert session.get(EndUserConnection, connection.id) == connection
        assert session.get(EndUserConnectionRevision, revision.id) == revision
        assert session.get(EndUserConnectionRevisionAcceptance, acceptance.id) == acceptance


@pytest.mark.parametrize("selection_type", [AppConnection, SessionConnection])
@pytest.mark.parametrize("interrupt", [False, True])
def test_cleanup_drains_multiple_batches(
    sqlite_session_factory: sessionmaker[Session],
    selection_type: type[AppConnection] | type[SessionConnection],
    interrupt: bool,
) -> None:
    connection = new_connection()
    app_id = str(uuid4())
    factory = new_app_selection if selection_type is AppConnection else new_session_selection
    selections = [replace(factory(connection), app_id=app_id, node_id=f"tool-{index}") for index in range(1001)]
    max(selections, key=lambda selection: selection.id).node_id = "blocked"
    with sqlite_session_factory.begin() as session:
        session.add(connection)
        session.flush()
        session.add_all(selections)
    service = ConnectionCleanupService(store=EndUserConnectionRepository(session_factory=sqlite_session_factory))

    if interrupt:
        with sqlite_session_factory.begin() as session:
            session.execute(
                sa.text(
                    f"CREATE TRIGGER reject_cleanup BEFORE DELETE ON {selection_type.__tablename__} "
                    "WHEN OLD.node_id = 'blocked' BEGIN SELECT RAISE(ABORT, 'selection cleanup failed'); END"
                )
            )
        with pytest.raises(IntegrityError, match="selection cleanup failed"):
            service.delete_app_connections(tenant_id=connection.tenant_id, app_id=app_id)
        with sqlite_session_factory.begin() as session:
            assert session.scalar(sa.select(sa.func.count()).select_from(selection_type)) == 1
            session.execute(sa.text("DROP TRIGGER reject_cleanup"))

    assert service.delete_app_connections(tenant_id=connection.tenant_id, app_id=app_id) == (1 if interrupt else 1001)
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(selection_type)) == 0
        assert session.get(EndUserConnection, connection.id) == connection
