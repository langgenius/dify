"""The file transfer service: prepare, receive, park, load, download, purge, and a slot counter."""

from __future__ import annotations

import hashlib
import hmac
import posixpath
import threading
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Final

from libs.archive_reader import is_zip, read_archive
from libs.archive_writer import ArchiveError, ArchiveLimits
from services.file_transfer.contracts import (
    IncomingFile,
    LoadedTransfer,
    StoredFile,
    Transfer,
    TransferAlreadyReceivedError,
    TransferArchiveError,
    TransferBlobs,
    TransferDirection,
    TransferFile,
    TransferLimits,
    TransferLinkExpiredError,
    TransferNotAZipError,
    TransferNotFoundError,
    TransferNotReceivedError,
    TransferRepository,
    TransferTicket,
    TransferTooLargeError,
)

_STORAGE_PREFIX: Final = "file_transfers/"
_FOLDER_MEMBER_MIME_TYPE: Final = "application/octet-stream"


def _storage_key(transfer_id: str) -> str:
    return f"{_STORAGE_PREFIX}{transfer_id}"


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _link_end(transfer: Transfer, life: timedelta) -> datetime:
    """Postcondition: when the transfer's link stops working; never after the transfer itself expires."""
    return min(transfer.created_at + life, transfer.expires_at)


