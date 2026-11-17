"""Bounded startup-only loading of an optional deployment mapping registry.

This configuration adapter only loads JSON objects; the mapping consumer owns
ModelMapping validation, immutable revisions and duplicate source identities.
Errors deliberately omit paths and contents, including chained parser errors.
"""

import json
import os
import stat
from pathlib import Path
from typing import Any, Never

MAX_MAPPING_REGISTRY_BYTES = 4 * 1024 * 1024


class TokenerMappingConfigurationError(RuntimeError):
    """A safe startup error, not a Pydantic error that echoes settings input."""


def _invalid_constant(_value: str) -> Never:
    raise TokenerMappingConfigurationError("Tokener mapping registry must contain strict JSON")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise TokenerMappingConfigurationError("Tokener mapping registry contains duplicate JSON keys")
        result[key] = value
    return result


def _records(raw: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(raw, parse_constant=_invalid_constant, object_pairs_hook=_unique_object)
    except (ValueError, RecursionError):
        raise TokenerMappingConfigurationError("Tokener mapping registry must contain strict JSON") from None
    if not isinstance(parsed, list) or any(not isinstance(record, dict) for record in parsed):
        raise TokenerMappingConfigurationError("Tokener mapping registry must be an array of objects")
    return parsed


def _identity(info: os.stat_result) -> tuple[int, int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def merge_mapping_registry_file(inline_registry: str, file_name: str) -> str:
    """Append a regular, non-symlink UTF-8 file without modifying either source.

    The complete effective registry is limited to 4 MiB. Deployment-owned parent
    directories must be stable; use the same read-only mount on every Core role.
    There is no deduplication, override, interpolation, or hot reload.
    """
    path = Path(file_name)
    if not path.is_absolute():
        raise TokenerMappingConfigurationError("TOKENER_LEGACY_MODEL_MAPPING_FILE must be an absolute local file")
    try:
        # lstat rejects symlinks/directories/FIFOs before opening. O_NOFOLLOW
        # and O_NONBLOCK retain that protection if the final path is replaced.
        before_path = path.lstat()
        if not stat.S_ISREG(before_path.st_mode):
            raise TokenerMappingConfigurationError("Tokener mapping registry requires a regular non-symlink file")
        descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or _identity(before) != _identity(before_path):
                raise TokenerMappingConfigurationError("Tokener mapping registry file changed during startup")
            if before.st_size > MAX_MAPPING_REGISTRY_BYTES:
                raise TokenerMappingConfigurationError("Tokener mapping registry exceeds the 4 MiB limit")
            raw = source.read(MAX_MAPPING_REGISTRY_BYTES + 1)
            after = os.fstat(source.fileno())
        after_path = path.lstat()
        if (
            not stat.S_ISREG(after.st_mode)
            or not stat.S_ISREG(after_path.st_mode)
            or _identity(before) != _identity(after)
            or _identity(after) != _identity(after_path)
        ):
            raise TokenerMappingConfigurationError("Tokener mapping registry file changed during startup")
        if len(raw) > MAX_MAPPING_REGISTRY_BYTES or len(inline_registry.encode("utf-8")) > MAX_MAPPING_REGISTRY_BYTES:
            raise TokenerMappingConfigurationError("Tokener mapping registry exceeds the 4 MiB limit")
        records = _records(inline_registry) + _records(raw.decode("utf-8"))
        merged = json.dumps(records, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        if len(merged.encode("utf-8")) > MAX_MAPPING_REGISTRY_BYTES:
            raise TokenerMappingConfigurationError("Tokener mapping registry exceeds the 4 MiB limit")
        return merged
    except (OSError, UnicodeError, ValueError, RecursionError):
        raise TokenerMappingConfigurationError("Tokener mapping registry could not be loaded safely") from None
