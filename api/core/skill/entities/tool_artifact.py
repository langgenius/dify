from pydantic import BaseModel, ConfigDict, Field

from core.app_assets.entities import ToolReference
from core.tools.entities.tool_entities import ToolProviderType


class ToolDependency(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ToolProviderType
    provider: str
    tool_name: str


class ToolArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dependencies: list[ToolDependency] = Field(default_factory=list, description="List of tool dependencies")

    references: list[ToolReference] = Field(default_factory=list, description="List of tool references")

    """
    Filter the tool artifact to only include the given tools

    :param tools: Tuple of (provider, tool_name)
    :return: Filtered tool artifact
    """

    def is_empty(self) -> bool:
        return not self.dependencies and not self.references

    def filter(self, tools: list[tuple[str, str]]) -> "ToolArtifact":
        tool_names = {f"{provider}.{tool_name}" for provider, tool_name in tools}
        return ToolArtifact(
            dependencies=[
                dependency
                for dependency in self.dependencies
                if f"{dependency.provider}.{dependency.tool_name}" in tool_names
            ],
            references=[
                reference
                for reference in self.references
                if f"{reference.provider}.{reference.tool_name}" in tool_names
            ],
        )
