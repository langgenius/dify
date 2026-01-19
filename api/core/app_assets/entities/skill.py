from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .assets import AssetItem


class ToolType(StrEnum):
    MCP = "mcp"
    BUILTIN = "builtin"


class ToolFieldConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    value: Any
    auto: bool = False


class ToolConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[ToolFieldConfig] = Field(default_factory=list)


class ToolDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ToolType
    credential_id: str | None = None
    configuration: ToolConfiguration = Field(default_factory=ToolConfiguration)


class ToolReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    tool_name: str
    uuid: str
    raw: str


class FileReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    uuid: str
    raw: str


class SkillMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    tools: dict[str, ToolDefinition] = Field(default_factory=dict)


@dataclass
class SkillAsset(AssetItem):
    storage_key: str
    metadata: SkillMetadata
    tool_references: list[ToolReference] = field(default_factory=list)
    file_references: list[FileReference] = field(default_factory=list)

    def get_storage_key(self) -> str:
        return self.storage_key
