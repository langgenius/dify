"""Client-safe DTOs and constants for the shell back proxy protocol.

The back proxy contract is shared by the FastAPI server, the client-safe CLI,
and tests. It covers both the original shell connection setup endpoint and the
file upload/download control-plane endpoints used by sandbox-visible
``dify-agent file ...`` commands. Token issuance, key derivation, and JWE
validation stay under ``dify_agent.server.tokens.back_proxy`` so default package
imports remain free of server-only crypto dependencies.
"""

from __future__ import annotations

import base64
import json
from typing import ClassVar, Final, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


BACK_PROXY_PROTOCOL_VERSION: Final[int] = 1
BACK_PROXY_URL_ENV_VAR: Final[str] = "DIFY_AGENT_BACK_PROXY_URL"
BACK_PROXY_AUTH_JWE_ENV_VAR: Final[str] = "DIFY_AGENT_BACK_PROXY_AUTH_JWE"


def normalize_back_proxy_base_url(base_url: str) -> str:
    """Return a validated back proxy base URL without a trailing slash.

    Callers rely on this helper as the shared validation boundary for settings,
    CLI env parsing, and client URL composition. The value must therefore be a
    real HTTP(S) URL with a host/netloc, must not include a query string or
    fragment, and is normalized only by trimming whitespace and removing a final
    trailing slash from the path.
    """
    stripped = base_url.strip()
    if not stripped:
        raise ValueError("back proxy base URL must not be empty")
    parsed = urlsplit(stripped)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("back proxy base URL must use http or https")
    if not parsed.netloc:
        raise ValueError("back proxy base URL must include a host")
    if parsed.query or parsed.fragment:
        raise ValueError("back proxy base URL must not include a query string or fragment")
    normalized_path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, normalized_path, "", ""))


def back_proxy_connections_url(base_url: str) -> str:
    """Return the stable ``/connections`` endpoint URL for one base URL."""
    return f"{normalize_back_proxy_base_url(base_url)}/connections"


def back_proxy_file_upload_request_url(base_url: str) -> str:
    """Return the stable upload-request endpoint URL for one base URL."""
    return f"{normalize_back_proxy_base_url(base_url)}/files/upload-request"


def back_proxy_file_download_request_url(base_url: str) -> str:
    """Return the stable download-request endpoint URL for one base URL."""
    return f"{normalize_back_proxy_base_url(base_url)}/files/download-request"


def is_canonical_dify_file_reference(reference: str) -> bool:
    """Return whether one string matches Dify's opaque file reference format."""
    prefix = "dify-file-ref:"
    if not reference.startswith(prefix):
        return False
    encoded_payload = reference.removeprefix(prefix)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded_payload.encode()))
    except (ValueError, json.JSONDecodeError):
        return False
    record_id = payload.get("record_id")
    return isinstance(record_id, str) and bool(record_id)


class BackProxyConnectRequest(BaseModel):
    """Request body for establishing one shell back proxy connection."""

    protocol_version: Literal[1] = BACK_PROXY_PROTOCOL_VERSION
    argv: list[str]
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BackProxyConnectResponse(BaseModel):
    """Connection placeholder response returned by the server."""

    connection_id: str
    status: Literal["connected"] = "connected"

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BackProxyFileUploadRequest(BaseModel):
    """Request body for one signed upload URL allocation."""

    filename: str
    mimetype: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BackProxyFileUploadResponse(BaseModel):
    """Response body containing the signed data-plane upload URL."""

    upload_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BackProxyFileMapping(BaseModel):
    """Public file mapping used by download-request control-plane calls."""

    transfer_method: Literal["local_file", "tool_file", "datasource_file", "remote_url"]
    reference: str | None = None
    url: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_locator(self) -> "BackProxyFileMapping":
        if self.transfer_method == "remote_url":
            if not self.url:
                raise ValueError("url is required when transfer_method is remote_url")
            if self.reference is not None:
                raise ValueError("reference is not allowed when transfer_method is remote_url")
            return self
        if not self.reference:
            raise ValueError("reference is required for non-remote file mappings")
        if not is_canonical_dify_file_reference(self.reference):
            raise ValueError("reference must be a canonical Dify file reference")
        if self.url is not None:
            raise ValueError("url is not allowed for non-remote file mappings")
        return self


class BackProxyFileDownloadRequest(BaseModel):
    """Request body for one signed download URL allocation."""

    file: BackProxyFileMapping

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BackProxyFileDownloadResponse(BaseModel):
    """Response body containing download metadata plus the signed URL."""

    filename: str
    mime_type: str | None = None
    size: int
    download_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "BACK_PROXY_AUTH_JWE_ENV_VAR",
    "BACK_PROXY_PROTOCOL_VERSION",
    "BACK_PROXY_URL_ENV_VAR",
    "BackProxyConnectRequest",
    "BackProxyConnectResponse",
    "BackProxyFileDownloadRequest",
    "BackProxyFileDownloadResponse",
    "BackProxyFileMapping",
    "BackProxyFileUploadRequest",
    "BackProxyFileUploadResponse",
    "back_proxy_file_download_request_url",
    "back_proxy_file_upload_request_url",
    "back_proxy_connections_url",
    "is_canonical_dify_file_reference",
    "normalize_back_proxy_base_url",
]