class FileTransferService:
    """Parks one file per transfer for its owner, for a short time.

    Precondition: built once per process. ``now`` returns the time the repository compares expiry against;
    ``new_token`` returns an unguessable string.
    Postcondition: an owner holds at most ``limits.max_per_owner`` live transfers, and at most
    ``limits.max_active`` slots are taken at once in this process.
    """

    def __init__(
        self,
        *,
        transfers: TransferRepository,
        blobs: TransferBlobs,
        limits: TransferLimits,
        now: Callable[[], datetime],
        new_token: Callable[[], str],
    ) -> None:
        self._transfers = transfers
        self._blobs = blobs
        self._limits = limits
        self._now = now
        self._new_token = new_token
        self._slots = threading.BoundedSemaphore(limits.max_active)

    @property
    def limits(self) -> TransferLimits:
        return self._limits

    def prepare(self, owner_id: str, *, folder: bool) -> TransferTicket:
        """Postcondition: an empty incoming transfer of the owner, and the token its upload link needs.

        ``folder`` says the file to come is a zip of a folder's contents.
        """
        now = self._now()
        self._make_room(owner_id, now)
        token = self._new_token()
        transfer = self._transfers.create(
            owner_id=owner_id,
            token_digest=_digest(token),
            direction=TransferDirection.IN,
            folder=folder,
            file=None,
            now=now,
            expires_at=now + self._limits.ttl,
        )
        return TransferTicket(
            transfer=transfer, token=token, link_expires_at=_link_end(transfer, self._limits.upload_link_life)
        )

    def open_for_upload(self, transfer_id: str, token: str) -> Transfer:
        """Postcondition: the incoming transfer the token opens, while its upload link works. Reads no bytes.

        Raises ``TransferNotFoundError`` or ``TransferLinkExpiredError``.
        """
        return self._opened(transfer_id, token, TransferDirection.IN, self._limits.upload_link_life)

    def receive(self, transfer_id: str, token: str, file: IncomingFile) -> Transfer:
        """Record and store the file of an incoming transfer. First write wins.

        Postcondition: the transfer holds this file. The same bytes again return the transfer; different
        bytes raise ``TransferAlreadyReceivedError``. A failed store leaves the transfer empty.
        """
        transfer = self.open_for_upload(transfer_id, token)
        self._check_size(file.content)
        if transfer.folder and not is_zip(file.content):
            raise TransferNotAZipError()
        stored = StoredFile(
            name=file.name,
            mime_type=file.mime_type,
            size=len(file.content),
            sha256=hashlib.sha256(file.content).hexdigest(),
            received_at=self._now(),
        )
        if not self._transfers.claim(transfer_id=transfer_id, file=stored):
            return self._already_received(transfer_id, stored)
        try:
            self._blobs.save(_storage_key(transfer_id), file.content)
        except Exception:
            self._transfers.release(transfer_id=transfer_id)
            raise
        return replace(transfer, file=stored)

    def park(self, owner_id: str, *, name: str, mime_type: str, content: bytes) -> TransferTicket:
        """Postcondition: an outgoing transfer of the owner holding the file, and the token its download
        link needs. A failed store leaves no transfer.
        """
        self._check_size(content)
        now = self._now()
        self._make_room(owner_id, now)
        token = self._new_token()
        transfer = self._transfers.create(
            owner_id=owner_id,
            token_digest=_digest(token),
            direction=TransferDirection.OUT,
            folder=False,
            file=StoredFile(
                name=name,
                mime_type=mime_type,
                size=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
                received_at=now,
            ),
            now=now,
            expires_at=now + self._limits.ttl,
        )
        try:
            self._blobs.save(_storage_key(transfer.id), content)
        except Exception:
            self._transfers.delete(transfer_ids=[transfer.id])
            raise
        return TransferTicket(
            transfer=transfer, token=token, link_expires_at=_link_end(transfer, self._limits.download_link_life)
        )

    def load(self, owner_id: str, transfer_id: str) -> LoadedTransfer:
        """Postcondition: the files of the owner's transfer, in either direction: one for a file, the zip's
        members for a folder, unpacked within the limits.

        Raises ``TransferNotFoundError``, ``TransferNotReceivedError`` or ``TransferArchiveError``.
        """
        transfer = self._transfers.find(owner_id=owner_id, transfer_id=transfer_id, now=self._now())
        if transfer is None:
            raise TransferNotFoundError(transfer_id)
        file = transfer.file
        if file is None:
            raise TransferNotReceivedError(
                transfer_id, upload_before=_link_end(transfer, self._limits.upload_link_life)
            )
        content = self._stored_bytes(transfer_id)
        if transfer.folder:
            return LoadedTransfer(transfer=transfer, files=self._unpacked(content))
        only = TransferFile(path=file.name, name=file.name, mime_type=file.mime_type, content=content)
        return LoadedTransfer(transfer=transfer, files=(only,))

    def open_for_download(self, transfer_id: str, token: str) -> Transfer:
        """Postcondition: the outgoing transfer the token opens, while its download link works. Reads no bytes.

        Raises ``TransferNotFoundError`` or ``TransferLinkExpiredError``.
        """
        return self._opened(transfer_id, token, TransferDirection.OUT, self._limits.download_link_life)

    def download(self, transfer_id: str, token: str) -> tuple[Transfer, bytes]:
        """Postcondition: the outgoing transfer the token opens and its bytes, while its download link works.

        Raises ``TransferNotFoundError`` or ``TransferLinkExpiredError``.
        """
        transfer = self.open_for_download(transfer_id, token)
        return transfer, self._stored_bytes(transfer_id)

    def purge_expired(self, *, limit: int) -> int:
        """Postcondition: up to ``limit`` expired transfers, oldest first, are gone with their bytes.
        Returns how many were removed.
        """
        expired = self._transfers.expired(now=self._now(), limit=limit)
        self._delete(expired)
        return len(expired)

    def take_slot(self) -> bool:
        """Postcondition: True when this caller now holds one of ``limits.max_active`` slots."""
        return self._slots.acquire(blocking=False)

    def free_slot(self) -> None:
        """Precondition: the caller holds a slot. Postcondition: it is free again."""
        self._slots.release()

    def _opened(self, transfer_id: str, token: str, direction: TransferDirection, life: timedelta) -> Transfer:
        now = self._now()
        digest = self._transfers.token_digest(transfer_id=transfer_id, now=now)
        if digest is None:
            raise TransferNotFoundError(transfer_id)
        if not hmac.compare_digest(digest, _digest(token)):
            raise TransferNotFoundError(transfer_id)
        transfer = self._transfers.get(transfer_id=transfer_id, now=now)
        if transfer is None:
            raise TransferNotFoundError(transfer_id)
        if transfer.direction is not direction:
            raise TransferNotFoundError(transfer_id)
        if now >= _link_end(transfer, life):
            raise TransferLinkExpiredError(transfer_id, direction=direction)
        return transfer

    def _already_received(self, transfer_id: str, stored: StoredFile) -> Transfer:
        current = self._transfers.get(transfer_id=transfer_id, now=self._now())
        if current is None:
            raise TransferNotFoundError(transfer_id)
        if current.file is None:
            raise TransferNotFoundError(transfer_id)
        if current.file.sha256 != stored.sha256:
            raise TransferAlreadyReceivedError(transfer_id)
        return current

    def _check_size(self, content: bytes) -> None:
        if len(content) > self._limits.max_bytes:
            raise TransferTooLargeError(limit=self._limits.max_bytes)

    def _stored_bytes(self, transfer_id: str) -> bytes:
        key = _storage_key(transfer_id)
        # Storage backends raise different errors for a missing object, so ask first.
        if not self._blobs.exists(key):
            raise TransferNotFoundError(transfer_id)
        return self._blobs.load_once(key)

    def _unpacked(self, content: bytes) -> tuple[TransferFile, ...]:
        limits = ArchiveLimits(max_entries=self._limits.max_unpacked_files, max_bytes=self._limits.max_unpacked_bytes)
        try:
            members = read_archive(content, limits)
        except ArchiveError as error:
            raise TransferArchiveError(error) from error
        return tuple(
            TransferFile(
                path=member.path,
                name=posixpath.basename(member.path),
                mime_type=_FOLDER_MEMBER_MIME_TYPE,
                content=member.content,
            )
            for member in members
        )

    def _make_room(self, owner_id: str, now: datetime) -> None:
        """Postcondition: the owner holds fewer than ``limits.max_per_owner`` transfers, expired ones first gone."""
        owned = self._transfers.owned(owner_id=owner_id)
        doomed = [transfer for transfer in owned if transfer.expires_at <= now]
        live = [transfer for transfer in owned if transfer.expires_at > now]
        overflow = len(live) - self._limits.max_per_owner + 1
        doomed.extend(live[: max(overflow, 0)])
        self._delete(doomed)

    def _delete(self, transfers: Sequence[Transfer]) -> None:
        """Postcondition: the transfers' bytes, then their rows, are gone; bytes already gone are fine."""
        if not transfers:
            return
        for transfer in transfers:
            key = _storage_key(transfer.id)
            if self._blobs.exists(key):
                self._blobs.delete(key)
        self._transfers.delete(transfer_ids=[transfer.id for transfer in transfers])
