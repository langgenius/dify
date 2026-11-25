from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from models.file_transfer import MIME_TYPE_MAX_LENGTH, NAME_MAX_LENGTH, FileTransfer
from repositories.file_transfer_repository import SQLAlchemyFileTransferRepository
from services.file_transfer import StoredFile, StoredText, Transfer, TransferDirection, TransferTextTooLongError

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


def test_expire_ends_live_transfers_and_leaves_ended_ones(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    live = _create(repository)
    ended = _create(repository, now=_NOW - _LIFE - timedelta(seconds=1))
    untouched = _create(repository)
    later = _NOW + timedelta(seconds=5)

    repository.expire(transfer_ids=[live.id, ended.id], now=later)

    assert repository.get(transfer_id=live.id, now=later) is None
    assert repository.get(transfer_id=untouched.id, now=later) == untouched
    assert [transfer.id for transfer in repository.expired(now=later, limit=10)] == [ended.id, live.id]
    assert {transfer.id: transfer.expires_at for transfer in repository.owned(owner_id="owner")} == {
        live.id: later,
        ended.id: ended.expires_at,
        untouched.id: untouched.expires_at,
    }


def test_known_names_the_ids_with_a_row_ended_or_not(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    live = _create(repository)
    ended = _create(repository, now=_NOW - _LIFE - timedelta(seconds=1))
    gone = _create(repository)
    repository.delete(transfer_ids=[gone.id])

    known = repository.known(transfer_ids=[live.id, ended.id, gone.id, "not-a-uuid"])

    assert known == {live.id, ended.id}


_OTHER_SPELLINGS: dict[str, Callable[[str], str]] = {
    "upper case": str.upper,
    "no hyphens": lambda issued: issued.replace("-", ""),
    "braces": lambda issued: f"{{{issued}}}",
    "urn prefix": lambda issued: f"urn:uuid:{issued}",
    "leading space": lambda issued: f" {issued}",
    "trailing space": lambda issued: f"{issued} ",
    "not a uuid": lambda _issued: "not-a-uuid",
}


@pytest.mark.parametrize("spelling", list(_OTHER_SPELLINGS.values()), ids=list(_OTHER_SPELLINGS))
def test_only_the_issued_spelling_of_an_id_finds_its_transfer_and_others_never_query(
    spelling: Callable[[str], str], sqlite_session_factory: sessionmaker[Session]
) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    issued = _create(repository, file=_FILE)
    other = spelling(issued.id)
    statements: list[str] = []
    engine = sqlite_session_factory.kw["bind"]

    def count(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        answers = (
            repository.find(owner_id="owner", transfer_id=other, now=_NOW),
            repository.get(transfer_id=other, now=_NOW),
            repository.token_digest(transfer_id=other, now=_NOW),
            repository.known(transfer_ids=[other]),
        )
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert answers == (None, None, None, set())
    assert statements == []
    assert repository.get(transfer_id=issued.id, now=_NOW) == issued
    assert repository.known(transfer_ids=[issued.id]) == {issued.id}


def test_delete_removes_the_rows(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    gone = _create(repository)
    kept = _create(repository)

    repository.delete(transfer_ids=[gone.id])

    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(FileTransfer)) == 1
    assert repository.get(transfer_id=kept.id, now=_NOW) == kept


_LONGEST = {StoredText.NAME: NAME_MAX_LENGTH, StoredText.MIME_TYPE: MIME_TYPE_MAX_LENGTH}


def _with_text(text: StoredText, length: int) -> StoredFile:
    value = "x" * length
    if text is StoredText.NAME:
        return replace(_FILE, name=value)
    return replace(_FILE, mime_type=value)


@pytest.mark.parametrize("text", list(StoredText))
def test_a_name_or_type_longer_than_its_column_is_refused_before_writing(
    text: StoredText, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repository = SQLAlchemyFileTransferRepository(session_factory=sqlite_session_factory)
    transfer = _create(repository)
    longer = _with_text(text, _LONGEST[text] + 1)

    with pytest.raises(TransferTextTooLongError) as claimed:
        repository.claim(transfer_id=transfer.id, file=longer)
    with pytest.raises(TransferTextTooLongError):
        _create(repository, file=longer, direction=TransferDirection.OUT)

    assert (claimed.value.text, claimed.value.limit) == (text, _LONGEST[text])
    assert repository.owned(owner_id="owner") == [transfer]
    assert repository.claim(transfer_id=transfer.id, file=_with_text(text, _LONGEST[text])) is True
