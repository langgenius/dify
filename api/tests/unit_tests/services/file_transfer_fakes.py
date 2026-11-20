"""In-memory fakes shared by the file transfer tests."""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
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

    def delete(self, *, transfer_ids: Sequence[str]) -> None:
        for transfer_id in transfer_ids:
            self.rows.pop(transfer_id, None)
            self.digests.pop(transfer_id, None)


@dataclass
class InMemoryBlobs:
    """Implements TransferBlobs; ``fail_next_save`` makes the next save raise OSError."""

    files: dict[str, bytes] = field(default_factory=dict)
    _fail_next_save: bool = False

    def save(self, filename: str, data: bytes) -> None:
        if self._fail_next_save:
            self._fail_next_save = False
            raise OSError("storage is down")
        self.files[filename] = data

    def exists(self, filename: str) -> bool:
        return filename in self.files

    def load_once(self, filename: str) -> bytes:
        return self.files[filename]

    def delete(self, filename: str) -> None:
        del self.files[filename]

    def fail_next_save(self) -> None:
        self._fail_next_save = True

    def clear(self) -> None:
        self.files.clear()
