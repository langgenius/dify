from __future__ import annotations

import hashlib
import stat
import tempfile
import time
import unicodedata
import zipfile
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import BinaryIO, Final, Protocol, cast, override

_COPY_CHUNK_SIZE = 1024 * 1024
_SPOOL_MAX_MEMORY = 16 * 1024 * 1024
_FILE_MODE = stat.S_IFREG | 0o644
_EXTERNAL_ATTR_SHIFT = 16
_PATH_SEPARATOR = "/"
_BACKSLASH = "\\"
_FIRST_PRINTABLE_ORDINAL = 0x20
_UNSAFE_SEGMENTS = frozenset({"", ".", ".."})

OS_JUNK_FILE_NAMES: Final[frozenset[str]] = frozenset({".DS_Store", "Thumbs.db", "desktop.ini"})
OS_JUNK_DIR_NAMES: Final[frozenset[str]] = frozenset({"__MACOSX"})


class ArchiveCompression(StrEnum):
    zip_method: int

    STORED = ("stored", zipfile.ZIP_STORED)
    DEFLATED = ("deflated", zipfile.ZIP_DEFLATED)

    def __new__(cls, value: str, zip_method: int) -> ArchiveCompression:
        member = str.__new__(cls, value)
        member._value_ = value
        member.zip_method = zip_method
        return member


class ArchiveLimitKind(StrEnum):
    ENTRIES = "entries"
    BYTES = "bytes"


class ArchivePathReason(StrEnum):
    message: str

    EMPTY = ("empty", "path is empty")
    ABSOLUTE = ("absolute", "path must be relative")
    UNSAFE_CHARACTER = ("unsafe_character", "path contains a backslash or control character")
    UNSAFE_SEGMENT = ("unsafe_segment", "path has an empty, '.' or '..' segment")
    CASE_CLASH = ("case_clash", "path differs from another only by case or Unicode form")

    def __new__(cls, value: str, message: str) -> ArchivePathReason:
        member = str.__new__(cls, value)
        member._value_ = value
        member.message = message
        return member


class ArchiveError(Exception):
    pass


class ArchivePathError(ArchiveError):
    def __init__(self, path: str, reason: ArchivePathReason, *, other: str | None = None) -> None:
        self.path = path
        self.reason = reason
        self.other = other
        super().__init__(str(self))

    @override
    def __str__(self) -> str:
        text = f"{self.path}: {self.reason.message}"
        if self.other is not None:
            text += f" (clashes with {self.other})"
        return text


class ArchiveEmptyError(ArchiveError):
    def __init__(self) -> None:
        super().__init__("archive has no entries")


class ArchiveTooLargeError(ArchiveError):
    def __init__(self, kind: ArchiveLimitKind, limit: int) -> None:
        self.kind = kind
        self.limit = limit
        super().__init__(f"archive is over the limit of {limit} {kind.value}")


ChunkSource = Callable[[], Iterable[bytes]]


@dataclass(frozen=True)
class ArchiveEntry:
    path: str
    open: ChunkSource


class PathPolicy(Protocol):
    def admit(self, entries: Sequence[ArchiveEntry]) -> Sequence[ArchiveEntry]: ...


class StrictPathPolicy:
    def admit(self, entries: Sequence[ArchiveEntry]) -> Sequence[ArchiveEntry]:
        seen: dict[str, str] = {}
        admitted: list[ArchiveEntry] = []
        for entry in entries:
            path = unicodedata.normalize("NFC", entry.path)
            reason = self._violation(path)
            if reason is not None:
                raise ArchivePathError(entry.path, reason)
            key = path.casefold()
            if key in seen:
                raise ArchivePathError(entry.path, ArchivePathReason.CASE_CLASH, other=seen[key])
            seen[key] = entry.path
            admitted.append(ArchiveEntry(path, entry.open))
        return admitted

    @staticmethod
    def _violation(path: str) -> ArchivePathReason | None:
        if not path:
            return ArchivePathReason.EMPTY
        if path.startswith(_PATH_SEPARATOR):
            return ArchivePathReason.ABSOLUTE
        for char in path:
            if char == _BACKSLASH:
                return ArchivePathReason.UNSAFE_CHARACTER
            if ord(char) < _FIRST_PRINTABLE_ORDINAL:
                return ArchivePathReason.UNSAFE_CHARACTER
        if not _UNSAFE_SEGMENTS.isdisjoint(path.split(_PATH_SEPARATOR)):
            return ArchivePathReason.UNSAFE_SEGMENT
        return None


@dataclass(frozen=True)
class ArchiveLimits:
    max_entries: int
    max_bytes: int


@dataclass(frozen=True)
class ArchiveOptions:
    path_policy: PathPolicy
    limits: ArchiveLimits
    compression: ArchiveCompression = ArchiveCompression.STORED


@dataclass(frozen=True)
class WrittenEntry:
    path: str
    size: int
    sha256: str


@dataclass
class ArchiveResult:
    file: BinaryIO
    entries: list[WrittenEntry]


def chunks_of(stream: BinaryIO) -> ChunkSource:
    def read_chunks() -> Iterable[bytes]:
        while chunk := stream.read(_COPY_CHUNK_SIZE):
            yield chunk

    return read_chunks


def is_os_junk(path: str) -> bool:
    segments = path.split(_PATH_SEPARATOR)
    if segments[-1] in OS_JUNK_FILE_NAMES:
        return True
    return not OS_JUNK_DIR_NAMES.isdisjoint(segments)


def entries_from_folder(parts: Mapping[str, BinaryIO]) -> list[ArchiveEntry]:
    return [ArchiveEntry(path, chunks_of(stream)) for path, stream in parts.items() if not is_os_junk(path)]


def write_archive(entries: Iterable[ArchiveEntry], options: ArchiveOptions) -> ArchiveResult:
    items = list(entries)
    if not items:
        raise ArchiveEmptyError()
    limits = options.limits
    if len(items) > limits.max_entries:
        raise ArchiveTooLargeError(ArchiveLimitKind.ENTRIES, limits.max_entries)
    admitted = sorted(options.path_policy.admit(items), key=lambda entry: entry.path)

    spool = cast(BinaryIO, tempfile.SpooledTemporaryFile(max_size=_SPOOL_MAX_MEMORY, mode="w+b"))  # noqa: SIM115
    try:
        written = _write_entries(spool, admitted, options)
        spool.seek(0)
    except BaseException:
        spool.close()
        raise
    return ArchiveResult(file=spool, entries=written)


def _write_entries(spool: BinaryIO, entries: Sequence[ArchiveEntry], options: ArchiveOptions) -> list[WrittenEntry]:
    max_bytes = options.limits.max_bytes
    date_time = time.localtime()[:6]
    written: list[WrittenEntry] = []
    with zipfile.ZipFile(spool, "w", allowZip64=True) as archive:
        for entry in entries:
            info = zipfile.ZipInfo(entry.path, date_time=date_time)
            info.compress_type = options.compression.zip_method
            info.external_attr = _FILE_MODE << _EXTERNAL_ATTR_SHIFT
            digest = hashlib.sha256()
            size = 0
            with archive.open(info, "w", force_zip64=True) as target:
                for chunk in entry.open():
                    target.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                    if spool.tell() > max_bytes:
                        raise ArchiveTooLargeError(ArchiveLimitKind.BYTES, max_bytes)
            written.append(WrittenEntry(entry.path, size, digest.hexdigest()))
    if spool.tell() > max_bytes:
        raise ArchiveTooLargeError(ArchiveLimitKind.BYTES, max_bytes)
    return written
