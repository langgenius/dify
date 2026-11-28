import io
import struct
import zipfile

import pytest

from libs.archive_reader import (
    ArchiveMember,
    ArchiveUnreadableError,
    ArchiveUnreadableReason,
    is_zip,
    read_archive,
)
from libs.archive_writer import ArchiveLimitKind, ArchiveLimits, ArchiveTooLargeError
from tests.helpers.unit.libs.zip_builder import zip_bytes

_ROOMY = ArchiveLimits(max_entries=10, max_bytes=1000)
_UTF8_FLAG = 1 << 11
_ENCRYPTED_FLAG = 0x1
_FLAG_OFFSETS = ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8))


def _with_flags(content: bytes, *, set_bits: int = 0, clear_bits: int = 0) -> bytes:
    """Postcondition: the one-member zip with its general purpose flags changed in both headers."""
    patched = bytearray(content)
    for signature, flag_offset in _FLAG_OFFSETS:
        position = patched.index(signature) + flag_offset
        flags = struct.unpack_from("<H", patched, position)[0]
        struct.pack_into("<H", patched, position, (flags | set_bits) & ~clear_bits)
    return bytes(patched)


def test_members_come_back_with_their_paths_and_bytes() -> None:
    members = read_archive(zip_bytes({"SKILL.md": b"a", "scripts/run.py": b"bb"}), _ROOMY)

    assert members == [ArchiveMember("SKILL.md", b"a"), ArchiveMember("scripts/run.py", b"bb")]


def test_folder_entries_are_skipped_and_do_not_count() -> None:
    content = zip_bytes({"SKILL.md": b"a", "scripts/run.py": b"b"}, folders=["scripts/"])

    members = read_archive(content, ArchiveLimits(max_entries=2, max_bytes=10))

    assert [member.path for member in members] == ["SKILL.md", "scripts/run.py"]


def test_reading_stops_at_the_byte_limit_whatever_the_header_claims() -> None:
    bomb = zip_bytes({"big": b"\0" * 1_000_000})
    limits = ArchiveLimits(max_entries=10, max_bytes=2 * len(bomb))

    with pytest.raises(ArchiveTooLargeError) as error:
        read_archive(bomb, limits)

    assert (error.value.kind, error.value.limit) == (ArchiveLimitKind.BYTES, limits.max_bytes)


def test_the_byte_limit_counts_every_member_together() -> None:
    content = zip_bytes({"a": b"x" * 6, "b": b"y" * 6})

    with pytest.raises(ArchiveTooLargeError):
        read_archive(content, ArchiveLimits(max_entries=10, max_bytes=10))


def test_a_folder_exactly_at_the_limits_passes() -> None:
    content = zip_bytes({"a": b"x" * 5, "b": b"y" * 5})

    assert len(read_archive(content, ArchiveLimits(max_entries=2, max_bytes=10))) == 2


def test_one_file_more_than_the_limit_is_refused() -> None:
    content = zip_bytes({"a": b"", "b": b"", "c": b""})

    with pytest.raises(ArchiveTooLargeError) as error:
        read_archive(content, ArchiveLimits(max_entries=2, max_bytes=10))

    assert (error.value.kind, error.value.limit) == (ArchiveLimitKind.ENTRIES, 2)


def test_an_encrypted_member_is_unreadable() -> None:
    encrypted = _with_flags(zip_bytes({"secret.txt": b"x"}), set_bits=_ENCRYPTED_FLAG)

    with pytest.raises(ArchiveUnreadableError) as error:
        read_archive(encrypted, _ROOMY)

    assert (error.value.reason, error.value.path) == (ArchiveUnreadableReason.ENCRYPTED, "secret.txt")


def test_a_damaged_member_is_unreadable() -> None:
    payload = b"hello world " * 10
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("a.txt", payload)
    content = output.getvalue()
    position = content.index(payload)
    damaged = content[:position] + b"H" + content[position + 1 :]

    with pytest.raises(ArchiveUnreadableError) as error:
        read_archive(damaged, _ROOMY)

    assert (error.value.reason, error.value.path) == (ArchiveUnreadableReason.DAMAGED, "a.txt")


def test_bytes_that_are_not_a_zip_are_unreadable_and_is_zip_says_false() -> None:
    assert not is_zip(b"%PDF-1.7")
    assert is_zip(zip_bytes({"a": b"a"}))

    with pytest.raises(ArchiveUnreadableError) as error:
        read_archive(b"%PDF-1.7", _ROOMY)

    assert error.value.reason is ArchiveUnreadableReason.NOT_A_ZIP


def test_a_zero_byte_member_and_a_nested_zip_are_plain_members() -> None:
    inner = zip_bytes({"inner.txt": b"i"})

    members = read_archive(zip_bytes({"empty.txt": b"", "inner.zip": inner}), _ROOMY)

    assert members == [ArchiveMember("empty.txt", b""), ArchiveMember("inner.zip", inner)]


@pytest.mark.parametrize("path", ["../x", "/abs", "é.md", "a b/中文.md"])
def test_paths_are_returned_as_stored(path: str) -> None:
    assert read_archive(zip_bytes({path: b"x"}), _ROOMY) == [ArchiveMember(path, b"x")]


def test_a_backslash_in_a_path_is_read_as_a_separator() -> None:
    """Windows PowerShell 5.1's Compress-Archive writes its paths, folder entries included, with backslashes."""
    content = zip_bytes({"SKILL.md": b"a", "scripts\\run.py": b"b"}, folders=["scripts\\"])

    members = read_archive(content, ArchiveLimits(max_entries=2, max_bytes=10))

    assert members == [ArchiveMember("SKILL.md", b"a"), ArchiveMember("scripts/run.py", b"b")]


def test_an_empty_zip_gives_no_members() -> None:
    assert read_archive(zip_bytes({}), _ROOMY) == []
