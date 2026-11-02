"""Aliyun configuration.

Users paste collector URLs that already carry the license key in their path
(``/adapt_<key>/api/otlp/traces``). Such endpoints are rejected rather than
parsed, and validation messages are fixed texts that never include input.
"""

import re
from urllib.parse import unquote, urlsplit, urlunsplit

from dify_trace_sdk.config import ProviderConfig, destination, name_or_default, secret
from pydantic import field_validator

DEFAULT_APP_NAME = "dify_app"
DEFAULT_ENDPOINT = "https://tracing-analysis-dc-hz.aliyuncs.com"

_INVALID_APP_NAME = "Aliyun requires an application name without control characters."
_INVALID_LICENSE_KEY = "Aliyun requires a nonempty license key without whitespace or control characters."
_INVALID_ENDPOINT = "Aliyun requires an HTTP(S) base URL without credentials or a collector suffix."


def _is_control(char: str) -> bool:
    return ord(char) < 32 or ord(char) == 127


def _normalized_endpoint(value: str) -> str | None:
    """The base URL with a lowercase ASCII host and no trailing slash; ``None`` when Aliyun cannot use it."""
    value = value.strip(" ") or DEFAULT_ENDPOINT
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        path = parsed.path.rstrip("/")
        # Decode only the public path to detect hidden collector routes. License
        # keys are opaque values and must never be unquoted or otherwise altered.
        decoded_path = unquote(path, errors="strict")
        valid = (
            parsed.scheme in {"http", "https"}
            and host
            and parsed.username is None
            and parsed.password is None
            and "?" not in value
            and "#" not in value
            and "\\" not in value
            and not any(char == " " or _is_control(char) for char in value)
            and not parsed.netloc.endswith(":")
            and (port is None or 1 <= port <= 65535)
            and "%" not in host
            and not re.search(r"%(?![0-9a-fA-F]{2})", path)
            and not re.search(r"%(?:2f|5c)", path, re.IGNORECASE)
            and not any(char in decoded_path for char in "\\?#%")
            and not any(_is_control(char) for char in decoded_path)
            and "//" not in parsed.path
            and not any(part in {".", ".."} or part.lower().startswith("adapt_") for part in decoded_path.split("/"))
            and not decoded_path.lower().endswith(("/v1/traces", "/api/otlp/traces"))
        )
        if not valid or host is None:
            return None
        host = host.encode("idna").decode("ascii").lower()
    except (UnicodeError, ValueError):
        # Return instead of raising here so no exception carrying the input is chained.
        return None
    authority = f"[{host}]" if ":" in host else host
    if port is not None:
        authority = f"{authority}:{port}"
    return urlunsplit((parsed.scheme, authority, path, "", ""))


class AliyunConfig(ProviderConfig):
    app_name: str = DEFAULT_APP_NAME
    license_key: str = secret()
    endpoint: str = destination()

    @field_validator("app_name")
    @classmethod
    def _app_name(cls, value: str) -> str:
        if any(_is_control(char) for char in value):
            raise ValueError(_INVALID_APP_NAME)
        return name_or_default(value, DEFAULT_APP_NAME)

    @field_validator("license_key")
    @classmethod
    def _license_key(cls, value: str) -> str:
        # The key becomes a URL path segment: lone surrogates cannot be percent-encoded.
        if not value or any(char.isspace() or _is_control(char) or "\ud800" <= char <= "\udfff" for char in value):
            raise ValueError(_INVALID_LICENSE_KEY)
        return value

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        endpoint = _normalized_endpoint(value)
        if endpoint is None:
            raise ValueError(_INVALID_ENDPOINT)
        return endpoint
