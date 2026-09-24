"""Read malformed UTF-8 ZIP names without weakening payload integrity checks."""

from __future__ import annotations

import io
import struct
import zipfile
from dataclasses import dataclass

_UTF8_FLAG = 1 << 11
_END_RECORD = struct.Struct("<4s4H2IH")
_CENTRAL_HEADER = struct.Struct("<4s6H3I5H2I")
_LOCAL_HEADER = struct.Struct("<4s5H3I2H")
_ZIP64_LOCATOR = struct.Struct("<4sIQI")
_ZIP64_END_RECORD = struct.Struct("<4sQ2H2I4Q")


@dataclass(frozen=True)
class _Directory:
    start: int
    end: int
    entries: int
    prefix_size: int


def _locate_directory(content: bytes) -> _Directory:
    end = content.rfind(b"PK\x05\x06", max(0, len(content) - 65535 - _END_RECORD.size))
    if end < 0 or end + _END_RECORD.size > len(content):
        raise zipfile.BadZipFile("Missing ZIP end record")
    _, disk, directory_disk, disk_entries, entries, size, offset, comment_size = _END_RECORD.unpack_from(content, end)
    if end + _END_RECORD.size + comment_size != len(content):
        raise zipfile.BadZipFile("Invalid ZIP comment length")

    locator_position = end - _ZIP64_LOCATOR.size
    if locator_position >= 0 and content[locator_position : locator_position + 4] == b"PK\x06\x07":
        _, record_disk, record_offset, disks = _ZIP64_LOCATOR.unpack_from(content, locator_position)
        if record_disk != 0 or disks != 1:
            raise zipfile.BadZipFile("Multi-disk ZIP64 archives are not supported")
        record_position = record_offset
        if record_position + _ZIP64_END_RECORD.size > locator_position:
            raise zipfile.BadZipFile("Invalid ZIP64 end record offset")
        if content[record_position : record_position + 4] != b"PK\x06\x06":
            # Match zipfile's handling of prepended data: in this case it
            # locates the fixed-size ZIP64 record immediately before the locator.
            record_position = locator_position - _ZIP64_END_RECORD.size
        if record_position < 0:
            raise zipfile.BadZipFile("Missing ZIP64 end record")
        signature, record_size, _, _, disk, directory_disk, disk_entries, entries, size, offset = (
            _ZIP64_END_RECORD.unpack_from(content, record_position)
        )
        if (
            signature != b"PK\x06\x06"
            or record_size + 12 != locator_position - record_position
            or offset + size != record_offset
        ):
            raise zipfile.BadZipFile("Invalid ZIP64 end record")
        end = record_position
    elif entries == 0xFFFF or size == 0xFFFFFFFF or offset == 0xFFFFFFFF:
        raise zipfile.BadZipFile("Missing ZIP64 directory information")

    start = end - size
    prefix_size = start - offset
    if disk != 0 or directory_disk != 0 or disk_entries != entries:
        raise zipfile.BadZipFile("Multi-disk ZIP archives are not supported")
    if start < 0 or prefix_size < 0 or entries > size // _CENTRAL_HEADER.size:
        raise zipfile.BadZipFile("Invalid ZIP directory bounds")
    return _Directory(start=start, end=end, entries=entries, prefix_size=prefix_size)


def _local_header_offset(*, offset: int, file_size: int, compressed_size: int, extra: bytes) -> int:
    if offset != 0xFFFFFFFF:
        return offset
    cursor = 0
    while cursor + 4 <= len(extra):
        tag, size = struct.unpack_from("<HH", extra, cursor)
        cursor += 4
        if cursor + size > len(extra):
            raise zipfile.BadZipFile("Truncated ZIP extra field")
        if tag == 1:
            # ZIP64 includes only values whose corresponding 32-bit field
            # contains the sentinel, in size/compressed-size/offset order.
            skipped = 8 * (int(file_size == 0xFFFFFFFF) + int(compressed_size == 0xFFFFFFFF))
            if skipped + 8 > size:
                raise zipfile.BadZipFile("Missing ZIP64 local header offset")
            return struct.unpack_from("<Q", extra, cursor + skipped)[0]
        cursor += size
    raise zipfile.BadZipFile("Missing ZIP64 extra field")


def open_zip_with_replacement_names(content: bytes) -> zipfile.ZipFile:
    """Open a bounded ZIP, replacing invalid UTF-8 name bytes with U+FFFD.

    The normal path delegates entirely to zipfile. For a damaged directory,
    temporarily read affected names as CP437 (a reversible byte mapping), and
    expose their lossy UTF-8 form through ZipInfo.filename. orig_filename stays
    byte-preserving so zipfile still checks local/central name consistency.
    Callers must reject collisions and unsafe paths in the recovered names.
    """
    try:
        return zipfile.ZipFile(io.BytesIO(content))
    except UnicodeDecodeError:
        pass

    directory = _locate_directory(content)

    patched = bytearray(content)
    recovered: dict[int, str] = {}
    cursor = directory.start
    for index in range(directory.entries):
        if cursor + _CENTRAL_HEADER.size > directory.end:
            raise zipfile.BadZipFile("Truncated ZIP directory")
        header = _CENTRAL_HEADER.unpack_from(content, cursor)
        if header[0] != b"PK\x01\x02":
            raise zipfile.BadZipFile("Invalid ZIP directory header")
        flags, name_size, extra_size, entry_comment_size = header[3], header[10], header[11], header[12]
        name_start = cursor + _CENTRAL_HEADER.size
        next_cursor = name_start + name_size + extra_size + entry_comment_size
        if next_cursor > directory.end:
            raise zipfile.BadZipFile("Truncated ZIP directory name")
        raw_name = content[name_start : name_start + name_size]
        if flags & _UTF8_FLAG:
            try:
                raw_name.decode("utf-8")
            except UnicodeDecodeError:
                extra_start = name_start + name_size
                local_offset = (
                    _local_header_offset(
                        offset=header[16],
                        file_size=header[9],
                        compressed_size=header[8],
                        extra=content[extra_start : extra_start + extra_size],
                    )
                    + directory.prefix_size
                )
                if local_offset < 0 or local_offset + _LOCAL_HEADER.size > directory.start:
                    raise zipfile.BadZipFile("Invalid ZIP local header offset")
                local = _LOCAL_HEADER.unpack_from(content, local_offset)
                local_name_start = local_offset + _LOCAL_HEADER.size
                if (
                    local[0] != b"PK\x03\x04"
                    or local[9] != name_size
                    or content[local_name_start : local_name_start + local[9]] != raw_name
                    or not local[2] & _UTF8_FLAG
                ):
                    raise zipfile.BadZipFile("ZIP local and directory names differ")
                struct.pack_into("<H", patched, cursor + 8, flags & ~_UTF8_FLAG)
                struct.pack_into("<H", patched, local_offset + 6, local[2] & ~_UTF8_FLAG)
                recovered[index] = raw_name.decode("utf-8", errors="replace")
        cursor = next_cursor
    if cursor != directory.end:
        raise zipfile.BadZipFile("ZIP directory length mismatch")

    archive = zipfile.ZipFile(io.BytesIO(patched))
    for index, info in enumerate(archive.infolist()):
        if index in recovered:
            info.filename = recovered[index]
    archive.NameToInfo = {info.filename: info for info in archive.infolist()}
    return archive
