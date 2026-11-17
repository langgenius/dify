"""Tencent APM configuration. Validation messages are fixed texts that never include input."""

import re
from urllib.parse import urlsplit, urlunsplit

from dify_trace_sdk.config import ProviderConfig, destination, secret
from pydantic import field_validator

SERVICE_NAME = re.compile(r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?")
_LEGACY_DEFAULT_SERVICE_NAME = "dify_app"
_INVALID_TOKEN = "Tencent APM requires a nonempty token of printable ASCII characters."
_INVALID_ENDPOINT = "Tencent APM requires an HTTP(S) collector origin with a valid host and port."


def _normalized_endpoint(value: str) -> str | None:
    """The collector origin with a lowercase ASCII host; ``None`` when the value is not an origin."""
    value = value.strip()
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        valid = (
            parsed.scheme in {"http", "https"}
            and host
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and "?" not in value
            and "#" not in value
            and "\\" not in value
            and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
            and not parsed.netloc.endswith(":")
            and (port is None or 1 <= port <= 65535)
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
    return urlunsplit((parsed.scheme, authority, "", "", ""))


class TencentConfig(ProviderConfig):
    token: str = secret()
    endpoint: str = destination()
    service_name: str

    @field_validator("token")
    @classmethod
    def _token(cls, value: str) -> str:
        # The token is opaque and kept verbatim. gRPC metadata carries only printable
        # ASCII, and gRPC reports any other value in an exception that quotes it.
        if not value.strip() or not (value.isascii() and value.isprintable()):
            raise ValueError(_INVALID_TOKEN)
        return value

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        endpoint = _normalized_endpoint(value)
        if endpoint is None:
            raise ValueError(_INVALID_ENDPOINT)
        return endpoint

    @field_validator("service_name")
    @classmethod
    def _service_name(cls, value: str) -> str:
        # Names saved before verification checked ``SERVICE_NAME`` (such as the old
        # ``dify_app`` default) were exported as entered and must keep working.
        return value.strip() or _LEGACY_DEFAULT_SERVICE_NAME
