"""The file transfer service: prepare, receive, park, load, download, purge, sweep, and a slot counter."""

from __future__ import annotations

import hashlib
import hmac
import posixpath
import threading
from collections.abc import Callable, Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta
from functools import partial
from typing import Final

from libs.archive_reader import is_zip, read_archive
from libs.archive_writer import ArchiveError, ArchiveLimitKind, ArchiveLimits, ArchiveTooLargeError
from services.file_transfer.contracts import (
    IncomingFile,
    LoadedTransfer,
    PurgeResult,
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
    TransferRequestTooLargeError,
    TransferShapeError,
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

    Invariant: no stored bytes outlive their row. A row is written before its bytes. Dropping a transfer ends
    it, then deletes its bytes, then its row; storing bytes is followed by a check that the transfer is still
    live, and the writer deletes the bytes when it is not. Whichever of a drop and a store runs first, one of
    them deletes the bytes; a drop that fails part way leaves an ended row for ``purge_expired``.
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
        bytes raise ``TransferAlreadyReceivedError``. A failed store leaves the transfer empty. A transfer
        dropped while its bytes were stored raises ``TransferNotFoundError`` and keeps no bytes.
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
        self._confirm_stored(transfer_id)
        return replace(transfer, file=stored)

    def park(self, owner_id: str, *, name: str, mime_type: str, content: bytes) -> TransferTicket:
        """Postcondition: an outgoing transfer of the owner holding the file, and the token its download
        link needs. A failed store leaves no transfer. A transfer dropped while its bytes were stored raises
        ``TransferNotFoundError`` and keeps no bytes.
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
        self._confirm_stored(transfer.id)
        return TransferTicket(
            transfer=transfer, token=token, link_expires_at=_link_end(transfer, self._limits.download_link_life)
        )

    def load(self, owner_id: str, transfer_id: str, *, may_hold: int, folder: bool) -> LoadedTransfer:
        """Load one transfer of a request, within the bytes that request may still hold.

        Precondition: ``may_hold`` is what the request may still hold: ``limits.max_bytes`` less the
        ``held_bytes`` of every transfer it loaded before, the same id counted each time it was loaded; ``folder``
        says whether the caller asks for a folder or for one file.
        Postcondition: the files of the owner's transfer, in either direction: one for a file, the zip's members
        for a folder, unpacked within the limits; together they hold at most ``may_hold`` bytes. A transfer of the
        other shape is refused before any storage read, as is a file whose stored size is too large; a folder is
        unpacked only up to the smaller of ``limits.max_unpacked_bytes`` and ``may_hold``.

        Raises ``TransferNotFoundError``, ``TransferShapeError``, ``TransferNotReceivedError``,
        ``TransferArchiveError``, or ``TransferRequestTooLargeError`` when this transfer would take the request
        past ``may_hold``.
        """
        transfer = self._transfers.find(owner_id=owner_id, transfer_id=transfer_id, now=self._now())
        if transfer is None:
            raise TransferNotFoundError(transfer_id)
        if transfer.folder != folder:
            raise TransferShapeError(transfer_id, folder=transfer.folder)
        file = transfer.file
        if file is None:
            raise TransferNotReceivedError(
                transfer_id, upload_before=_link_end(transfer, self._limits.upload_link_life)
            )
        if transfer.folder:
            content = self._stored_bytes(transfer_id)
            return LoadedTransfer(transfer=transfer, files=self._unpacked(content, may_hold=may_hold))
        if file.size > may_hold:
            raise TransferRequestTooLargeError(limit=self._limits.max_bytes)
        content = self._stored_bytes(transfer_id)
        only = TransferFile(path=file.name, name=file.name, mime_type=file.mime_type, content=content)
        return LoadedTransfer(transfer=transfer, files=(only,))

    def open_for_download(self, transfer_id: str, token: str) -> Transfer:
        """Postcondition: the outgoing transfer the token opens, while its download link works. Reads no bytes.

        Raises ``TransferNotFoundError`` or ``TransferLinkExpiredError``.
        """
        return self._opened(transfer_id, token, TransferDirection.OUT, self._limits.download_link_life)

    def download(self, transfer_id: str, token: str) -> tuple[Transfer, Iterator[bytes]]:
        """Postcondition: the outgoing transfer the token opens and its bytes as chunks read from storage while
        they are consumed, while its download link works; the bytes exist when this returns.

        Raises ``TransferNotFoundError`` or ``TransferLinkExpiredError``.
        """
        transfer = self.open_for_download(transfer_id, token)
        key = self._existing_key(transfer_id)
        return transfer, self._blobs.load_stream(key)

    def purge_expired(self, *, limit: int, workers: int) -> PurgeResult:
        """Postcondition: up to ``limit`` expired transfers, oldest first, are gone with their bytes; up to
        ``workers`` byte deletions run at once. A failure leaves the rest for the next purge.
        """
        now = self._now()
        expired = self._transfers.expired(now=now, limit=limit)
        self._delete(expired, delete_bytes=partial(self._delete_bytes_at_once, workers=workers))
        overdue = (now - transfer.expires_at for transfer in expired)
        return PurgeResult(removed=len(expired), longest_overdue=max(overdue, default=timedelta(0)))

    def sweep_orphans(self, *, workers: int) -> int:
        """Delete stored bytes whose transfer has no row; returns how many were deleted.

        Precondition: the storage prefix belongs to this module alone. Postcondition: every key under it that
        names no row is gone; up to ``workers`` deletions run at once. Safe beside live transfers, because a row
        is written before its bytes: bytes with no row belong to a transfer that was dropped.
        """
        stored = [key.removeprefix(_STORAGE_PREFIX) for key in self._stored_keys()]
        known = self._transfers.known(transfer_ids=stored)
        orphans = [transfer_id for transfer_id in stored if transfer_id not in known]
        self._delete_bytes_at_once(orphans, workers=workers)
        return len(orphans)

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
        return self._blobs.load_once(self._existing_key(transfer_id))

    def _existing_key(self, transfer_id: str) -> str:
        """Postcondition: the storage key of the transfer's bytes, which exist; ``TransferNotFoundError`` when not."""
        key = _storage_key(transfer_id)
        # Storage backends raise different errors for a missing object, so ask first.
        if not self._blobs.exists(key):
            raise TransferNotFoundError(transfer_id)
        return key

    def _unpacked(self, content: bytes, *, may_hold: int) -> tuple[TransferFile, ...]:
        """Postcondition: the zip's members, unpacking stopped at the smaller of ``limits.max_unpacked_bytes`` and
        ``may_hold``. Raises ``TransferRequestTooLargeError`` when the request's bound stopped it, else
        ``TransferArchiveError``."""
        bound = min(self._limits.max_unpacked_bytes, may_hold)
        limits = ArchiveLimits(max_entries=self._limits.max_unpacked_files, max_bytes=bound)
        try:
            members = read_archive(content, limits)
        except ArchiveTooLargeError as error:
            if self._stopped_by_request(error, may_hold=may_hold):
                raise TransferRequestTooLargeError(limit=self._limits.max_bytes) from error
            raise TransferArchiveError(error) from error
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

    def _stopped_by_request(self, error: ArchiveTooLargeError, *, may_hold: int) -> bool:
        """Postcondition: True when unpacking passed its byte bound and that bound was what the request may still
        hold, not a smaller folder limit of its own."""
        if error.kind is not ArchiveLimitKind.BYTES:
            return False
        return may_hold <= self._limits.max_unpacked_bytes

    def _make_room(self, owner_id: str, now: datetime) -> None:
        """Postcondition: the owner holds fewer than ``limits.max_per_owner`` transfers, expired ones first gone."""
        owned = self._transfers.owned(owner_id=owner_id)
        doomed = [transfer for transfer in owned if transfer.expires_at <= now]
        live = [transfer for transfer in owned if transfer.expires_at > now]
        overflow = len(live) - self._limits.max_per_owner + 1
        doomed.extend(live[: max(overflow, 0)])
        self._delete(doomed, delete_bytes=self._delete_bytes_in_turn)

    def _confirm_stored(self, transfer_id: str) -> None:
        """Precondition: the transfer's bytes were just stored.

        Postcondition: returns while the transfer is live; otherwise its bytes are deleted and
        ``TransferNotFoundError`` is raised.
        """
        if self._transfers.get(transfer_id=transfer_id, now=self._now()) is not None:
            return
        self._delete_bytes(transfer_id)
        raise TransferNotFoundError(transfer_id)

    def _delete(self, transfers: Sequence[Transfer], *, delete_bytes: Callable[[Sequence[str]], None]) -> None:
        """Postcondition: the transfers are ended, then their bytes (through ``delete_bytes``) and their rows
        are gone; bytes already gone are fine. A failure part way leaves the rest of the ended rows to
        ``purge_expired``.
        """
        if not transfers:
            return
        transfer_ids = [transfer.id for transfer in transfers]
        self._transfers.expire(transfer_ids=transfer_ids, now=self._now())
        delete_bytes(transfer_ids)
        self._transfers.delete(transfer_ids=transfer_ids)

    def _delete_bytes_in_turn(self, transfer_ids: Sequence[str]) -> None:
        """Postcondition: no bytes are stored for the transfers; deleted one after another."""
        for transfer_id in transfer_ids:
            self._delete_bytes(transfer_id)

    def _delete_bytes_at_once(self, transfer_ids: Sequence[str], *, workers: int) -> None:
        """Postcondition: no bytes are stored for the transfers; up to ``workers`` deletions run at once, and
        the first failure is raised once the others have finished.
        """
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(self._delete_bytes, transfer_ids))

    def _stored_keys(self) -> list[str]:
        """Postcondition: every storage key under the module's prefix."""
        try:
            keys = self._blobs.scan(_STORAGE_PREFIX)
        except FileNotFoundError:
            # OpenDAL refuses to list a folder that does not exist yet: nothing was ever stored.
            return []
        return [key for key in keys if key.startswith(_STORAGE_PREFIX)]

    def _delete_bytes(self, transfer_id: str) -> None:
        """Postcondition: no bytes are stored for the transfer."""
        key = _storage_key(transfer_id)
        if self._blobs.exists(key):
            self._blobs.delete(key)
