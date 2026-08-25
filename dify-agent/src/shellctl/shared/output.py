"""UTF-8-safe output slicing helpers for shellctl."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True, frozen=True)
class OutputWindow:
    """UTF-8-safe slice of `output.log`."""

    output: str
    offset: int
    truncated: bool


def read_output_window(path: Path, *, offset: int, limit: int) -> OutputWindow:
    """Read a forward UTF-8-safe slice from `output.log`."""

    if offset < 0:
        raise ValueError(f"offset must be >= 0; got {offset}")
    if limit <= 0:
        raise ValueError(f"limit must be > 0; got {limit}")

    if not path.exists():
        if offset == 0:
            return OutputWindow(output="", offset=0, truncated=False)
        raise ValueError(f"offset {offset} exceeds current file size 0")

    size = path.stat().st_size
    if offset > size:
        raise ValueError(f"offset {offset} exceeds current file size {size}")
    if offset == size:
        return OutputWindow(output="", offset=offset, truncated=False)

    with path.open("rb") as handle:
        handle.seek(offset)
        raw = handle.read(limit + 4)

    start_shift = _advance_to_utf8_boundary(raw, 0)
    data = raw[start_shift:]
    budget = max(0, limit - start_shift)
    consumed = _valid_utf8_prefix_length(data[:budget])
    if consumed == 0 and data:
        consumed = _first_complete_utf8_char_length(data)
    output_bytes = data[:consumed]
    new_offset = offset + start_shift + consumed
    truncated = new_offset < size
    return OutputWindow(
        output=output_bytes.decode("utf-8", errors="strict"),
        offset=new_offset,
        truncated=truncated,
    )


def tail_output_window(path: Path, *, limit: int) -> OutputWindow:
    """Read a UTF-8-safe tail snapshot from `output.log`."""

    if limit <= 0:
        raise ValueError(f"limit must be > 0; got {limit}")
    if not path.exists():
        return OutputWindow(output="", offset=0, truncated=False)
    size = path.stat().st_size
    if size == 0:
        return OutputWindow(output="", offset=0, truncated=False)
    start = max(0, size - limit)
    padded_start = max(0, start - 4)
    with path.open("rb") as handle:
        handle.seek(padded_start)
        raw = handle.read(size - padded_start)
    relative_start = _advance_to_utf8_boundary(raw, start - padded_start)
    payload = raw[relative_start:]
    consumed = _valid_utf8_prefix_length(payload)
    output_bytes = payload[:consumed]
    return OutputWindow(
        output=output_bytes.decode("utf-8", errors="strict"),
        offset=padded_start + relative_start + consumed,
        truncated=False,
    )


def _advance_to_utf8_boundary(data: bytes, start: int) -> int:
    while start < len(data) and _is_utf8_continuation_byte(data[start]):
        start += 1
    return start


def _valid_utf8_prefix_length(data: bytes) -> int:
    end = len(data)
    while end >= 0:
        try:
            data[:end].decode("utf-8", errors="strict")
            return end
        except UnicodeDecodeError as exc:
            if exc.start < end - 4:
                end = exc.start
            else:
                end -= 1
    return 0


def _is_utf8_continuation_byte(value: int) -> bool:
    return (value & 0b1100_0000) == 0b1000_0000


def _first_complete_utf8_char_length(data: bytes) -> int:
    for end in range(1, len(data) + 1):
        try:
            decoded = data[:end].decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            continue
        if len(decoded) == 1:
            return end
        if decoded:
            return len(decoded[0].encode("utf-8"))
    return 0


__all__ = ["OutputWindow", "read_output_window", "tail_output_window"]
