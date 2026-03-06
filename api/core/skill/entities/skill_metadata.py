from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.tools.entities.tool_entities import ToolProviderType


class ToolFieldConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    value: Any
    auto: bool = False


class ToolConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[ToolFieldConfig] = Field(
        default_factory=list, description="List of field configurations for this tool"
    )

    def default_values(self) -> dict[str, Any]:
        return {field.id: field.value for field in self.fields if field.value is not None}


def create_tool_id(provider: str, tool_name: str) -> str:
    return f"{provider}.{tool_name}"


class ToolReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str = Field(
        default="",
        description=(
            "Unique identifier for this tool reference, used to distinguish multiple references to the same tool"
        ),
    )
    type: ToolProviderType = Field(description="The provider type of the tool")
    provider: str = Field(
        default="",
        description="The provider name of the tool plugin. Can be inferred from placeholders during compilation.",
    )
    tool_name: str = Field(
        default="",
        description=(
            "The tool name defined in the provider plugin. Can be inferred from placeholders during compilation."
        ),
    )
    enabled: bool = Field(default=True, description="Whether this tool reference is enabled")
    credential_id: str | None = Field(
        default=None,
        description="Credential ID used to resolve credentials when invoking the tool.",
    )
    configuration: ToolConfiguration | None = Field(
        default=None,
        description=(
            "Optional configuration for this tool reference, used to provide "
            "additional parameters when invoking the tool"
        ),
    )

    def reference_id(self) -> str:
        return f"{self.provider}.{self.tool_name}.{self.uuid}"

    def tool_id(self) -> str:
        return f"{self.provider}.{self.tool_name}"


class FileReference(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: str = Field(default="app")
    asset_id: str

    @model_validator(mode="before")
    @classmethod
    def normalize_input(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if "asset_id" in data and "source" in data:
            return {"source": data.get("source", "app"), "asset_id": data["asset_id"]}
        # front end support
        if "id" in data:
            return {"source": "app", "asset_id": data["id"]}
        return data


class SkillMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: dict[str, ToolReference] = Field(default_factory=dict)
    files: set[FileReference] = Field(default_factory=set)

    @field_validator("files", mode="before")
    @classmethod
    def coerce_files_to_set(cls, v: Any) -> set[FileReference] | Any:
        if isinstance(v, list):
            refs: set[FileReference] = set()
            for item in v:
                if isinstance(item, dict):
                    refs.add(FileReference.model_validate(item))
                elif isinstance(item, FileReference):
                    refs.add(item)
            return refs
        if isinstance(v, dict):
            refs = set()
            for item in v.values():
                if isinstance(item, dict):
                    refs.add(FileReference.model_validate(item))
            return refs
        return v
