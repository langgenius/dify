"""Client-safe DTOs and endpoint parsing for the Agent Stub HTTP protocol.

The Agent Stub contract is shared by the HTTP router, the sandbox-visible CLI,
and tests. Control-plane requests always validate into
these Pydantic DTOs before business logic runs, while token issuance and JWE
validation stay under ``dify_agent.agent_stub.server.tokens.agent_stub`` so the
default package remains free of server-only crypto dependencies.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from typing import ClassVar, Final, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, JsonValue, model_validator

AGENT_STUB_PROTOCOL_VERSION: Final[int] = 1
AGENT_STUB_API_BASE_URL_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_API_BASE_URL"
AGENT_STUB_AUTH_JWE_ENV_VAR: Final[str] = "DIFY_AGENT_STUB_AUTH_JWE"

type AgentStubURLScheme = Literal["http", "https"]


@dataclass(frozen=True, slots=True)
class AgentStubEndpoint:
    """Validated Agent Stub endpoint with normalized transport metadata."""

    url: str
    scheme: AgentStubURLScheme
    host: str
    port: int | None
    path: str


def parse_agent_stub_endpoint(url: str) -> AgentStubEndpoint:
    """Parse an HTTP(S) Agent Stub endpoint and normalize its API root."""
    stripped = url.strip()
    if not stripped:
        raise ValueError("Agent Stub URL must not be empty")
    parsed = urlsplit(stripped)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Agent Stub URL must use http or https")
    if not parsed.netloc:
        raise ValueError("Agent Stub URL must include a host")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Agent Stub URL must not include user info")
    if parsed.query or parsed.fragment:
        raise ValueError("Agent Stub URL must not include a query string or fragment")
    if parsed.hostname is None:
        raise ValueError("Agent Stub URL must include a host")

    scheme = parsed.scheme
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


def agent_stub_config_manifest_url(base_url: str) -> str:
    """Return the stable HTTP config-manifest endpoint URL for one base URL."""
    return f"{_require_http_base_url(base_url)}/config/manifest"


def agent_stub_config_skill_inspect_url(base_url: str, name: str) -> str:
    return f"{_require_http_base_url(base_url)}/config/skills/{name}/inspect"


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


class AgentStubConfigDownloadSource(BaseModel):
    """Config asset selected by name within the authenticated Config target."""

    kind: Literal["file", "skill"]
    name: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_name(self) -> "AgentStubConfigDownloadSource":
        normalized = self.name.strip()
        if (
            not normalized
            or normalized in {".", ".."}
            or "/" in normalized
            or "\\" in normalized
            or "\x00" in normalized
            or any(ord(char) < 0x20 for char in normalized)
        ):
            raise ValueError("config asset name must be a safe path segment")
        if self.kind == "skill" and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", normalized) is None:
            raise ValueError("config skill name is invalid")
        self.name = normalized
        return self


class AgentStubFileDownloadRequest(BaseModel):
    """Request one file URL for a specific consumer audience.

    ``for_frontend=True`` allocates a frontend-display URL that the CLI only
    returns to its caller. ``False`` allocates a Sandbox byte-transfer URL that
    the CLI immediately fetches. The deprecated HTTP input name
    ``for_external`` remains accepted for one compatibility cycle.
    """

    file: AgentStubFileMapping | None = None
    config: AgentStubConfigDownloadSource | None = None
    for_frontend: bool = Field(
        default=True,
        validation_alias=AliasChoices("for_frontend", "for_external"),
    )

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_source(self) -> "AgentStubFileDownloadRequest":
        if (self.file is None) == (self.config is None):
            raise ValueError("exactly one of file or config is required")
        if self.config is not None and self.for_frontend:
            raise ValueError("config downloads are available only to the Sandbox data plane")
        return self


class AgentStubFileDownloadResponse(BaseModel):
    """Response body containing download metadata plus the signed URL."""

    filename: str
    mime_type: str | None = None
    size: int
    download_url: str


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
    return parse_agent_stub_endpoint(base_url).url


__all__ = [
    "AGENT_STUB_AUTH_JWE_ENV_VAR",
    "AGENT_STUB_PROTOCOL_VERSION",
    "AGENT_STUB_API_BASE_URL_ENV_VAR",
    "AgentStubConnectRequest",
    "AgentStubConnectResponse",
    "AgentStubEndpoint",
    "AgentStubConfigEnvUpdateRequest",
    "AgentStubConfigDownloadSource",
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
    "AgentStubFileDownloadRequest",
    "AgentStubFileDownloadResponse",
    "AgentStubFileMapping",
    "AgentStubFileUploadRequest",
    "AgentStubFileUploadResponse",
    "AgentStubURLScheme",
    "agent_stub_config_env_url",
    "agent_stub_config_manifest_url",
    "agent_stub_config_note_url",
    "agent_stub_config_push_url",
    "agent_stub_config_skill_inspect_url",
    "agent_stub_connections_url",
    "agent_stub_file_download_request_url",
    "agent_stub_file_upload_request_url",
    "is_canonical_dify_file_reference",
    "normalize_agent_stub_api_base_url",
    "parse_agent_stub_endpoint",
]
