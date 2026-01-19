from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.tools.entities.tool_entities import ToolProviderType

from .assets import AssetItem


class ToolFieldConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    value: Any
    auto: bool = False


class ToolConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[ToolFieldConfig] = Field(default_factory=list)

    def default_values(self) -> dict[str, Any]:
        return {field.id: field.value for field in self.fields if field.value is not None}


class ToolReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str = Field(description="Unique identifier for this tool reference")
    type: ToolProviderType = Field(description="Tool provider type")
    provider: str = Field(description="Tool provider")
    tool_name: str = Field(description="Tool name")
    credential_id: str | None = Field(default=None, description="Credential ID")
    configuration: ToolConfiguration | None = Field(default=None, description="Tool configuration")


class FileReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(description="Source location or identifier of the file")
    uuid: str = Field(description="Unique identifier for this file reference")


class SkillMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    tools: dict[str, ToolReference] = Field(default_factory=dict, description="Map of tool references by UUID")
    files: list[FileReference] = Field(default_factory=list, description="List of file references")


@dataclass
class SkillAsset(AssetItem):
    storage_key: str
    metadata: SkillMetadata

    def get_storage_key(self) -> str:
        return self.storage_key
