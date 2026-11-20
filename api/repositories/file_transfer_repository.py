"""SQL adapter for file transfer rows."""

from collections.abc import Sequence
from datetime import datetime
from typing import override

from sqlalchemy import CursorResult, Select, delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.file_transfer import FileTransfer
from services.file_transfer import StoredFile, Transfer, TransferDirection, TransferRepository


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
            _write_file(row, file)
        with self._session_factory.begin() as session:
            session.add(row)
            session.flush()
            return _record(row)

    @override
    def claim(self, *, transfer_id: str, file: StoredFile) -> bool:
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
        return self._one(statement)

    @override
    def get(self, *, transfer_id: str, now: datetime) -> Transfer | None:
        statement = select(FileTransfer).where(FileTransfer.id == transfer_id, FileTransfer.expires_at > now)
        return self._one(statement)

    @override
    def token_digest(self, *, transfer_id: str, now: datetime) -> str | None:
        statement = select(FileTransfer.token_digest).where(
            FileTransfer.id == transfer_id, FileTransfer.expires_at > now
        )
        with self._session_factory() as session:
            return session.scalar(statement)

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
    def delete(self, *, transfer_ids: Sequence[str]) -> None:
        with self._session_factory.begin() as session:
            session.execute(delete(FileTransfer).where(FileTransfer.id.in_(transfer_ids)))

    def _one(self, statement: Select[tuple[FileTransfer]]) -> Transfer | None:
        with self._session_factory() as session:
            row = session.scalar(statement)
            if row is None:
                return None
            return _record(row)

    def _all(self, statement: Select[tuple[FileTransfer]]) -> list[Transfer]:
        with self._session_factory() as session:
            return [_record(row) for row in session.scalars(statement)]


def _write_file(row: FileTransfer, file: StoredFile) -> None:
    row.name = file.name
    row.mime_type = file.mime_type
    row.size = file.size
    row.sha256 = file.sha256
    row.received_at = file.received_at
