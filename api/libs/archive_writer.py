from __future__ import annotations

import hashlib
import stat
import tempfile
import zipfile
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import BinaryIO, Protocol

_COPY_CHUNK_SIZE = 1024 * 1024
_SPOOL_MAX_MEMORY = 16 * 1024 * 1024
_FIXED_DATE_TIME = (1980, 1, 1, 0, 0, 0)
_FILE_MODE = stat.S_IFREG | 0o644
_EXTERNAL_ATTR_SHIFT = 16


class ArchiveCompression(StrEnum):
    STORED = "stored"
    DEFLATED = "deflated"

    @property
    def zip_method(self) -> int:
        if self is ArchiveCompression.DEFLATED:
            return zipfile.ZIP_DEFLATED
        return zipfile.ZIP_STORED


class ArchiveLimitKind(StrEnum):
    ENTRIES = "entries"
    BYTES = "bytes"

    @property
    def unit(self) -> str:
        return self.value


class ArchiveError(Exception):
    pass


class ArchiveEmptyError(ArchiveError):
    def __init__(self) -> None:
        super().__init__("archive has no entries")


class ArchiveTooLargeError(ArchiveError):
    def __init__(self, kind: ArchiveLimitKind, limit: int) -> None:
        self.kind = kind
        self.limit = limit
        super().__init__(f"archive is over the limit of {limit} {kind.unit}")


ChunkSource = Callable[[], Iterable[bytes]]


@dataclass(frozen=True)
class ArchiveEntry:
    path: str
    open: ChunkSource


class PathPolicy(Protocol):
    def admit(self, entries: Sequence[ArchiveEntry]) -> Sequence[ArchiveEntry]: ...


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


def write_archive(entries: Iterable[ArchiveEntry], options: ArchiveOptions) -> ArchiveResult:
    items = list(entries)
    if not items:
        raise ArchiveEmptyError()
    limits = options.limits
    if len(items) > limits.max_entries:
        raise ArchiveTooLargeError(ArchiveLimitKind.ENTRIES, limits.max_entries)
    admitted = sorted(options.path_policy.admit(items), key=lambda entry: entry.path)

    spool = tempfile.SpooledTemporaryFile(max_size=_SPOOL_MAX_MEMORY, mode="w+b")  # noqa: SIM115
    try:
        written = _write_entries(spool, admitted, options)
        spool.seek(0)
    except BaseException:
        spool.close()
        raise
    return ArchiveResult(file=spool, entries=written)


def _write_entries(spool: BinaryIO, entries: Sequence[ArchiveEntry], options: ArchiveOptions) -> list[WrittenEntry]:
    max_bytes = options.limits.max_bytes
    force_zip64 = max_bytes + _COPY_CHUNK_SIZE > zipfile.ZIP64_LIMIT
    written: list[WrittenEntry] = []
    with zipfile.ZipFile(spool, "w", allowZip64=True) as archive:
        for entry in entries:
            info = zipfile.ZipInfo(entry.path, date_time=_FIXED_DATE_TIME)
            info.compress_type = options.compression.zip_method
            info.external_attr = _FILE_MODE << _EXTERNAL_ATTR_SHIFT
            digest = hashlib.sha256()
            size = 0
            with archive.open(info, "w", force_zip64=force_zip64) as target:
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
