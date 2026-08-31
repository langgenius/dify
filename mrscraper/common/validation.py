from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit


class ParameterValidationError(ValueError):
    """Raised when public tool parameters violate the operation contract."""


def nonblank_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ParameterValidationError(f"{name} must be a nonblank string.")
    return value.strip()


def optional_string(value: Any, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ParameterValidationError(f"{name} must be a string.")
    stripped = value.strip()
    return stripped or None


def web_url(value: Any, name: str = "url") -> str:
    result = nonblank_string(value, name)
    parsed = urlsplit(result)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ParameterValidationError(f"{name} must be an absolute HTTP or HTTPS URL.")
    return result


def integer(
    value: Any, name: str, *, default: int | None = None, minimum: int | None = None
) -> int:
    candidate = default if value is None else value
    if isinstance(candidate, bool) or not isinstance(candidate, int | float):
        raise ParameterValidationError(f"{name} must be an integer.")
    if isinstance(candidate, float) and (
        not math.isfinite(candidate) or not candidate.is_integer()
    ):
        raise ParameterValidationError(f"{name} must be an integer.")
    result = int(candidate)
    if minimum is not None and result < minimum:
        raise ParameterValidationError(f"{name} must be at least {minimum}.")
    return result


def optional_integer(value: Any, name: str, *, minimum: int | None = None) -> int | None:
    if value is None or value == "":
        return None
    return integer(value, name, minimum=minimum)


def boolean(value: Any, name: str, *, default: bool) -> bool:
    candidate = default if value is None else value
    if not isinstance(candidate, bool):
        raise ParameterValidationError(f"{name} must be a boolean.")
    return candidate


def choice(value: Any, name: str, allowed: set[str], *, default: str | None = None) -> str:
    candidate = default if value is None else value
    if not isinstance(candidate, str) or candidate not in allowed:
        values = ", ".join(sorted(allowed))
        raise ParameterValidationError(f"{name} must be one of: {values}.")
    return candidate


def two_letter_code(value: Any, name: str, *, default: str) -> str:
    candidate = default if value is None else value
    if not isinstance(candidate, str) or re.fullmatch(r"[A-Za-z]{2}", candidate) is None:
        raise ParameterValidationError(f"{name} must be a two-letter code.")
    return candidate.lower()


def json_object(
    value: Any,
    name: str,
    *,
    default: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    candidate = default if value is None else value
    if candidate is None or candidate == "":
        return None
    if isinstance(candidate, str):
        try:
            candidate = json.loads(candidate)
        except json.JSONDecodeError as exc:
            raise ParameterValidationError(f"{name} must contain valid JSON.") from exc
    if not isinstance(candidate, Mapping):
        raise ParameterValidationError(f"{name} must be a JSON object.")
    return dict(candidate)


def json_array(value: Any, name: str, *, default: list[Any] | None = None) -> list[Any]:
    candidate = default if value is None else value
    if isinstance(candidate, str):
        try:
            candidate = json.loads(candidate)
        except json.JSONDecodeError as exc:
            raise ParameterValidationError(f"{name} must contain a valid JSON array.") from exc
    if not isinstance(candidate, list):
        raise ParameterValidationError(f"{name} must be a JSON array.")
    return candidate


def cookie_array(value: Any) -> list[dict[str, Any]]:
    items = json_array(value, "cookies", default=[])
    if any(not isinstance(item, Mapping) for item in items):
        raise ParameterValidationError("cookies must be an array of JSON objects.")
    return [dict(item) for item in items]


def url_array(value: Any) -> list[str]:
    items = json_array(value, "urls")
    normalized: list[str] = []
    for item in items:
        if not isinstance(item, str) or not item.strip():
            raise ParameterValidationError("urls must contain only nonblank URL strings.")
        normalized.append(web_url(item, "urls item"))
    if not normalized:
        raise ParameterValidationError("urls must contain at least one URL.")
    return normalized


def supplied(parameters: Mapping[str, Any], name: str) -> bool:
    return name in parameters and parameters[name] is not None


def reject_supplied(parameters: Mapping[str, Any], names: set[str], context: str) -> None:
    invalid = sorted(name for name in names if supplied(parameters, name))
    if invalid:
        raise ParameterValidationError(f"{', '.join(invalid)} cannot be used with {context}.")
