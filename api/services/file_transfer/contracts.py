"""Values, limits, ports and errors of the file transfer module."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Final, Protocol

from libs.archive_writer import ArchiveError


class TransferDirection(StrEnum):
    """Which way the bytes move."""

    IN = "in"
    OUT = "out"


class StoredText(StrEnum):
    """Text a transfer stores about its file; ``label`` names it for the caller."""

    label: str

    NAME = ("name", "file name")
    MIME_TYPE = ("mime_type", "MIME type")

    def __new__(cls, value: str, label: str) -> StoredText:
        member = str.__new__(cls, value)
        member._value_ = value
        member.label = label
        return member


# Fixed bounds a host passes in ``TransferLimits``; tests may pass others.
UPLOAD_LINK_LIFE: Final = timedelta(seconds=300)
DOWNLOAD_LINK_LIFE: Final = timedelta(seconds=300)
MAX_UNPACKED_FILES: Final = 1000
BUSY_RETRY_AFTER: Final = timedelta(seconds=5)


@dataclass(frozen=True, slots=True, kw_only=True)
class TransferLimits:
    """Every bound the module enforces. The module reads no configuration; its host fills this once."""

    ttl: timedelta
    upload_link_life: timedelta
    download_link_life: timedelta
    max_bytes: int
    max_unpacked_bytes: int
    max_unpacked_files: int
    max_per_owner: int
    max_active: int
    busy_retry_after: timedelta


@dataclass(frozen=True, slots=True, kw_only=True)
class StoredFile:
    name: str
    mime_type: str
    size: int
    sha256: str
    received_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class Transfer:
    """One file parked for a short time. ``file`` is None while a prepared transfer waits for its upload."""

    id: str
    owner_id: str
    direction: TransferDirection
    folder: bool
    file: StoredFile | None
    created_at: datetime
    expires_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class TransferTicket:
    """A new transfer and its token. The token is shown once; only its digest is stored."""

    transfer: Transfer
    token: str
    link_expires_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class IncomingFile:
    name: str
    mime_type: str
    content: bytes


@dataclass(frozen=True, slots=True, kw_only=True)
class TransferFile:
    """One file a transfer holds: for a folder, ``path`` is the member's path in the zip as stored."""

    path: str
    name: str
    mime_type: str
    content: bytes


@dataclass(frozen=True, slots=True, kw_only=True)
class PurgeResult:
    """What one purge removed. ``longest_overdue`` is how long the most overdue of them had been expired;
    zero when it removed nothing.
    """

    removed: int
    longest_overdue: timedelta


@dataclass(frozen=True, slots=True, kw_only=True)
class LoadedTransfer:
    transfer: Transfer
    files: tuple[TransferFile, ...]

    @property
    def held_bytes(self) -> int:
        """Postcondition: the bytes this load holds: the file's size, or the unpacked size of a folder."""
        return sum(len(file.content) for file in self.files)


class TransferBlobs(Protocol):
    """Byte storage keyed by name. The storage extension satisfies it."""

    def save(self, filename: str, data: bytes) -> Any: ...
    def exists(self, filename: str) -> bool: ...
    def load_once(self, filename: str) -> bytes: ...
    def load_stream(self, filename: str) -> Iterator[bytes]: ...
    def scan(self, path: str) -> list[str]: ...
    def delete(self, filename: str) -> Any: ...


class TransferRepository(Protocol):
    """Transfer rows. Each call owns its session and returns records.

    Owner scope: ``find`` and ``owned`` filter by owner. ``get``, ``token_digest``, ``claim`` and ``release``
    work by id alone, for callers that prove the right to a transfer with its token.
    Expiry: ``find``, ``get`` and ``token_digest`` see only transfers whose ``expires_at`` is after ``now``.
    ``expire`` ends live transfers at ``now`` and leaves ended ones as they are. ``known`` sees ended ones too.
    First write wins: ``claim`` is one conditional write that records the file only while none is recorded,
    so of two concurrent claims exactly one returns True.
    Stored text: ``create`` and ``claim`` refuse a file whose name or MIME type is longer than the table holds
    with ``TransferTextTooLongError``, before anything is written.
    """

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
    ) -> Transfer: ...
    def claim(self, *, transfer_id: str, file: StoredFile) -> bool: ...
    def release(self, *, transfer_id: str) -> None: ...
    def find(self, *, owner_id: str, transfer_id: str, now: datetime) -> Transfer | None: ...
    def get(self, *, transfer_id: str, now: datetime) -> Transfer | None: ...
    def token_digest(self, *, transfer_id: str, now: datetime) -> str | None: ...
    def owned(self, *, owner_id: str) -> Sequence[Transfer]: ...
    def expired(self, *, now: datetime, limit: int) -> Sequence[Transfer]: ...
    def expire(self, *, transfer_ids: Sequence[str], now: datetime) -> None: ...
    def known(self, *, transfer_ids: Sequence[str]) -> set[str]: ...
    def delete(self, *, transfer_ids: Sequence[str]) -> None: ...


class FileTransferError(Exception):
    """Base of the module's errors; ``description`` says what happened, for the caller."""

    def __init__(self, description: str) -> None:
        self.description = description
        super().__init__(description)


class TransferNotFoundError(FileTransferError):
    """Unknown, another owner's, expired, a wrong token, the wrong direction, or its bytes are gone.

    These cases are not told apart, on purpose.
    """

    def __init__(self, transfer_id: str) -> None:
        self.transfer_id = transfer_id
        super().__init__(f"No transfer {transfer_id}: it is unknown, expired, or was dropped to make room.")


class TransferNotReceivedError(FileTransferError):
    def __init__(self, transfer_id: str, *, upload_before: datetime) -> None:
        self.transfer_id = transfer_id
        self.upload_before = upload_before
        super().__init__(f"Transfer {transfer_id} was prepared but no file arrived.")


class TransferLinkExpiredError(FileTransferError):
    def __init__(self, transfer_id: str, *, direction: TransferDirection) -> None:
        self.direction = direction
        super().__init__(f"The link of transfer {transfer_id} has expired.")


class TransferAlreadyReceivedError(FileTransferError):
    def __init__(self, transfer_id: str) -> None:
        super().__init__(f"Transfer {transfer_id} already holds a different file.")


class TransferTooLargeError(FileTransferError):
    def __init__(self, *, limit: int) -> None:
        self.limit = limit
        super().__init__(f"The file is larger than the limit of {limit} bytes.")


class TransferRequestTooLargeError(FileTransferError):
    """The transfers one request loads would together hold more than ``limit`` bytes."""

    def __init__(self, *, limit: int) -> None:
        self.limit = limit
        super().__init__(f"The files of this request together are above the limit of {limit} bytes.")


class TransferTextTooLongError(FileTransferError):
    def __init__(self, text: StoredText, *, limit: int) -> None:
        self.text = text
        self.limit = limit
        super().__init__(f"The {text.label} is longer than {limit} characters.")


class TransferNotAZipError(FileTransferError):
    def __init__(self) -> None:
        super().__init__("A folder transfer must be a zip of the folder's contents.")


class TransferShapeError(FileTransferError):
    """The transfer is a folder where one file was asked for, or one file where a folder was; ``folder`` says
    which it is."""

    def __init__(self, transfer_id: str, *, folder: bool) -> None:
        self.transfer_id = transfer_id
        self.folder = folder
        super().__init__(f"Transfer {transfer_id} does not have the shape asked for.")


class TransferArchiveError(FileTransferError):
    def __init__(self, archive_error: ArchiveError) -> None:
        self.archive_error = archive_error
        super().__init__(f"The folder's zip cannot be unpacked: {archive_error}.")
