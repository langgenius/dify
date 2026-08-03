"""Private Workspace file DTOs resolved through an Execution Binding ref."""

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


class WorkspaceFileEntry(BaseModel):
    name: str
    type: Literal["file", "dir", "symlink", "other"]
    size: int | None = None
    mtime: int | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceListRequest(BaseModel):
    backend_binding_ref: str = Field(min_length=1)
    path: str = "."

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceListResponse(BaseModel):
    path: str
    entries: list[WorkspaceFileEntry]
    truncated: bool

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceReadRequest(BaseModel):
    backend_binding_ref: str = Field(min_length=1)
    path: str
    max_bytes: int = 262144

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceReadResponse(BaseModel):
    path: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceUploadedFile(BaseModel):
    transfer_method: Literal["tool_file"] = "tool_file"
    reference: str
    download_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceUploadRequest(BaseModel):
    backend_binding_ref: str = Field(min_length=1)
    path: str
    execution_context: DifyExecutionContextLayerConfig

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceUploadResponse(BaseModel):
    path: str
    file: WorkspaceUploadedFile

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "WorkspaceFileEntry",
    "WorkspaceListRequest",
    "WorkspaceListResponse",
    "WorkspaceReadRequest",
    "WorkspaceReadResponse",
    "WorkspaceUploadRequest",
    "WorkspaceUploadResponse",
    "WorkspaceUploadedFile",
]
