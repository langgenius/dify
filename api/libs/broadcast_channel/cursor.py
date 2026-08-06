from __future__ import annotations

import re

_REDIS_STREAM_ID_PATTERN = re.compile(r"^[0-9]+-[0-9]+$")
_REDIS_STREAM_ID_COMPONENT_MAX = (1 << 64) - 1
_REDIS_STREAM_ID_COMPONENT_MAX_DIGITS = len(str(_REDIS_STREAM_ID_COMPONENT_MAX))


def normalize_stream_cursor(cursor: str | bytes) -> str:
    """Normalize and validate a public Redis Streams replay cursor."""

    if isinstance(cursor, bytes):
        try:
            cursor = cursor.decode("ascii")
        except UnicodeDecodeError as error:
            raise ValueError("event cursor must be a Redis Stream ID such as '1712345678901-0'") from error
    normalized = cursor.strip()
    if not _REDIS_STREAM_ID_PATTERN.fullmatch(normalized):
        raise ValueError("event cursor must be a Redis Stream ID such as '1712345678901-0'")
    milliseconds, sequence = normalized.split("-", maxsplit=1)
    for component in (milliseconds, sequence):
        # Bound before int() so adversarial headers cannot hit Python's
        # max_str_digits exception and turn a client validation error into 500.
        if len(component) > _REDIS_STREAM_ID_COMPONENT_MAX_DIGITS or int(component) > _REDIS_STREAM_ID_COMPONENT_MAX:
            raise ValueError("event cursor components must be unsigned 64-bit integers")
    return normalized
