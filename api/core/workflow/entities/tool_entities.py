from enum import StrEnum

from pydantic import BaseModel, Field

from core.file import File


class ToolResultStatus(StrEnum):
    SUCCESS = "success"
    ERROR = "error"


class ToolCall(BaseModel):
    id: str | None = Field(default=None, description="Unique identifier for this tool call")
    name: str | None = Field(default=None, description="Name of the tool being called")
    arguments: str | None = Field(default=None, description="Accumulated tool arguments JSON")


class ToolResult(BaseModel):
    id: str | None = Field(default=None, description="Identifier of the tool call this result belongs to")
    name: str | None = Field(default=None, description="Name of the tool")
    output: str | None = Field(default=None, description="Tool output text, error or success message")
    files: list[str] = Field(default_factory=list, description="File produced by tool")
    status: ToolResultStatus | None = Field(default=ToolResultStatus.SUCCESS, description="Tool execution status")


class ToolCallResult(BaseModel):
    id: str | None = Field(default=None, description="Identifier for the tool call")
    name: str | None = Field(default=None, description="Name of the tool")
    arguments: str | None = Field(default=None, description="Accumulated tool arguments JSON")
    output: str | None = Field(default=None, description="Tool output text, error or success message")
    files: list[File] = Field(default_factory=list, description="File produced by tool")
    status: ToolResultStatus = Field(default=ToolResultStatus.SUCCESS, description="Tool execution status")
