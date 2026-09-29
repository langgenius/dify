"""Private Binding file DTOs resolved through an Execution Binding ref."""

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig

_BINDING_FILE_PREVIEW_MAX_BYTES = 262144


class BindingFileEntry(BaseModel):
    name: str
    type: Literal["file", "dir", "symlink", "other"]
    size: int | None = None
    mtime: int | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BindingFileListRequest(BaseModel):
    backend_binding_ref: str = Field(min_length=1)
    path: str = "."

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BindingFileListResponse(BaseModel):
    path: str
    entries: list[BindingFileEntry]
    truncated: bool

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BindingFileReadRequest(BaseModel):
    backend_binding_ref: str = Field(min_length=1)
    path: str = Field(min_length=1)
    max_bytes: int = Field(
        default=_BINDING_FILE_PREVIEW_MAX_BYTES,
        ge=1,
        le=_BINDING_FILE_PREVIEW_MAX_BYTES,
    )

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BindingFileReadResponse(BaseModel):
    path: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BindingFileDownloadRequest(BaseModel):
    backend_binding_ref: str = Field(min_length=1)
    path: str = Field(min_length=1)
    execution_context: DifyExecutionContextLayerConfig

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BindingFileDownloadResponse(BaseModel):
    reference: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "BindingFileDownloadRequest",
    "BindingFileDownloadResponse",
    "BindingFileEntry",
    "BindingFileListRequest",
    "BindingFileListResponse",
    "BindingFileReadRequest",
    "BindingFileReadResponse",
]
