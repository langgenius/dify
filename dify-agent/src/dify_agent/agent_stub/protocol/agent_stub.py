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
AGENT_STUB_API_BASE_URL_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_API_BASE_URL"
AGENT_STUB_AUTH_JWE_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_AUTH_JWE"
AGENT_STUB_DRIVE_BASE_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_DRIVE_BASE"
DEFAULT_AGENT_STUB_DRIVE_BASE: Final[str] = "/mnt/drive"

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


def agent_stub_drive_base_for_ref(drive_ref: str | None) -> str:
    """Return the fixed sandbox-local Agent Stub drive base for one drive ref."""
    normalized_ref = (drive_ref or "").strip()
    if not normalized_ref:
        return DEFAULT_AGENT_STUB_DRIVE_BASE
    drive_ref_parts = normalized_ref.split("/")
    if normalized_ref.startswith("/") or any(part in {"", ".", ".."} for part in drive_ref_parts):
        raise ValueError("Agent Stub drive_ref must be a safe relative path")
    return f"{DEFAULT_AGENT_STUB_DRIVE_BASE.rstrip('/')}/{'/'.join(drive_ref_parts)}"


def parse_agent_stub_endpoint(url: str) -> AgentStubEndpoint:
    """Parse one Agent Stub endpoint URL for HTTP or gRPC transport selection.

    HTTP(S) endpoints accept either the service root or the explicit
    ``/agent-stub`` API root and normalize to the latter. gRPC endpoints must be
    plain ``grpc://host:port`` targets with no path, query string, or fragment
    because transport routing happens on the gRPC service name instead of an
    HTTP URL path.
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
    if normalized_path in {"", "/"}:
        normalized_path = "/agent-stub"
    elif normalized_path != "/agent-stub":
        raise ValueError("HTTP Agent Stub API base URL path must be empty or /agent-stub")
    normalized_url = urlunsplit((scheme, parsed.netloc, normalized_path, "", ""))
    return AgentStubEndpoint(
        url=normalized_url,
        scheme=scheme,  # pyright: ignore[reportArgumentType]
        host=parsed.hostname,
        port=parsed.port,
        path=normalized_path,
    )


def normalize_agent_stub_api_base_url(url: str) -> str:
    """Return the normalized Agent Stub API base URL used across settings and CLI env."""
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


def agent_stub_drive_manifest_url(base_url: str) -> str:
    """Return the stable HTTP drive-manifest endpoint URL for one base URL."""
    return f"{_require_http_base_url(base_url)}/drive/manifest"


def agent_stub_drive_commit_url(base_url: str) -> str:
    """Return the stable HTTP drive-commit endpoint URL for one base URL."""
    return f"{_require_http_base_url(base_url)}/drive/commit"


def agent_stub_config_manifest_url(base_url: str) -> str:
    """Return the stable HTTP config-manifest endpoint URL for one base URL."""
    return f"{_require_http_base_url(base_url)}/config/manifest"


def agent_stub_config_skill_pull_url(base_url: str, name: str) -> str:
    return f"{_require_http_base_url(base_url)}/config/skills/{name}/pull"


def agent_stub_config_skill_inspect_url(base_url: str, name: str) -> str:
    return f"{_require_http_base_url(base_url)}/config/skills/{name}/inspect"


def agent_stub_config_file_pull_url(base_url: str, name: str) -> str:
    return f"{_require_http_base_url(base_url)}/config/files/{name}/pull"


def agent_stub_config_push_url(base_url: str) -> str:
    return f"{_require_http_base_url(base_url)}/config/push"


def agent_stub_config_env_url(base_url: str) -> str:
    return f"{_require_http_base_url(base_url)}/config/env"


def agent_stub_config_note_url(base_url: str) -> str:
    return f"{_require_http_base_url(base_url)}/config/note"


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


class AgentStubDriveFileRef(BaseModel):
    """Trusted file reference used by Agent Stub drive commit requests."""

    kind: Literal["upload_file", "tool_file"]
    id: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubDriveCommitItem(BaseModel):
    """One drive key to file binding committed through the Agent Stub."""

    key: str
    file_ref: AgentStubDriveFileRef | None = None
    value_owned_by_drive: bool = True
    is_skill: bool = False
    skill_metadata: dict[str, str] | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubDriveCommitRequest(BaseModel):
    """Request body for one Agent Stub drive commit batch."""

    items: list[AgentStubDriveCommitItem]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubDriveItem(BaseModel):
    """One manifest or commit item returned by the Agent Stub drive API.

    Known stable fields stay typed, while extra response metadata from the Dify
    API is preserved for forward compatibility.
    """

    key: str
    size: int | None = None
    hash: str | None = None
    mime_type: str | None = None
    file_kind: Literal["upload_file", "tool_file"] | None = None
    file_id: str | None = None
    created_at: int | None = None
    download_url: str | None = None
    value_owned_by_drive: bool | None = None
    removed: bool | None = None
    is_skill: bool | None = None
    skill_metadata: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")


class AgentStubDriveManifestResponse(BaseModel):
    """Response body for one Agent Stub drive manifest request."""

    items: list[AgentStubDriveItem]


class AgentStubDriveCommitResponse(BaseModel):
    """Response body for one Agent Stub drive commit request."""

    items: list[AgentStubDriveItem]


class AgentStubConfigVersionInfo(BaseModel):
    id: str
    kind: Literal["snapshot", "draft", "build_draft"]
    writable: bool


class AgentStubConfigSkillItem(BaseModel):
    name: str
    description: str
    size: int | None = None
    hash: str | None = None
    mime_type: str | None = None


class AgentStubConfigSkillItemsResponse(BaseModel):
    items: list[AgentStubConfigSkillItem] = Field(default_factory=list)


class AgentStubConfigFileItem(BaseModel):
    name: str
    size: int | None = None
    hash: str | None = None
    mime_type: str | None = None


class AgentStubConfigFileItemsResponse(BaseModel):
    items: list[AgentStubConfigFileItem] = Field(default_factory=list)


class AgentStubConfigManifestResponse(BaseModel):
    agent_id: str
    config_version: AgentStubConfigVersionInfo
    skills: AgentStubConfigSkillItemsResponse = Field(default_factory=AgentStubConfigSkillItemsResponse)
    files: AgentStubConfigFileItemsResponse = Field(default_factory=AgentStubConfigFileItemsResponse)
    env_keys: list[str] = Field(default_factory=list)
    note: str = ""


class AgentStubConfigFileRef(BaseModel):
    kind: Literal["upload_file", "tool_file"]
    id: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubConfigPushFileItem(BaseModel):
    name: str
    file_ref: AgentStubConfigFileRef | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubConfigPushSkillItem(BaseModel):
    name: str
    file_ref: AgentStubConfigFileRef | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubConfigPushRequest(BaseModel):
    files: list[AgentStubConfigPushFileItem] = Field(default_factory=list)
    skills: list[AgentStubConfigPushSkillItem] = Field(default_factory=list)
    env_text: str | None = None
    note: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubConfigPushResponse(AgentStubConfigManifestResponse):
    """Updated config manifest returned after one config push."""


class AgentStubConfigEnvUpdateRequest(BaseModel):
    env_text: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubConfigNoteUpdateRequest(BaseModel):
    note: str

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
    "AGENT_STUB_DRIVE_BASE_ENV_VAR",
    "AGENT_STUB_PROTOCOL_VERSION",
    "AGENT_STUB_API_BASE_URL_ENV_VAR",
    "DEFAULT_AGENT_STUB_DRIVE_BASE",
    "AgentStubConnectRequest",
    "AgentStubConnectResponse",
    "AgentStubEndpoint",
    "AgentStubConfigEnvUpdateRequest",
    "AgentStubConfigFileItem",
    "AgentStubConfigFileItemsResponse",
    "AgentStubConfigFileRef",
    "AgentStubConfigManifestResponse",
    "AgentStubConfigNoteUpdateRequest",
    "AgentStubConfigPushFileItem",
    "AgentStubConfigPushRequest",
    "AgentStubConfigPushResponse",
    "AgentStubConfigPushSkillItem",
    "AgentStubConfigSkillItem",
    "AgentStubConfigSkillItemsResponse",
    "AgentStubConfigVersionInfo",
    "AgentStubDriveCommitItem",
    "AgentStubDriveCommitRequest",
    "AgentStubDriveCommitResponse",
    "AgentStubDriveFileRef",
    "AgentStubDriveItem",
    "AgentStubDriveManifestResponse",
    "AgentStubFileDownloadRequest",
    "AgentStubFileDownloadResponse",
    "AgentStubFileMapping",
    "AgentStubFileUploadRequest",
    "AgentStubFileUploadResponse",
    "AgentStubURLScheme",
    "agent_stub_config_env_url",
    "agent_stub_config_file_pull_url",
    "agent_stub_config_manifest_url",
    "agent_stub_config_note_url",
    "agent_stub_config_push_url",
    "agent_stub_config_skill_inspect_url",
    "agent_stub_config_skill_pull_url",
    "agent_stub_connections_url",
    "agent_stub_drive_base_for_ref",
    "agent_stub_drive_commit_url",
    "agent_stub_drive_manifest_url",
    "agent_stub_file_download_request_url",
    "agent_stub_file_upload_request_url",
    "is_canonical_dify_file_reference",
    "normalize_agent_stub_api_base_url",
    "parse_agent_stub_endpoint",
]
