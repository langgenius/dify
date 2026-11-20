from dataclasses import replace
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.file_transfer import FileTransfer
from repositories.file_transfer_repository import SQLAlchemyFileTransferRepository
from services.file_transfer import StoredFile, Transfer, TransferDirection

_NOW = datetime(2026, 11, 20, 10, 0)
_LIFE = timedelta(minutes=40)
_FILE = StoredFile(name="r.pdf", mime_type="application/pdf", size=4, sha256="a" * 64, received_at=_NOW)


def _create(
    repository: SQLAlchemyFileTransferRepository,
    *,
    owner_id: str = "owner",
    now: datetime = _NOW,
    file: StoredFile | None = None,
    direction: TransferDirection = TransferDirection.IN,
) -> Transfer:
    return repository.create(
        owner_id=owner_id,
        token_digest="d" * 64,
        direction=direction,
        folder=False,
        file=file,
        now=now,
        expires_at=now + _LIFE,
    )


def test_create_returns_the_record_as_stored(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)

    parked = _create(repository, file=_FILE, direction=TransferDirection.OUT)

    assert repository.get(transfer_id=parked.id, now=_NOW) == parked
    assert (parked.direction, parked.file, parked.created_at, parked.expires_at) == (
        TransferDirection.OUT,
        _FILE,
        _NOW,
        _NOW + _LIFE,
    )
    assert repository.token_digest(transfer_id=parked.id, now=_NOW) == "d" * 64


def test_find_is_scoped_to_owner_and_expiry(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    transfer = _create(repository)

    assert repository.find(owner_id="owner", transfer_id=transfer.id, now=_NOW) == transfer
    assert repository.find(owner_id="other", transfer_id=transfer.id, now=_NOW) is None
    assert repository.find(owner_id="owner", transfer_id=transfer.id, now=_NOW + _LIFE) is None
    assert repository.get(transfer_id=transfer.id, now=_NOW + _LIFE) is None
    assert repository.token_digest(transfer_id=transfer.id, now=_NOW + _LIFE) is None


def test_claim_records_the_file_once(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    transfer = _create(repository)

    first = repository.claim(transfer_id=transfer.id, file=_FILE)
    second = repository.claim(transfer_id=transfer.id, file=replace(_FILE, sha256="b" * 64))

    assert (first, second) == (True, False)
    stored = repository.get(transfer_id=transfer.id, now=_NOW)
    assert stored is not None
    assert stored.file == _FILE


def test_claim_of_an_unknown_transfer_records_nothing(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)

    assert repository.claim(transfer_id="00000000-0000-4000-8000-000000000000", file=_FILE) is False


def test_release_lets_a_later_claim_win(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    transfer = _create(repository)
    repository.claim(transfer_id=transfer.id, file=_FILE)

    repository.release(transfer_id=transfer.id)
    released = repository.get(transfer_id=transfer.id, now=_NOW)
    later = replace(_FILE, sha256="b" * 64)

    assert released is not None
    assert released.file is None
    assert repository.claim(transfer_id=transfer.id, file=later) is True
    claimed = repository.get(transfer_id=transfer.id, now=_NOW)
    assert claimed is not None
    assert claimed.file == later


def test_owned_lists_oldest_first_and_includes_expired(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    newer = _create(repository, now=_NOW + timedelta(seconds=1))
    older = _create(repository, now=_NOW - _LIFE)
    _create(repository, owner_id="other")

    assert [transfer.id for transfer in repository.owned(owner_id="owner")] == [older.id, newer.id]


def test_expired_returns_oldest_first_up_to_limit(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    second = _create(repository, owner_id="b", now=_NOW - _LIFE)
    first = _create(repository, owner_id="a", now=_NOW - _LIFE - timedelta(seconds=1))
    _create(repository, owner_id="c")

    assert [transfer.id for transfer in repository.expired(now=_NOW, limit=10)] == [first.id, second.id]
    assert [transfer.id for transfer in repository.expired(now=_NOW, limit=1)] == [first.id]


def test_delete_removes_the_rows(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    gone = _create(repository)
    kept = _create(repository)

    repository.delete(transfer_ids=[gone.id])

    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(FileTransfer)) == 1
    assert repository.get(transfer_id=kept.id, now=_NOW) == kept
