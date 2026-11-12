from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum, auto
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class _ToolRuntimeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class ToolRuntimeHandle:
    """Opaque graph-owned handle for a workflow-layer tool runtime.

    Workflow-specific execution context must stay behind `raw` so the graph
    contract does not absorb application-owned concepts.
    """

    raw: object


@dataclass(frozen=True, slots=True)
class ToolRuntimeParameter:
    """Graph-owned parameter shape used by tool nodes."""

    name: str
    required: bool = False


class ToolRuntimeMessage(_ToolRuntimeModel):
    """Graph-owned tool invocation message DTO."""

    class TextMessage(_ToolRuntimeModel):
        """Plain-text tool message payload."""

        text: str

    class JsonMessage(_ToolRuntimeModel):
        """Structured JSON tool message payload."""

        json_object: dict[str, Any] | list[Any]
        suppress_output: bool = Field(default=False)

    class BlobMessage(_ToolRuntimeModel):
        """Binary blob tool message payload."""

        blob: bytes

    class BlobChunkMessage(_ToolRuntimeModel):
        """Chunked binary payload emitted by a tool."""

        id: str
        sequence: int
        total_length: int
        blob: bytes
        end: bool

    class FileMessage(_ToolRuntimeModel):
        """File-marker payload emitted by a tool."""

        file_marker: str = Field(default="file_marker")

    class VariableMessage(_ToolRuntimeModel):
        """Payload used to assign a runtime variable from a tool."""

        variable_name: str
        variable_value: dict[str, Any] | list[Any] | str | int | float | bool | None
        stream: bool = Field(default=False)

    class LogMessage(_ToolRuntimeModel):
        """Structured progress or status log emitted by a tool."""

        class LogStatus(StrEnum):
            """Lifecycle states for a tool log message."""

            START = auto()
            ERROR = auto()
            SUCCESS = auto()

        id: str
        label: str
        parent_id: str | None = None
        error: str | None = None
        status: LogStatus
        data: dict[str, Any]
        metadata: dict[str, Any] = Field(default_factory=dict)

    class RetrieverResourceMessage(_ToolRuntimeModel):
        """Retriever-resource payload emitted by a tool."""

        retriever_resources: list[dict[str, Any]]
        context: str

    class MessageType(StrEnum):
        """Discriminator values for tool runtime messages."""

        TEXT = auto()
        IMAGE = auto()
        LINK = auto()
        BLOB = auto()
        JSON = auto()
        IMAGE_LINK = auto()
        BINARY_LINK = auto()
        VARIABLE = auto()
        FILE = auto()
        LOG = auto()
        BLOB_CHUNK = auto()
        RETRIEVER_RESOURCES = auto()

    type: MessageType = MessageType.TEXT
    message: (
        JsonMessage
        | TextMessage
        | BlobChunkMessage
        | BlobMessage
        | LogMessage
        | FileMessage
        | VariableMessage
        | RetrieverResourceMessage
        | None
    )
    meta: dict[str, Any] | None = None
