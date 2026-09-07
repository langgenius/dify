"""Versioned, read-only KnowledgeFS CLI contract shared by API, Stub and runtime.

The command has no tenant, namespace, URL, credential or policy fields. Those
are supplied separately by trusted run orchestration, never by the CLI.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


KNOWLEDGE_FS_PROTOCOL_VERSION = 1
KNOWLEDGE_FS_MAX_COMMANDS = 64
KNOWLEDGE_FS_MAX_OUTPUT_BYTES = 1024 * 1024
KNOWLEDGE_FS_MAX_RESULT_BYTES = 64 * 1024
KNOWLEDGE_FS_MAX_IMAGES = 8
KNOWLEDGE_FS_COMMAND_TIMEOUT = 60
KNOWLEDGE_FS_SESSION_TTL = 45
KNOWLEDGE_FS_RUN_BUDGET_TTL = 2 * 60 * 60

type KnowledgeFsCommandName = Literal[
    "spaces", "capabilities", "search", "ls", "tree", "find", "grep", "cat", "stat", "diff", "open", "images", "image"
]


class KnowledgeFsBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(min_length=1, max_length=255)
    control_space_id: str = Field(min_length=36, max_length=36)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("control_space_id")
    @classmethod
    def validate_space_id(cls, value: str) -> str:
        return str(UUID(value))


class KnowledgeFsCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = KNOWLEDGE_FS_PROTOCOL_VERSION
    command_id: UUID
    command: KnowledgeFsCommandName
    space: str | None = Field(default=None, min_length=1, max_length=255)
    query: str | None = Field(default=None, min_length=1, max_length=4000)
    path: str | None = Field(default=None, max_length=4096)
    old_path: str | None = Field(default=None, max_length=4096)
    new_path: str | None = Field(default=None, max_length=4096)
    cursor: str | None = Field(default=None, min_length=1, max_length=8192)
    limit: int = Field(default=10, ge=1, le=50)
    depth: int = Field(default=2, ge=1, le=4)
    node_id: str | None = Field(default=None, min_length=1, max_length=512)
    receipt_id: str | None = Field(default=None, pattern=r"^kfs_[a-f0-9]{32}$")
    item_id: str | None = Field(default=None, min_length=1, max_length=512)
    image_file_ids: list[UUID] = Field(default_factory=list, max_length=4)

    @field_validator("path", "old_path", "new_path")
    @classmethod
    def validate_read_path(cls, value: str | None) -> str | None:
        if value is None:
            return value
        parts = value.split("/")
        if (
            (not value.startswith("/knowledge/") and value != "/knowledge")
            or any(part in {".", ".."} or any(ord(char) < 33 or char in "%\\?#" for char in part) for part in parts[1:])
            or any(not part for part in parts[1:])
        ):
            raise ValueError("only canonical /knowledge paths are readable")
        return value

    @model_validator(mode="after")
    def validate_command_arguments(self) -> KnowledgeFsCommand:
        allowed: dict[str, set[str]] = {
            "spaces": set(),
            "capabilities": set(),
            "search": {"query", "image_file_ids", "limit"},
            "ls": {"path", "limit", "cursor"},
            "tree": {"path", "limit", "cursor", "depth"},
            "find": {"path", "query", "limit", "cursor"},
            "grep": {"path", "query", "limit", "cursor"},
            "cat": {"path", "limit", "cursor"},
            "stat": {"path"},
            "diff": {"old_path", "new_path"},
            "open": {"node_id", "receipt_id"},
            "images": {"receipt_id", "limit", "cursor"},
            "image": {"receipt_id", "item_id"},
        }
        supplied = self.model_fields_set - {"version", "command_id", "command", "space"}
        if self.command == "find" and len(self.query or "") > 240:
            raise ValueError("find query must not exceed 240 characters")
        if self.node_id is not None:
            self.node_id = str(UUID(self.node_id))
        if supplied - allowed[self.command]:
            raise ValueError("unsupported arguments for this read-only command")
        if self.command == "spaces":
            if self.space is not None:
                raise ValueError("spaces does not accept a space selector")
            return self
        if not self.space:
            raise ValueError("space is required")
        if self.command in {"ls", "tree", "find", "grep", "cat", "stat"} and not self.path:
            raise ValueError("path is required")
        if self.command in {"find", "grep"} and not (self.query or "").strip():
            raise ValueError("query is required")
        if self.command == "search" and not (self.query or "").strip() and not self.image_file_ids:
            raise ValueError("search requires text or authorized image files")
        if self.command == "diff" and not (self.old_path and self.new_path):
            raise ValueError("diff requires both paths")
        if self.command == "open" and bool(self.node_id) == bool(self.receipt_id):
            raise ValueError("open requires exactly one node ID or receipt")
        if self.command in {"images", "image"} and not self.receipt_id:
            raise ValueError("a previously issued evidence receipt is required")
        if self.command == "image" and not self.item_id:
            raise ValueError("image requires an item ID from images")
        if len(self.image_file_ids) != len(set(self.image_file_ids)):
            raise ValueError("duplicate query image")
        return self


class KnowledgeFsCitation(BaseModel):
    """Immutable evidence identity; no signed URLs, tokens or storage keys."""

    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^kfs_[a-f0-9]{32}$")
    control_space_id: str = Field(min_length=36, max_length=36)
    space_name: str = Field(min_length=1, max_length=120)
    node_id: str = Field(min_length=1, max_length=512)
    document_asset_id: str = Field(min_length=1, max_length=512)
    artifact_hash: str = Field(min_length=1, max_length=255)
    document_version: int | None = Field(default=None, ge=1)
    parse_artifact_id: str | None = Field(default=None, max_length=512)
    document_title: str | None = Field(default=None, max_length=2000)
    page_number: int | None = Field(default=None, ge=0)
    section_path: list[str] = Field(default_factory=list, max_length=64)
    start_offset: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, ge=0)

    @field_validator("section_path")
    @classmethod
    def bounded_sections(cls, value: list[str]) -> list[str]:
        if any(len(section) > 1000 for section in value):
            raise ValueError("section title exceeds the limit")
        return value


class KnowledgeFsCommandResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = KNOWLEDGE_FS_PROTOCOL_VERSION
    command_id: UUID
    command: KnowledgeFsCommandName
    status: Literal["ok", "error"] = "ok"
    code: str | None = None
    message: str | None = None
    data: JsonValue = None
    citations: list[KnowledgeFsCitation] = Field(default_factory=list, max_length=50)
    trace_id: str | None = None


class KnowledgeFsPrepareRequest(BaseModel):
    """Server-to-server envelope, never accepted from a sandbox unwrapped."""

    model_config = ConfigDict(extra="forbid")
    execution_context: DifyExecutionContextLayerConfig
    bindings: list[KnowledgeFsBinding] = Field(min_length=1, max_length=10)
    agent_supports_vision: bool = False
    command: KnowledgeFsCommand
    citation: KnowledgeFsCitation | None = None


class KnowledgeFsPreparedRequest(BaseModel):
    """Private authorization result. The Stub must never return this to the CLI."""

    model_config = ConfigDict(extra="forbid")
    operation: str
    url: str | None = None
    method: Literal["GET", "POST"] = "GET"
    headers: dict[str, str] = Field(default_factory=dict, repr=False)
    query: dict[str, str] = Field(default_factory=dict)
    payload: dict[str, JsonValue] | None = None
    data: JsonValue = None
    max_response_bytes: int = Field(default=1024 * 1024, ge=1, le=4 * 1024 * 1024)
    binding: KnowledgeFsBinding | None = None
    response_kind: Literal["json", "image", "local"] = "json"
    trace_id: str | None = None


class KnowledgeFsError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code, self.message, self.status_code = code, message, status_code
        super().__init__(message)
