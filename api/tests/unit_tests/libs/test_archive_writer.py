import hashlib
import io
import time
import unicodedata
import zipfile

import pytest

from libs.archive_writer import (
    ArchiveCompression,
    ArchiveEmptyError,
    ArchiveEntry,
    ArchiveLimits,
    ArchiveOptions,
    ArchivePathError,
    ArchivePathReason,
    ArchiveTooLargeError,
    StrictPathPolicy,
    chunks_of,
    entries_from_folder,
    write_archive,
)

_NFD_CAFE = unicodedata.normalize("NFD", "café")
_NFC_CAFE = unicodedata.normalize("NFC", _NFD_CAFE)


def _entry(path: str, data: bytes = b"") -> ArchiveEntry:
    return ArchiveEntry(path, chunks_of(io.BytesIO(data)))


def _options(max_entries: int = 10, max_bytes: int = 1_000_000) -> ArchiveOptions:
    return ArchiveOptions(StrictPathPolicy(), ArchiveLimits(max_entries, max_bytes))


def test_entries_are_sorted_hashed_and_stamped_with_the_write_time(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(time, "localtime", lambda: time.struct_time((2026, 10, 28, 9, 30, 16, 0, 0, 0)))
    result = write_archive([_entry("b", b"bb"), _entry("a")], _options())
    assert [(e.path, e.size, e.sha256) for e in result.entries] == [
        ("a", 0, hashlib.sha256(b"").hexdigest()),
        ("b", 2, hashlib.sha256(b"bb").hexdigest()),
    ]
    with result.file, zipfile.ZipFile(result.file) as archive:
        infos = archive.infolist()
    assert {(info.date_time, info.external_attr >> 16) for info in infos} == {((2026, 10, 28, 9, 30, 16), 0o100644)}


def test_empty_and_oversized_archives_are_rejected() -> None:
    with pytest.raises(ArchiveEmptyError):
        write_archive([], _options())
    with pytest.raises(ArchiveTooLargeError):
        write_archive([_entry("a"), _entry("b")], _options(max_entries=1))
    with pytest.raises(ArchiveTooLargeError):
        write_archive([_entry("a", b"x" * 200)], _options(max_bytes=100))


def test_an_entry_that_inflates_past_zip64_limit_still_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(zipfile, "ZIP64_LIMIT", 2 * 1024 * 1024)
    data = bytes(3 * 1024 * 1024)
    options = ArchiveOptions(StrictPathPolicy(), ArchiveLimits(1, 100_000), ArchiveCompression.DEFLATED)
    result = write_archive([_entry("a", data)], options)
    with result.file, zipfile.ZipFile(result.file) as archive:
        assert archive.read("a") == data


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


def test_folder_source_drops_exact_junk_names_before_counting_and_normalizes() -> None:
    parts = {_NFD_CAFE: io.BytesIO(b"a"), "x.DS_Store": io.BytesIO(b""), "__MACOSX/a": io.BytesIO(b"")}
    result = write_archive(entries_from_folder(parts), _options(max_entries=2))
    with result.file:
        assert [entry.path for entry in result.entries] == [_NFC_CAFE, "x.DS_Store"]
    with pytest.raises(ArchiveEmptyError):
        write_archive(entries_from_folder({".DS_Store": io.BytesIO(b"")}), _options())
