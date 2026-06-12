"""Client-safe DTOs and endpoint parsing for the Agent Stub protocol.

The Agent Stub contract is shared by the HTTP router, optional gRPC transport,
the sandbox-visible CLI, and tests. Control-plane requests always validate into
these Pydantic DTOs before business logic runs, while token issuance and JWE
validation stay under ``dify_agent.agent_stub.server.tokens.agent_stub`` so the
default package remains free of server-only crypto dependencies.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import ClassVar, Final, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


AGENT_STUB_PROTOCOL_VERSION: Final[int] = 1
AGENT_STUB_URL_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_URL"
AGENT_STUB_AUTH_JWE_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_AUTH_JWE"

type AgentStubURLScheme = Literal["http", "https", "grpc"]


@dataclass(frozen=True, slots=True)
class AgentStubEndpoint:
    """Validated Agent Stub endpoint with normalized transport metadata."""

    url: str
    scheme: AgentStubURLScheme
    host: str
    port: int | None
    path: str

    @property
    def is_http(self) -> bool:
        return self.scheme in {"http", "https"}

    @property
    def is_grpc(self) -> bool:
        return self.scheme == "grpc"


def parse_agent_stub_endpoint(url: str) -> AgentStubEndpoint:
    """Parse one Agent Stub endpoint URL for HTTP or gRPC transport selection.

    HTTP(S) endpoints are normalized by trimming whitespace and removing a final
    trailing slash from the path while preserving the configured base path.
    gRPC endpoints must be plain ``grpc://host:port`` targets with no path,
    query string, or fragment because transport routing happens on the gRPC
    service name instead of an HTTP URL path.
    """
    stripped = url.strip()
    if not stripped:
        raise ValueError("Agent Stub URL must not be empty")
    parsed = urlsplit(stripped)
    if parsed.scheme not in {"http", "https", "grpc"}:
        raise ValueError("Agent Stub URL must use http, https, or grpc")
    if not parsed.netloc:
        raise ValueError("Agent Stub URL must include a host")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Agent Stub URL must not include user info")
    if parsed.query or parsed.fragment:
        raise ValueError("Agent Stub URL must not include a query string or fragment")
    if parsed.hostname is None:
        raise ValueError("Agent Stub URL must include a host")

    scheme = parsed.scheme
    if scheme == "grpc":
        if parsed.path not in {"", "/"}:
            raise ValueError("gRPC Agent Stub URL must not include a path")
        if parsed.port is None:
            raise ValueError("gRPC Agent Stub URL must include an explicit port")
        host = parsed.hostname
        normalized_url = f"grpc://{_format_url_host(host)}:{parsed.port}"
        return AgentStubEndpoint(
            url=normalized_url,
            scheme="grpc",
            host=host,
            port=parsed.port,
            path="",
        )

    normalized_path = parsed.path.rstrip("/")
    normalized_url = urlunsplit((scheme, parsed.netloc, normalized_path, "", ""))
    return AgentStubEndpoint(
        url=normalized_url,
        scheme=scheme,  # pyright: ignore[reportArgumentType]
        host=parsed.hostname,
        port=parsed.port,
        path=normalized_path,
    )


def normalize_agent_stub_url(url: str) -> str:
    """Return the normalized Agent Stub URL used across settings and CLI env."""
    return parse_agent_stub_endpoint(url).url


def agent_stub_connections_url(base_url: str) -> str:
    """Return the stable HTTP ``/connections`` endpoint URL for one base URL."""
    return f"{_require_http_base_url(base_url)}/connections"


def agent_stub_file_upload_request_url(base_url: str) -> str:
    """Return the stable HTTP upload-request endpoint URL for one base URL."""
    return f"{_require_http_base_url(base_url)}/files/upload-request"


def agent_stub_file_download_request_url(base_url: str) -> str:
    """Return the stable HTTP download-request endpoint URL for one base URL."""
    return f"{_require_http_base_url(base_url)}/files/download-request"


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


class AgentStubConnectRequest(BaseModel):
    """Request body for establishing one Agent Stub control-plane connection."""

    protocol_version: Literal[1] = AGENT_STUB_PROTOCOL_VERSION
    argv: list[str]
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubConnectResponse(BaseModel):
    """Connection placeholder response returned by the server."""

    connection_id: str
    status: Literal["connected"] = "connected"

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubFileUploadRequest(BaseModel):
    """Request body for one signed upload URL allocation."""

    filename: str
    mimetype: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubFileUploadResponse(BaseModel):
    """Response body containing the signed data-plane upload URL."""

    upload_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubFileMapping(BaseModel):
    """Public file mapping used by download-request control-plane calls."""

    transfer_method: Literal["local_file", "tool_file", "datasource_file", "remote_url"]
    reference: str | None = None
    url: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_locator(self) -> "AgentStubFileMapping":
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


class AgentStubFileDownloadRequest(BaseModel):
    """Request body for one signed download URL allocation."""

    file: AgentStubFileMapping

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubFileDownloadResponse(BaseModel):
    """Response body containing download metadata plus the signed URL."""

    filename: str
    mime_type: str | None = None
    size: int
    download_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def _require_http_base_url(base_url: str) -> str:
    endpoint = parse_agent_stub_endpoint(base_url)
    if not endpoint.is_http:
        raise ValueError("HTTP Agent Stub URLs must use http or https")
    return endpoint.url


def _format_url_host(host: str) -> str:
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


__all__ = [
    "AGENT_STUB_AUTH_JWE_ENV_VAR",
    "AGENT_STUB_PROTOCOL_VERSION",
    "AGENT_STUB_URL_ENV_VAR",
    "AgentStubConnectRequest",
    "AgentStubConnectResponse",
    "AgentStubEndpoint",
    "AgentStubFileDownloadRequest",
    "AgentStubFileDownloadResponse",
    "AgentStubFileMapping",
    "AgentStubFileUploadRequest",
    "AgentStubFileUploadResponse",
    "AgentStubURLScheme",
    "agent_stub_connections_url",
    "agent_stub_file_download_request_url",
    "agent_stub_file_upload_request_url",
    "is_canonical_dify_file_reference",
    "normalize_agent_stub_url",
    "parse_agent_stub_endpoint",
]
