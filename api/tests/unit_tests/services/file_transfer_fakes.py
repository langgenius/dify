"""In-memory fakes shared by the file transfer tests."""

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from enum import StrEnum
from itertools import count

from services.file_transfer import StoredFile, Transfer, TransferDirection


@dataclass
class SettableClock:
    current: datetime

    def __call__(self) -> datetime:
        return self.current

    def advance(self, delta: timedelta) -> None:
        self.current += delta


@dataclass
class InMemoryTransfers:
    """Implements TransferRepository with the same scoping and first-write-wins rule as the SQL adapter."""

    rows: dict[str, Transfer] = field(default_factory=dict)
    digests: dict[str, str] = field(default_factory=dict)
    _ids: Iterator[int] = field(default_factory=count)

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
        transfer = Transfer(
            id=f"transfer-{next(self._ids)}",
            owner_id=owner_id,
            direction=direction,
            folder=folder,
            file=file,
            created_at=now,
            expires_at=expires_at,
        )
        self.rows[transfer.id] = transfer
        self.digests[transfer.id] = token_digest
        return transfer

    def claim(self, *, transfer_id: str, file: StoredFile) -> bool:
        transfer = self.rows.get(transfer_id)
        if transfer is None:
            return False
        if transfer.file is not None:
            return False
        self.rows[transfer_id] = replace(transfer, file=file)
        return True

    def release(self, *, transfer_id: str) -> None:
        self.rows[transfer_id] = replace(self.rows[transfer_id], file=None)

    def find(self, *, owner_id: str, transfer_id: str, now: datetime) -> Transfer | None:
        transfer = self.get(transfer_id=transfer_id, now=now)
        if transfer is None:
            return None
        if transfer.owner_id != owner_id:
            return None
        return transfer

    def get(self, *, transfer_id: str, now: datetime) -> Transfer | None:
        transfer = self.rows.get(transfer_id)
        if transfer is None:
            return None
        if transfer.expires_at <= now:
            return None
        return transfer

    def token_digest(self, *, transfer_id: str, now: datetime) -> str | None:
        if self.get(transfer_id=transfer_id, now=now) is None:
            return None
        return self.digests[transfer_id]

    def owned(self, *, owner_id: str) -> Sequence[Transfer]:
        mine = [transfer for transfer in self.rows.values() if transfer.owner_id == owner_id]
        return sorted(mine, key=lambda transfer: transfer.created_at)

    def expired(self, *, now: datetime, limit: int) -> Sequence[Transfer]:
        old = [transfer for transfer in self.rows.values() if transfer.expires_at <= now]
        return sorted(old, key=lambda transfer: transfer.created_at)[:limit]

    def expire(self, *, transfer_ids: Sequence[str], now: datetime) -> None:
        known = [self.rows[transfer_id] for transfer_id in transfer_ids if transfer_id in self.rows]
        for transfer in known:
            if transfer.expires_at > now:
                self.rows[transfer.id] = replace(transfer, expires_at=now)

    def known(self, *, transfer_ids: Sequence[str]) -> set[str]:
        return {transfer_id for transfer_id in transfer_ids if transfer_id in self.rows}

    def delete(self, *, transfer_ids: Sequence[str]) -> None:
        for transfer_id in transfer_ids:
            self.rows.pop(transfer_id, None)
            self.digests.pop(transfer_id, None)


class SavePoint(StrEnum):
    """When an action set with ``InMemoryBlobs.during_next_save`` runs: before or after the bytes are stored."""

    BEFORE_STORE = "before_store"
    AFTER_STORE = "after_store"


@dataclass
class InMemoryBlobs:
    """Implements TransferBlobs. ``fail_next_save`` and ``fail_next_delete`` make the next call raise OSError;
    ``during_next_save`` runs an action inside the next save, as another request would. ``reads`` lists every
    file name a call looked up or read, in order.
    """

    files: dict[str, bytes] = field(default_factory=dict)
    reads: list[str] = field(default_factory=list)
    _fail_next_save: bool = False
    _fail_next_delete: bool = False
    _during_next_save: tuple[SavePoint, Callable[[], object]] | None = None

    def save(self, filename: str, data: bytes) -> None:
        if self._fail_next_save:
            self._fail_next_save = False
            raise OSError("storage is down")
        interleaved, self._during_next_save = self._during_next_save, None
        if interleaved is not None and interleaved[0] is SavePoint.BEFORE_STORE:
            interleaved[1]()
        self.files[filename] = data
        if interleaved is not None and interleaved[0] is SavePoint.AFTER_STORE:
            interleaved[1]()

    def exists(self, filename: str) -> bool:
        self.reads.append(filename)
        return filename in self.files

    def load_once(self, filename: str) -> bytes:
        self.reads.append(filename)
        return self.files[filename]

    def load_stream(self, filename: str) -> Iterator[bytes]:
        """Yields the stored bytes one at a time, so a reader that joins them proves it consumed a stream."""
        self.reads.append(filename)
        content = self.files[filename]
        return (content[index : index + 1] for index in range(len(content)))

    def delete(self, filename: str) -> None:
        if self._fail_next_delete:
            self._fail_next_delete = False
            raise OSError("storage is down")
        del self.files[filename]

    def scan(self, path: str) -> list[str]:
        return [filename for filename in self.files if filename.startswith(path)]

    def fail_next_save(self) -> None:
        self._fail_next_save = True

    def fail_next_delete(self) -> None:
        self._fail_next_delete = True

    def during_next_save(self, point: SavePoint, action: Callable[[], object]) -> None:
        self._during_next_save = (point, action)

    def clear(self) -> None:
        self.files.clear()
