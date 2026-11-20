"""Values, limits, ports and errors of the file transfer module."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Protocol

from libs.archive_writer import ArchiveError


class TransferDirection(StrEnum):
    """Which way the bytes move; link_name names the transfer's one link."""

    link_name: str

    IN = ("in", "upload")
    OUT = ("out", "download")

    def __new__(cls, value: str, link_name: str) -> TransferDirection:
        member = str.__new__(cls, value)
        member._value_ = value
        member.link_name = link_name
        return member


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
class LoadedTransfer:
    transfer: Transfer
    files: tuple[TransferFile, ...]


class TransferBlobs(Protocol):
    """Byte storage keyed by name. The storage extension satisfies it."""

    def save(self, filename: str, data: bytes) -> Any: ...
    def exists(self, filename: str) -> bool: ...
    def load_once(self, filename: str) -> bytes: ...
    def delete(self, filename: str) -> Any: ...


class TransferRepository(Protocol):
    """Transfer rows. Each call owns its session and returns records.

    Owner scope: ``find`` and ``owned`` filter by owner. ``get``, ``token_digest``, ``claim`` and ``release``
    work by id alone, for callers that prove the right to a transfer with its token.
    Expiry: ``find``, ``get`` and ``token_digest`` see only transfers whose ``expires_at`` is after ``now``.
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
        self.transfer_id = transfer_id
        self.direction = direction
        super().__init__(f"The {direction.link_name} link of transfer {transfer_id} has expired.")


class TransferAlreadyReceivedError(FileTransferError):
    def __init__(self, transfer_id: str) -> None:
        self.transfer_id = transfer_id
        super().__init__(f"Transfer {transfer_id} already holds a different file.")


class TransferTooLargeError(FileTransferError):
    def __init__(self, *, limit: int) -> None:
        self.limit = limit
        super().__init__(f"The file is larger than the limit of {limit} bytes.")


class TransferTextTooLongError(FileTransferError):
    def __init__(self, text: StoredText, *, limit: int) -> None:
        self.text = text
        self.limit = limit
        super().__init__(f"The {text.label} is longer than {limit} characters.")


class TransferNotAZipError(FileTransferError):
    def __init__(self) -> None:
        super().__init__("A folder transfer must be a zip of the folder's contents.")


class TransferArchiveError(FileTransferError):
    def __init__(self, archive_error: ArchiveError) -> None:
        self.archive_error = archive_error
        super().__init__(f"The folder's zip cannot be unpacked: {archive_error}.")
