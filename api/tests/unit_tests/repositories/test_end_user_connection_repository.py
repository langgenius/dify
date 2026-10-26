"""Persisted authorization revisions are immutable, deduplicated, and Web App scoped."""

import hashlib
import re
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

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


def test_revision_id_is_a_durable_content_digest_without_client_metadata(
    sqlite_session_factory: sessionmaker[Session], snapshot: ConnectionContractSnapshot
) -> None:
    repository = EndUserConnectionRepository(session_factory=sqlite_session_factory)
    revision = repository.save_revision(snapshot)
    assert re.fullmatch(r"cr_[0-9a-f]{64}", revision)
    assert revision == "cr_" + hashlib.sha256(snapshot.canonical_json().encode()).hexdigest()
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
    changed = snapshot.model_copy(update={"providers": ()})
    assert repository.get_revision(snapshot.tenant_id, snapshot.app_id, changed.revision) is None


def test_concurrent_snapshot_discovery_persists_one_revision(
    sqlite_session_factory: sessionmaker[Session], snapshot: ConnectionContractSnapshot
) -> None:
    def discover() -> str:
        return EndUserConnectionRepository(session_factory=sqlite_session_factory).save_revision(snapshot)

    with ThreadPoolExecutor(max_workers=4) as pool:
        revisions = list(pool.map(lambda _: discover(), range(8)))
    assert set(revisions) == {snapshot.revision}
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
