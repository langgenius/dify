"""Read a zip into named members under limits, in memory. The reading side of ``archive_writer``.

Members come back with their paths as the zip stores them, except that a backslash is read as a separator:
Windows PowerShell 5.1's ``Compress-Archive`` writes ``scripts\\run.py``. No junk filter and no path rule here.
Callers apply ``entries_from_folder`` and a ``PathPolicy`` when they turn the members into a folder.
"""

from __future__ import annotations

import io
import zipfile
import zlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, override

from libs.archive_writer import ArchiveError, ArchiveLimitKind, ArchiveLimits, ArchiveTooLargeError
from libs.zip_filename_recovery import open_zip_with_replacement_names

_READ_CHUNK_SIZE: Final = 64 * 1024
_SEPARATOR: Final = "/"
_WINDOWS_SEPARATOR: Final = "\\"
_ENCRYPTED_FLAG: Final = 0x1
_READ_ERRORS: Final = (zipfile.BadZipFile, NotImplementedError, zlib.error, EOFError)


class ArchiveUnreadableReason(StrEnum):
    message: str

    NOT_A_ZIP = ("not_a_zip", "the file is not a zip archive")
    ENCRYPTED = ("encrypted", "a member is encrypted")
    DAMAGED = ("damaged", "a member cannot be read")

    def __new__(cls, value: str, message: str) -> ArchiveUnreadableReason:
        member = str.__new__(cls, value)
        member._value_ = value
        member.message = message
        return member


class ArchiveUnreadableError(ArchiveError):
    def __init__(self, reason: ArchiveUnreadableReason, *, path: str | None = None) -> None:
        self.reason = reason
        self.path = path
        super().__init__(str(self))

    @override
    def __str__(self) -> str:
        if self.path is None:
            return self.reason.message
        return f"{self.path}: {self.reason.message}"


@dataclass(frozen=True, slots=True)
class ArchiveMember:
    path: str
    content: bytes


def _path_of(info: zipfile.ZipInfo) -> str:
    return info.filename.replace(_WINDOWS_SEPARATOR, _SEPARATOR)


def is_zip(content: bytes) -> bool:
    return zipfile.is_zipfile(io.BytesIO(content))


def read_archive(content: bytes, limits: ArchiveLimits) -> list[ArchiveMember]:
    """Precondition: ``content`` is the whole archive.

    Postcondition: the file members in the zip's order, each path with ``/`` for every backslash; folder entries
    are skipped and do not count toward ``limits.max_entries``. Each member is read in pieces and reading stops
    as soon as the running total passes ``limits.max_bytes``, whatever the headers claim. Raises
    ``ArchiveTooLargeError`` past a limit and ``ArchiveUnreadableError`` for bytes that are not a zip, an
    encrypted member or a member that fails to read.
    """
    try:
        archive = open_zip_with_replacement_names(content)
    except zipfile.BadZipFile as error:
        raise ArchiveUnreadableError(ArchiveUnreadableReason.NOT_A_ZIP) from error
    with archive:
        files = [info for info in archive.infolist() if not _path_of(info).endswith(_SEPARATOR)]
        if len(files) > limits.max_entries:
            raise ArchiveTooLargeError(ArchiveLimitKind.ENTRIES, limits.max_entries)
        members: list[ArchiveMember] = []
        total = 0
        for info in files:
            if info.flag_bits & _ENCRYPTED_FLAG:
                raise ArchiveUnreadableError(ArchiveUnreadableReason.ENCRYPTED, path=_path_of(info))
            member, total = _read_member(archive, info, total=total, max_bytes=limits.max_bytes)
            members.append(member)
    return members


def _read_member(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo, *, total: int, max_bytes: int
) -> tuple[ArchiveMember, int]:
    """Postcondition: the member and the running total including it. Raises past ``max_bytes``."""
    content = bytearray()
    try:
        with archive.open(info) as stream:
            while chunk := stream.read(_READ_CHUNK_SIZE):
                total += len(chunk)
                if total > max_bytes:
                    raise ArchiveTooLargeError(ArchiveLimitKind.BYTES, max_bytes)
                content += chunk
    except _READ_ERRORS as error:
        raise ArchiveUnreadableError(ArchiveUnreadableReason.DAMAGED, path=_path_of(info)) from error
    return ArchiveMember(_path_of(info), bytes(content)), total
