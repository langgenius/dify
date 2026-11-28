"""SQL adapter for file transfer rows."""

from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Final, override
from uuid import UUID

from sqlalchemy import CursorResult, Select, delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.file_transfer import MIME_TYPE_MAX_LENGTH, NAME_MAX_LENGTH, FileTransfer
from services.file_transfer import (
    StoredFile,
    StoredText,
    Transfer,
    TransferDirection,
    TransferRepository,
    TransferTextTooLongError,
)


def _record(row: FileTransfer) -> Transfer:
    return Transfer(
        id=row.id,
        owner_id=row.owner_id,
        direction=TransferDirection(row.direction),
        folder=row.folder,
        file=_stored_file(row),
        created_at=row.created_at,
        expires_at=row.expires_at,
    )


def _stored_file(row: FileTransfer) -> StoredFile | None:
    """Postcondition: the recorded file, or None while nothing arrived. ``claim`` and ``release`` write the
    five columns together, so they are all set or all null.
    """
    if row.received_at is None:
        return None
    if row.name is None:
        return None
    if row.mime_type is None:
        return None
    if row.size is None:
        return None
    if row.sha256 is None:
        return None
    return StoredFile(
        name=row.name, mime_type=row.mime_type, size=row.size, sha256=row.sha256, received_at=row.received_at
    )


# Ids per query when checking which transfers still have a row; keeps each IN list short.
_KNOWN_CHUNK: Final = 1000


class SQLAlchemyFileTransferRepository(TransferRepository):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def create(
        self,
        *,
        owner_id: str,
        token_digest: str,
        direction: TransferDirection,
        folder: bool,
        file: StoredFile | None,
        now: datetime,
        expires_at: datetime,
    ) -> Transfer:
        row = FileTransfer(
            owner_id=owner_id,
            token_digest=token_digest,
            direction=direction.value,
            folder=folder,
            expires_at=expires_at,
        )
        row.created_at = now
        row.updated_at = now
        if file is not None:
            _check_text(file)
            row.name = file.name
            row.mime_type = file.mime_type
            row.size = file.size
            row.sha256 = file.sha256
            row.received_at = file.received_at
        with self._session_factory.begin() as session:
            session.add(row)
            session.flush()
            return _record(row)

    @override
    def claim(self, *, transfer_id: str, file: StoredFile) -> bool:
        _check_text(file)
        statement = (
            update(FileTransfer)
            .where(FileTransfer.id == transfer_id, FileTransfer.received_at.is_(None))
            .values(
                name=file.name,
                mime_type=file.mime_type,
                size=file.size,
                sha256=file.sha256,
                received_at=file.received_at,
            )
        )
        with self._session_factory.begin() as session:
            result = session.execute(statement)
        assert isinstance(result, CursorResult)
        return result.rowcount == 1

    @override
    def release(self, *, transfer_id: str) -> None:
        statement = (
            update(FileTransfer)
            .where(FileTransfer.id == transfer_id)
            .values(name=None, mime_type=None, size=None, sha256=None, received_at=None)
        )
        with self._session_factory.begin() as session:
            session.execute(statement)

    @override
    def find(self, *, owner_id: str, transfer_id: str, now: datetime) -> Transfer | None:
        statement = select(FileTransfer).where(
            FileTransfer.id == transfer_id,
            FileTransfer.owner_id == owner_id,
            FileTransfer.expires_at > now,
        )
        return self._by_id(transfer_id, statement, _record)

    @override
    def get(self, *, transfer_id: str, now: datetime) -> Transfer | None:
        statement = select(FileTransfer).where(FileTransfer.id == transfer_id, FileTransfer.expires_at > now)
        return self._by_id(transfer_id, statement, _record)

    @override
    def token_digest(self, *, transfer_id: str, now: datetime) -> str | None:
        statement = select(FileTransfer.token_digest).where(
            FileTransfer.id == transfer_id, FileTransfer.expires_at > now
        )
        return self._by_id(transfer_id, statement, str)

    @override
    def owned(self, *, owner_id: str) -> Sequence[Transfer]:
        statement = (
            select(FileTransfer)
            .where(FileTransfer.owner_id == owner_id)
            .order_by(FileTransfer.created_at, FileTransfer.id)
        )
        return self._all(statement)

    @override
    def expired(self, *, now: datetime, limit: int) -> Sequence[Transfer]:
        statement = (
            select(FileTransfer)
            .where(FileTransfer.expires_at <= now)
            .order_by(FileTransfer.created_at, FileTransfer.id)
            .limit(limit)
        )
        return self._all(statement)

    @override
    def expire(self, *, transfer_ids: Sequence[str], now: datetime) -> None:
        statement = (
            update(FileTransfer)
            .where(FileTransfer.id.in_(transfer_ids), FileTransfer.expires_at > now)
            .values(expires_at=now)
        )
        with self._session_factory.begin() as session:
            session.execute(statement)

    @override
    def known(self, *, transfer_ids: Sequence[str]) -> set[str]:
        """Postcondition: the ids among ``transfer_ids`` that have a row, ended or not; an id not spelled as the
        module issues ids (see ``_is_canonical_uuid``) has none and is not queried. Queried in chunks of
        ``_KNOWN_CHUNK`` ids.
        """
        ids = [transfer_id for transfer_id in transfer_ids if _is_canonical_uuid(transfer_id)]
        chunks = [ids[start : start + _KNOWN_CHUNK] for start in range(0, len(ids), _KNOWN_CHUNK)]
        with self._session_factory() as session:
            return {
                str(found)
                for chunk in chunks
                for found in session.scalars(select(FileTransfer.id).where(FileTransfer.id.in_(chunk)))
            }

    @override
    def delete(self, *, transfer_ids: Sequence[str]) -> None:
        with self._session_factory.begin() as session:
            session.execute(delete(FileTransfer).where(FileTransfer.id.in_(transfer_ids)))

    def _by_id[T, R](self, transfer_id: str, statement: Select[tuple[T]], value_of: Callable[[T], R]) -> R | None:
        """Postcondition: the one value the statement selects for ``transfer_id``, mapped before the session
        closes; None when there is none or the id is not spelled as the module issues ids (see
        ``_is_canonical_uuid``), and such an id is never queried. An id comes from a URL or a request body: another
        spelling of an issued id would find its row while its storage key, built from the spelling sent, finds no
        bytes, and PostgreSQL refuses to compare a UUID column with text that is not a UUID.
        """
        if not _is_canonical_uuid(transfer_id):
            return None
        with self._session_factory() as session:
            found = session.scalar(statement)
            if found is None:
                return None
            return value_of(found)

    def _all(self, statement: Select[tuple[FileTransfer]]) -> list[Transfer]:
        with self._session_factory() as session:
            return [_record(row) for row in session.scalars(statement)]


def _check_text(file: StoredFile) -> None:
    """Postcondition: the file's name and MIME type fit their columns, or ``TransferTextTooLongError``."""
    for text, value, limit in (
        (StoredText.NAME, file.name, NAME_MAX_LENGTH),
        (StoredText.MIME_TYPE, file.mime_type, MIME_TYPE_MAX_LENGTH),
    ):
        if len(value) > limit:
            raise TransferTextTooLongError(text, limit=limit)


def _is_canonical_uuid(value: str) -> bool:
    """Postcondition: True only for the spelling ids are issued in: lower-case hex with hyphens, as ``str(UUID)``
    writes it; upper case, no hyphens, braces, a ``urn:uuid:`` prefix or surrounding space are False."""
    try:
        parsed = UUID(value)
    except ValueError:
        return False
    return str(parsed) == value
