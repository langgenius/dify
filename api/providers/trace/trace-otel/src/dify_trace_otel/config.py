"""OTLP/HTTP configuration; JSON fields remain strings for encrypted storage and forms.

Validated values can be sent without ambient configuration. Header credentials
are write-only; transport headers and the service identity cannot be overridden.
"""

import json
import math
import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from dify_trace_sdk.config import ProviderConfig, destination, name_or_default, secret
from pydantic import field_validator

_HEADER_NAME = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")
_TRANSPORT_HEADERS = frozenset(
    {
        "host",
        "content-type",
        "content-length",
        "content-encoding",
        "accept",
        "accept-encoding",
        "connection",
        "transfer-encoding",
        "te",
        "trailer",
        "upgrade",
        "keep-alive",
        "proxy-authorization",
        "proxy-connection",
    }
)


def _json_object(value: object) -> dict[str, Any]:
    """Accept an optional JSON object or its legacy dict form; fail without quoting values."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return {}
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
        if not isinstance(parsed, dict) or not all(isinstance(key, str) and key for key in parsed):
            raise ValueError
        # Also rejects NaN/Infinity and unserializable legacy objects before storage.
        json.dumps(parsed, allow_nan=False)
    except (ValueError, TypeError, RecursionError):
        raise ValueError("Expected a JSON object with nonempty keys and finite values") from None
    return parsed


def _attribute_value(value: object) -> bool:
    """Whether a value is an OTLP scalar or a homogeneous array of finite scalars."""
    if type(value) in {str, bool, int}:
        return not isinstance(value, int) or isinstance(value, bool) or -(2**63) <= value < 2**63
    if isinstance(value, float):
        return math.isfinite(value)
    return (
        isinstance(value, list)
        and len({type(item) for item in value}) <= 1
        and all(not isinstance(item, list) and _attribute_value(item) for item in value)
    )


class OTelConfig(ProviderConfig):
    """Four console fields, normalized before verification and workspace encryption."""

    endpoint: str = destination(exact=True)
    headers: str = secret(default="")
    service_name: str = "dify"
    resource_attributes: str = "{}"

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        """Keep full collector paths; bare origins use /v1/traces, never credentials or queries."""
        try:
            url = value.strip()
            parsed = urlsplit(url)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.port == 0
                or parsed.netloc.endswith(":")
                or any(char in url for char in "?#\\")
                or any(ord(char) < 32 or ord(char) == 127 for char in value)
                or any(char.isspace() for char in url)
            ):
                raise ValueError
        except ValueError:
            raise ValueError("Endpoint must be an HTTP(S) URL without credentials, query or fragment") from None
        return urlunsplit(parsed._replace(path="/v1/traces" if parsed.path in {"", "/"} else parsed.path))

    @field_validator("service_name", mode="before")
    @classmethod
    def _service_name(cls, value: object) -> object:
        """Normalize optional historical names to dify; preserve explicit nonblank names."""
        return name_or_default(value, "dify") if value is None or isinstance(value, str) else value

    @field_validator("headers", mode="before")
    @classmethod
    def _headers(cls, value: object) -> str:
        """Validate a string-valued HTTP header object; {} explicitly clears the stored secret."""
        headers = _json_object(value)
        names = [name.lower() for name in headers]
        if len(set(names)) != len(names) or any(name in _TRANSPORT_HEADERS for name in names):
            raise ValueError("Headers must not duplicate names or override HTTP transport headers")
        for name, item in headers.items():
            if (
                not _HEADER_NAME.fullmatch(name)
                or not isinstance(item, str)
                or (item and item[0].isspace())
                or any(ord(char) < 32 or ord(char) > 126 for char in item)
            ):
                raise ValueError("Headers must have valid names and printable ASCII string values")
        return json.dumps(headers, ensure_ascii=False) if headers else ""

    @field_validator("resource_attributes", mode="before")
    @classmethod
    def _resource_attributes(cls, value: object) -> str:
        """Accept OTLP scalar/array attributes; service.name belongs to service_name only."""
        attributes = _json_object(value)
        if "service.name" in attributes:
            raise ValueError("Set service.name through the service_name field")
        if not all(_attribute_value(item) for item in attributes.values()):
            raise ValueError("Resource attributes must be finite scalars or homogeneous arrays of scalars")
        return json.dumps(attributes, ensure_ascii=False)

    def parsed_headers(self) -> dict[str, str]:
        """Return validated request credentials; does not access environment or storage."""
        return json.loads(self.headers) if self.headers else {}

    def parsed_resource_attributes(self) -> dict[str, Any]:
        """Return validated OTLP resource values, without the separately owned service.name."""
        return json.loads(self.resource_attributes)
