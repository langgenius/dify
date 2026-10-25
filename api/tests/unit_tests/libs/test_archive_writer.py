import hashlib
import io
import unicodedata
from contextlib import closing

import pytest

from libs.archive_writer import (
    ArchiveEmptyError,
    ArchiveEntry,
    ArchiveLimits,
    ArchiveOptions,
    ArchivePathError,
    ArchivePathReason,
    ArchiveTooLargeError,
    StrictPathPolicy,
    chunks_of,
    write_archive,
)

_NFD_CAFE = unicodedata.normalize("NFD", "café")
_NFC_CAFE = unicodedata.normalize("NFC", _NFD_CAFE)


def _entry(path: str, data: bytes = b"") -> ArchiveEntry:
    return ArchiveEntry(path, chunks_of(io.BytesIO(data)))


def _options(max_entries: int = 10, max_bytes: int = 1_000_000) -> ArchiveOptions:
    return ArchiveOptions(StrictPathPolicy(), ArchiveLimits(max_entries, max_bytes))


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


@pytest.mark.parametrize(
    ("paths", "reason"),
    [
        ([""], ArchivePathReason.EMPTY),
        (["/a"], ArchivePathReason.ABSOLUTE),
        (["a\\b"], ArchivePathReason.UNSAFE_CHARACTER),
        ([f"{_NFD_CAFE}/../x"], ArchivePathReason.UNSAFE_SEGMENT),
        (["A.md", "a.md"], ArchivePathReason.CASE_CLASH),
        ([_NFC_CAFE, _NFD_CAFE], ArchivePathReason.CASE_CLASH),
    ],
)
def test_strict_policy_names_the_rejected_path_as_spelled(paths: list[str], reason: ArchivePathReason) -> None:
    with pytest.raises(ArchivePathError) as exc:
        StrictPathPolicy().admit([_entry(path) for path in paths])
    assert (exc.value.path, exc.value.reason) == (paths[-1], reason)
