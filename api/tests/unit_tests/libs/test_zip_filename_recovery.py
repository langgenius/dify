import io
import struct
import zipfile

import pytest

from libs.zip_filename_recovery import open_zip_with_replacement_names


def _zip64(monkeypatch: pytest.MonkeyPatch, limit: int) -> bytes:
    output = io.BytesIO()
    with monkeypatch.context() as scoped:
        scoped.setattr(zipfile, "ZIP64_LIMIT", limit)
        with zipfile.ZipFile(output, "w", allowZip64=True) as archive:
            archive.writestr("padding.txt", b"p" * 200)
            archive.writestr("scripts/\u00e9.py", b"print('ok')\n")
    content = output.getvalue()
    assert len(content) < 2048
    assert b"PK\x06\x06" in content
    return content


@pytest.mark.parametrize("limit", [0, 100])
@pytest.mark.parametrize("prefix", [b"", b"self-extracting-prefix"])
def test_zip64_replaces_names_and_preserves_payload(monkeypatch: pytest.MonkeyPatch, limit: int, prefix: bytes) -> None:
    original = prefix + _zip64(monkeypatch, limit)
    with zipfile.ZipFile(io.BytesIO(original)) as archive:
        assert archive.read("scripts/\u00e9.py") == b"print('ok')\n"
    damaged = original.replace(b"\xc3\xa9.py", b"\xffa.py")
    with open_zip_with_replacement_names(damaged) as archive:
        assert archive.read("scripts/\ufffda.py") == b"print('ok')\n"
        assert archive.testzip() is None


def test_zip64_uses_extended_values_when_legacy_fields_are_sentinels(monkeypatch: pytest.MonkeyPatch) -> None:
    content = bytearray(_zip64(monkeypatch, 0))
    end = content.rfind(b"PK\x05\x06")
    struct.pack_into("<HHII", content, end + 8, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF)
    damaged = bytes(content).replace(b"\xc3\xa9.py", b"\xffa.py")
    with open_zip_with_replacement_names(damaged) as archive:
        assert archive.read("scripts/\ufffda.py") == b"print('ok')\n"


def test_zip64_extensible_data_is_not_part_of_central_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    content = bytearray(_zip64(monkeypatch, 0))
    record = content.rfind(b"PK\x06\x06")
    locator = content.rfind(b"PK\x06\x07")
    extension = b"extension"
    struct.pack_into("<Q", content, record + 4, 44 + len(extension))
    content[locator:locator] = extension
    damaged = bytes(content).replace(b"\xc3\xa9.py", b"\xffa.py")
    with open_zip_with_replacement_names(damaged) as archive:
        assert archive.read("scripts/\ufffda.py") == b"print('ok')\n"


def test_zip64_recovery_preserves_crc_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    content = _zip64(monkeypatch, 0)
    damaged = content.replace(b"\xc3\xa9.py", b"\xffa.py").replace(b"print('ok')", b"print('NO')")
    with open_zip_with_replacement_names(damaged) as archive:
        with pytest.raises(zipfile.BadZipFile, match="CRC"):
            archive.read("scripts/\ufffda.py")


def test_zip64_recovery_rejects_mismatched_local_name(monkeypatch: pytest.MonkeyPatch) -> None:
    original = _zip64(monkeypatch, 0)
    directory = original.index(b"PK\x01\x02")
    damaged = original[:directory] + original[directory:].replace(b"\xc3\xa9.py", b"\xffa.py")
    with pytest.raises(zipfile.BadZipFile, match="names differ"):
        open_zip_with_replacement_names(damaged)


def _damaged_utf8_zip() -> bytearray:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("scripts/\u00e9.py", b"print('ok')\n")
    return bytearray(output.getvalue().replace(b"\xc3\xa9.py", b"\xffa.py"))


@pytest.mark.parametrize("offset", [0xFFFFFFFF, 0xFFFFFFFE])
def test_recovery_rejects_unresolvable_local_header_offsets(offset: int) -> None:
    content = _damaged_utf8_zip()
    directory = content.index(b"PK\x01\x02")
    struct.pack_into("<I", content, directory + 42, offset)
    with pytest.raises(zipfile.BadZipFile, match="ZIP64 extra field|local header offset"):
        open_zip_with_replacement_names(bytes(content))


@pytest.mark.parametrize("entries", [0, 2])
def test_recovery_rejects_inconsistent_directory_entry_counts(entries: int) -> None:
    content = _damaged_utf8_zip()
    end = content.rfind(b"PK\x05\x06")
    struct.pack_into("<HH", content, end + 8, entries, entries)
    with pytest.raises(zipfile.BadZipFile, match="directory bounds|directory length mismatch"):
        open_zip_with_replacement_names(bytes(content))
