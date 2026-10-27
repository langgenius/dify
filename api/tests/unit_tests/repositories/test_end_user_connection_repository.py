"""Persisted authorization revisions are immutable, deduplicated, and Web App scoped."""

import hashlib
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.end_user_connection import EndUserConnectionRevision
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import ConnectionContractSnapshot, ProviderContractSnapshot


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


def test_revision_id_is_a_durable_uuidv7_with_a_private_content_fingerprint(
    sqlite_session_factory: sessionmaker[Session], snapshot: ConnectionContractSnapshot
) -> None:
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)
    revision = repository.save_revision(snapshot)
    assert UUID(revision).version == 7
    with sqlite_session_factory() as session:
        row = session.get(EndUserConnectionRevision, revision)
        assert row is not None
        assert row.fingerprint == hashlib.sha256(snapshot.canonical_json().encode()).hexdigest()
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


def test_snapshot_corruption_cannot_extend_revision_scope(
    sqlite_session_factory: sessionmaker[Session], snapshot: ConnectionContractSnapshot
) -> None:
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)
    revision = repository.save_revision(snapshot)
    corrupted = snapshot.model_copy(update={"providers": ()})
    with sqlite_session_factory.begin() as session:
        session.execute(
            sa.update(EndUserConnectionRevision)
            .where(EndUserConnectionRevision.id == revision)
            .values(snapshot=corrupted.canonical_json())
        )
    with pytest.raises(ConnectionRevisionChangedError):
        repository.get_revision(snapshot.tenant_id, snapshot.app_id, revision)


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


def test_acceptance_is_separate_for_anonymous_and_account_owners(sqlite_session_factory: sessionmaker[Session]) -> None:
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
        assert len(rows) == 4
        for owner_id in (account.account_id, anonymous.end_user_id):
            owned = {row.revision_id: row for row in rows if (row.account_id or row.end_user_id) == owner_id}
            assert owned[original].reason == ConnectionRevisionAcceptanceReason.APPROVED
            assert owned[current].reason == ConnectionRevisionAcceptanceReason.INHERITED
            assert owned[current].source_revision_id == original
