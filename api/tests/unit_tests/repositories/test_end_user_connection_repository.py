"""Connection persistence preserves owner scope and immutable authorization revisions."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialType, OAuthClientSource
from models.end_user_connection import AppConnection, EndUserConnection, EndUserConnectionRevision, SessionConnection
from models.model import EndUser
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import (
    ConnectionContractSnapshot,
    ConnectionRevisionAcceptance,
    ProviderContractSnapshot,
)
from tests.helpers.end_user_api_key import make_harness
from tests.helpers.end_user_connection_contract import new_app_selection, new_connection, new_session_selection
from tests.helpers.end_user_oauth import make_oauth_harness


def test_deleted_app_selection_cleanup_is_scoped_and_bounded(sqlite_session_factory: sessionmaker[Session]) -> None:
    connection = new_connection()
    foreign_connection = new_connection()
    app_id = str(uuid4())
    removed = [
        replace(factory(connection), app_id=app_id, node_id=f"tool-{index}")
        for factory in (new_app_selection, new_session_selection)
        for index in range(3)
    ]
    kept = [
        new_app_selection(connection),
        new_session_selection(connection),
        replace(new_app_selection(foreign_connection), app_id=app_id),
        replace(new_session_selection(foreign_connection), app_id=app_id),
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([connection, foreign_connection])
        session.flush()
        session.add_all([*removed, *kept])
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)

    assert repository.delete_app_selections_batch(tenant_id=connection.tenant_id, app_id=app_id, batch_size=2) == 4
    with sqlite_session_factory() as session:
        assert sum(session.get(type(selection), selection.id) is not None for selection in removed) == 2
    assert repository.delete_app_selections_batch(tenant_id=connection.tenant_id, app_id=app_id, batch_size=2) == 2
    assert repository.delete_app_selections_batch(tenant_id=connection.tenant_id, app_id=app_id, batch_size=2) == 0
    with sqlite_session_factory() as session:
        assert all(session.get(type(selection), selection.id) is None for selection in removed)
        assert all(session.get(type(selection), selection.id) is not None for selection in kept)
        assert session.get(EndUserConnection, connection.id) == connection
        assert session.get(EndUserConnection, foreign_connection.id) == foreign_connection


def test_deleted_app_selection_cleanup_rolls_back_both_tables_on_failure(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    connection = new_connection()
    app_selection = new_app_selection(connection)
    session_selection = replace(new_session_selection(connection), app_id=app_selection.app_id)
    with sqlite_session_factory.begin() as session:
        session.add(connection)
        session.flush()
        session.add_all([app_selection, session_selection])
        session.execute(
            sa.text(
                "CREATE TRIGGER reject_session_selection_cleanup BEFORE DELETE ON session_connections "
                "BEGIN SELECT RAISE(ABORT, 'selection cleanup failed'); END"
            )
        )
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)

    with pytest.raises(IntegrityError, match="selection cleanup failed"):
        repository.delete_app_selections_batch(
            tenant_id=connection.tenant_id, app_id=app_selection.app_id, batch_size=2
        )
    with sqlite_session_factory.begin() as session:
        assert session.get(AppConnection, app_selection.id) is not None
        assert session.get(SessionConnection, session_selection.id) is not None
        session.execute(sa.text("DROP TRIGGER reject_session_selection_cleanup"))
    assert (
        repository.delete_app_selections_batch(
            tenant_id=connection.tenant_id, app_id=app_selection.app_id, batch_size=2
        )
        == 2
    )


@pytest.mark.parametrize("batch_size", [0, -1])
def test_deleted_app_selection_cleanup_rejects_nonpositive_batches(
    sqlite_session_factory: sessionmaker[Session], batch_size: int
) -> None:
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)
    with pytest.raises(ValueError, match="batch size must be positive"):
        repository.delete_app_selections_batch(tenant_id=str(uuid4()), app_id=str(uuid4()), batch_size=batch_size)


@pytest.mark.parametrize("anonymous", [False, True])
@pytest.mark.parametrize("credential_type", [ConnectionCredentialType.API_KEY, ConnectionCredentialType.OAUTH2])
def test_connection_names_increment_within_tenant_owner_provider_and_type(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    anonymous: bool,
    credential_type: ConnectionCredentialType,
) -> None:
    oauth = (
        make_oauth_harness(sqlite_session_factory, monkeypatch)
        if credential_type == ConnectionCredentialType.OAUTH2
        else None
    )
    harness = oauth.base if oauth is not None else make_harness(sqlite_session_factory)
    attempt = (
        oauth.service.consume_attempt(oauth.start().context_id, provider="vendor/calendar/calendar")
        if oauth is not None
        else None
    )
    prefix = "AUTH" if oauth is not None else "API KEY"
    context = harness.context
    if anonymous:
        with sqlite_session_factory.begin() as session:
            user = session.get(EndUser, context.end_user_id)
            assert user is not None
            user.account_id = None
        context = replace(context, account_id=None)
    owner = context.owner
    seed = replace(
        new_connection(),
        tenant_id=context.tenant_id,
        account_id=owner.account_id,
        end_user_id=owner.end_user_id,
        credential_type=credential_type,
        oauth_client_source=OAuthClientSource.WORKSPACE if oauth is not None else None,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                replace(seed, name=f"{prefix} 1"),
                replace(seed, name=f"{prefix} 3"),
                replace(seed, name="Custom name"),
                replace(seed, name=f"{prefix} x"),
                replace(seed, name=f"{prefix} 90", tenant_id=str(uuid4())),
                replace(
                    seed,
                    name=f"{prefix} 91",
                    account_id=None if anonymous else str(uuid4()),
                    end_user_id=str(uuid4()) if anonymous else None,
                ),
                replace(seed, name=f"{prefix} 92", provider="vendor/mail/mail"),
                replace(
                    seed,
                    name=f"{prefix} 93",
                    credential_type=ConnectionCredentialType.API_KEY
                    if oauth is not None
                    else ConnectionCredentialType.OAUTH2,
                    oauth_client_source=None if oauth is not None else OAuthClientSource.WORKSPACE,
                ),
            ]
        )
    acceptance = ConnectionRevisionAcceptance(harness.connection_revision, None)
    for name, expected in [(None, f"{prefix} 4"), ("", f"{prefix} 5"), ("Personal key", "Personal key")]:
        if attempt is None:
            created = harness.repository.create_api_key(
                context,
                workflow_id=harness.workflow_id,
                provider=seed.provider,
                name=name,
                encrypted_credentials="encrypted-secret",
                revision_acceptance=acceptance,
            )
        else:
            created = harness.repository.save_oauth(
                replace(attempt, context=context, name=name),
                encrypted_credentials="encrypted-secret",
                expires_at=None,
                account_label=None,
                revision_acceptance=acceptance,
            )
        assert created.name == expected


@pytest.fixture
def snapshot() -> ConnectionContractSnapshot:
    return ConnectionContractSnapshot(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        providers=(
            ProviderContractSnapshot(
                provider="vendor/calendar/calendar", plugin_unique_identifier="calendar:1@original"
            ),
            ProviderContractSnapshot(provider="vendor/mail/mail", plugin_unique_identifier="mail:1@original"),
        ),
        requirements=(),
    )


def test_revision_ids_are_stable_uuidv7_references(
    sqlite_session_factory: sessionmaker[Session], snapshot: ConnectionContractSnapshot
) -> None:
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)
    revision = repository.save_revision(snapshot)
    assert UUID(revision).version == 7
    restarted = EndUserConnectionRepository(session_factory=sqlite_session_factory)
    assert restarted.get_revision(snapshot.tenant_id, snapshot.app_id, revision) == snapshot
    assert (
        repository.save_revision(snapshot.model_copy(update={"providers": tuple(reversed(snapshot.providers))}))
        == revision
    )
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevision)) == 1


def test_revision_reads_require_tenant_app_and_a_persisted_snapshot(
    sqlite_session_factory: sessionmaker[Session], snapshot: ConnectionContractSnapshot
) -> None:
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)
    revision = repository.save_revision(snapshot)
    assert repository.get_revision(str(uuid4()), snapshot.app_id, revision) is None
    assert repository.get_revision(snapshot.tenant_id, str(uuid4()), revision) is None
    assert repository.get_revision(snapshot.tenant_id, snapshot.app_id, str(uuid4())) is None


def test_concurrent_snapshot_discovery_persists_one_revision(
    sqlite_session_factory: sessionmaker[Session], snapshot: ConnectionContractSnapshot
) -> None:
    def discover() -> str:
        return EndUserConnectionRepository(session_factory=sqlite_session_factory).save_revision(snapshot)

    with ThreadPoolExecutor(max_workers=4) as pool:
        revisions = list(pool.map(lambda _: discover(), range(8)))
    assert len(set(revisions)) == 1
    assert UUID(revisions[0]).version == 7
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevision)) == 1


def test_foreign_revision_acceptance_rolls_back_connection_creation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from models.end_user_connection import EndUserConnection, EndUserConnectionRevisionAcceptance
    from services.end_user_connections.revision import ConnectionRevisionAcceptance
    from tests.helpers.end_user_api_key import PROVIDER, make_harness

    harness = make_harness(sqlite_session_factory)
    context = harness.context
    foreign = ConnectionContractSnapshot(tenant_id=str(uuid4()), app_id=str(uuid4()), providers=(), requirements=())
    foreign_id = harness.repository.save_revision(foreign)
    with pytest.raises(ConnectionRevisionChangedError):
        harness.repository.create_api_key(
            context,
            workflow_id=harness.workflow_id,
            provider=PROVIDER,
            name="Rejected acceptance",
            encrypted_credentials="ciphertext",
            revision_acceptance=ConnectionRevisionAcceptance.from_revisions(foreign_id, foreign_id),
        )
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUserConnectionRevisionAcceptance)) == 0


def test_acceptance_always_belongs_to_the_end_user_for_guests_and_accounts(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from constants.end_user_connections import ConnectionRevisionAcceptanceReason
    from models.end_user_connection import EndUserConnectionRevisionAcceptance
    from models.enums import EndUserType
    from models.model import EndUser
    from services.end_user_connections.entities import WebConnectionContext
    from services.end_user_connections.revision import ConnectionRevisionAcceptance
    from tests.helpers.end_user_api_key import make_harness

    harness = make_harness(sqlite_session_factory)
    account = harness.context
    with sqlite_session_factory.begin() as session:
        guest = EndUser(
            tenant_id=account.tenant_id,
            app_id=account.app_id,
            type=EndUserType.BROWSER,
            account_id=None,
            session_id=str(uuid4()),
            _is_anonymous=True,
        )
        session.add(guest)
        session.flush()
        anonymous = WebConnectionContext(account.tenant_id, account.app_id, guest.id, None)
    original = harness.connection_revision
    previous = harness.repository.get_revision(account.tenant_id, account.app_id, original)
    assert previous is not None
    current = harness.repository.save_revision(
        previous.model_copy(
            update={
                "providers": tuple(
                    provider.model_copy(update={"plugin_unique_identifier": "calendar:2@verified"})
                    for provider in previous.providers
                )
            }
        )
    )
    for context in (account, anonymous):
        harness.repository.complete_preflight(
            context,
            harness.workflow_id,
            None,
            revision_acceptance=ConnectionRevisionAcceptance.from_revisions(original, current),
        )
    with sqlite_session_factory() as session:
        rows = session.scalars(sa.select(EndUserConnectionRevisionAcceptance)).all()
        assert len(rows) == 2
        for context in (account, anonymous):
            owned = {row.revision_id: row for row in rows if row.end_user_id == context.end_user_id}
            assert owned[current].reason == ConnectionRevisionAcceptanceReason.INHERITED
            assert owned[current].source_revision_id == original


def test_recreated_end_user_records_its_own_acceptance_for_the_same_account(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from dataclasses import replace

    from models.end_user_connection import EndUserConnectionRevisionAcceptance
    from models.model import EndUser
    from services.end_user_connections.revision import ConnectionRevisionAcceptance
    from tests.helpers.end_user_api_key import make_harness

    harness = make_harness(sqlite_session_factory)
    context = harness.context
    revision = harness.connection_revision
    acceptance = ConnectionRevisionAcceptance.from_revisions(revision, revision)
    harness.repository.record_revision_acceptance(context, acceptance)
    with sqlite_session_factory.begin() as session:
        original = session.get(EndUser, context.end_user_id)
        assert original is not None
        replacement = EndUser(
            tenant_id=original.tenant_id,
            app_id=original.app_id,
            type=original.type,
            account_id=original.account_id,
            session_id=str(uuid4()),
            _is_anonymous=False,
        )
        session.delete(original)
        session.flush()
        session.add(replacement)
        session.flush()
        replacement_context = replace(context, end_user_id=replacement.id)
    harness.repository.record_revision_acceptance(replacement_context, acceptance)
    with sqlite_session_factory() as session:
        rows = session.scalars(sa.select(EndUserConnectionRevisionAcceptance)).all()
        assert len(rows) == 2
        assert {row.end_user_id for row in rows} == {context.end_user_id, replacement_context.end_user_id}
