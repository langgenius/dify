from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.tools.entities.tool_entities import ToolProviderType


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


def create_tool_id(provider: str, tool_name: str) -> str:
    return f"{provider}.{tool_name}"


class ToolReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    type: ToolProviderType
    provider: str
    tool_name: str
    enabled: bool = True
    credential_id: str | None = None
    configuration: ToolConfiguration | None = None

    def reference_id(self) -> str:
        return f"{self.provider}.{self.tool_name}.{self.uuid}"

    def tool_id(self) -> str:
        return f"{self.provider}.{self.tool_name}"


class FileReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    asset_id: str


class SkillMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    tools: dict[str, ToolReference] = Field(default_factory=dict)
    files: list[FileReference] = Field(default_factory=list)
