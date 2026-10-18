"""Phoenix configuration checks never create a tracer, project, or test span.

A bounded project-list GET establishes read access only, including on a keyless
self-hosted server. It does not establish ingestion or project write permission.
Legacy Arize/Phoenix runtime adapters remain separate owners.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from pydantic import TypeAdapter

from core.helper import ssrf_proxy
from dify_trace_arize_phoenix.config import PhoenixConfig

type VerificationCode = Literal[
    "invalid_endpoint",
    "invalid_project",
    "invalid_api_key",
    "authentication_failed",
    "permission_denied",
    "endpoint_unavailable",
    "malformed_response",
    "connection_failed",
]
_MESSAGES: dict[VerificationCode, str] = {
    "invalid_endpoint": "Phoenix requires an HTTP(S) base URL, optionally with a path prefix, without /v1/traces.",
    "invalid_project": "Phoenix requires a valid project name.",
    "invalid_api_key": "Phoenix requires an API key without whitespace or mask placeholders, or no key.",
    "authentication_failed": "Phoenix authentication failed.",
    "permission_denied": "Phoenix project-list access was denied.",
    "endpoint_unavailable": "Phoenix endpoint could not be verified.",
    "malformed_response": "Phoenix verification returned an invalid response.",
    "connection_failed": "Phoenix verification request failed.",
}
_JSON_OBJECT = TypeAdapter(dict[str, object])
_MAX_RESPONSE_BYTES = 1024 * 1024
_DEFAULT_ENDPOINT = "https://app.phoenix.arize.com"


class PhoenixConfigurationError(ValueError):
    """Safe diagnostics exclude credentials, request URLs, and vendor response bodies."""

    def __init__(self, code: VerificationCode) -> None:
        self.code = code
        super().__init__(_MESSAGES[code])


@dataclass(frozen=True, slots=True)
class ReadablePhoenixEndpoint:
    endpoint: str
    project: str


def _endpoint(value: object) -> str:
    if not isinstance(value, str):
        raise PhoenixConfigurationError("invalid_endpoint")
    value = value.strip(" ") or _DEFAULT_ENDPOINT
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        path = parsed.path.rstrip("/")
        decoded_path = unquote(path, errors="strict")
        valid = (
            parsed.scheme in {"http", "https"}
            and host
            and parsed.username is None
            and parsed.password is None
            and "?" not in value
            and "#" not in value
            and "\\" not in value
            and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
            and not parsed.netloc.endswith(":")
            and (port is None or 1 <= port <= 65535)
            and "%" not in host
            and not re.search(r"%(?![0-9a-fA-F]{2})", path)
            and not re.search(r"%(?:2f|5c)", path, re.IGNORECASE)
            and not any(char in decoded_path for char in "\\?#%")
            and not any(ord(char) < 32 or ord(char) == 127 for char in decoded_path)
            and "//" not in parsed.path
            and not any(part in {".", ".."} for part in decoded_path.split("/"))
            and not decoded_path.endswith("/v1/traces")
        )
        if not valid or host is None:
            raise PhoenixConfigurationError("invalid_endpoint")
        host = host.encode("idna").decode("ascii").lower()
        authority = f"[{host}]" if ":" in host else host
        if port is not None:
            authority = f"{authority}:{port}"
        return urlunsplit((parsed.scheme, authority, path, "", ""))
    except (UnicodeError, ValueError):
        raise PhoenixConfigurationError("invalid_endpoint") from None


def _project(value: object) -> str:
    if value is None:
        return "default"
    if not isinstance(value, str) or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise PhoenixConfigurationError("invalid_project")
    result = value.strip() or "default"
    if result in {".", ".."}:
        raise PhoenixConfigurationError("invalid_project")
    return result


def normalize_configuration(values: Mapping[str, object]) -> PhoenixConfig:
    """Normalize new writes without tightening the model used to read old records.

    Secret contents are checked only after PATCH restores masked credentials.
    The project redirect loader uses a GraphQL name variable, not REST's more
    restrictive project-identifier path. Do not impose that REST limit here.
    """
    key = values.get("api_key")
    if key is not None and not isinstance(key, str):
        raise PhoenixConfigurationError("invalid_api_key")
    return PhoenixConfig(
        endpoint=_endpoint(values.get("endpoint", _DEFAULT_ENDPOINT)),
        project=_project(values.get("project")),
        api_key=key,
    )


def project_url(config: PhoenixConfig) -> str:
    """Compute the configured UI redirect without SDK initialization or network I/O."""
    return f"{_endpoint(config.endpoint)}/redirects/projects/{quote(_project(config.project), safe='')}"


def verify_configuration(config: PhoenixConfig) -> ReadablePhoenixEndpoint:
    """Read at most one page; an empty project list is valid and creates nothing."""
    config = normalize_configuration(config.model_dump())
    key = config.api_key
    if key and ("*" in key or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in key)):
        raise PhoenixConfigurationError("invalid_api_key")
    headers = {"Accept": "application/json", "Accept-Encoding": "identity", "Cookie": ""}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        response = ssrf_proxy.get(
            config.endpoint + "/v1/projects",
            params={"limit": 1},
            headers=headers,
            auth=None,
            timeout=30.0,
            max_retries=0,
            follow_redirects=False,
            stream_response=True,
        )
    except Exception:
        raise PhoenixConfigurationError("connection_failed") from None
    try:
        if response.status_code == 401:
            raise PhoenixConfigurationError("authentication_failed")
        if response.status_code == 403:
            raise PhoenixConfigurationError("permission_denied")
        if response.status_code != 200:
            raise PhoenixConfigurationError("endpoint_unavailable")
        try:
            buffered = ssrf_proxy.buffer_response(response, max_response_bytes=_MAX_RESPONSE_BYTES)
            data = _JSON_OBJECT.validate_python(buffered.json(), strict=True)
        except (ValueError, TypeError):
            raise PhoenixConfigurationError("malformed_response") from None
        except Exception:
            raise PhoenixConfigurationError("connection_failed") from None
    finally:
        response.close()
    rows, cursor = data.get("data"), data.get("next_cursor")
    if not isinstance(rows, list) or "next_cursor" not in data or (cursor is not None and not isinstance(cursor, str)):
        raise PhoenixConfigurationError("malformed_response")
    for row in rows:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("id"), str)
            or not row["id"]
            or not isinstance(row.get("name"), str)
            or not row["name"]
            or (row.get("description") is not None and not isinstance(row["description"], str))
        ):
            raise PhoenixConfigurationError("malformed_response")
    return ReadablePhoenixEndpoint(config.endpoint, _project(config.project))
