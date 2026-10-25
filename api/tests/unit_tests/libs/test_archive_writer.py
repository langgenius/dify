import hashlib
import io
from collections.abc import Sequence
from contextlib import closing

import pytest

from libs.archive_writer import (
    ArchiveEmptyError,
    ArchiveEntry,
    ArchiveLimits,
    ArchiveOptions,
    ArchiveTooLargeError,
    chunks_of,
    write_archive,
)


class _Admit:
    def admit(self, entries: Sequence[ArchiveEntry]) -> Sequence[ArchiveEntry]:
        return entries


def _entry(path: str, data: bytes = b"") -> ArchiveEntry:
    return ArchiveEntry(path, chunks_of(io.BytesIO(data)))


def _options(max_entries: int = 10, max_bytes: int = 1_000_000) -> ArchiveOptions:
    return ArchiveOptions(_Admit(), ArchiveLimits(max_entries, max_bytes))


def test_entries_are_sorted_hashed_and_written_deterministically() -> None:
    first = write_archive([_entry("b", b"bb"), _entry("a")], _options())
    second = write_archive([_entry("a"), _entry("b", b"bb")], _options())
    assert [(e.path, e.size, e.sha256) for e in first.entries] == [
        ("a", 0, hashlib.sha256(b"").hexdigest()),
        ("b", 2, hashlib.sha256(b"bb").hexdigest()),
    ]
    with closing(first.file), closing(second.file):
        assert first.file.read() == second.file.read()


def test_empty_and_oversized_archives_are_rejected() -> None:
    with pytest.raises(ArchiveEmptyError):
        write_archive([], _options())
    with pytest.raises(ArchiveTooLargeError):
        write_archive([_entry("a"), _entry("b")], _options(max_entries=1))
    with pytest.raises(ArchiveTooLargeError):
        write_archive([_entry("a", b"x" * 200)], _options(max_bytes=100))
