from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.skill_metadata import ToolReference
from core.tools.entities.tool_entities import ToolProviderType


class ToolDependency(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ToolProviderType
    provider: str
    tool_name: str
    enabled: bool = True

    def tool_id(self) -> str:
        return f"{self.provider}.{self.tool_name}"


class ToolDependencies(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dependencies: list[ToolDependency] = Field(default_factory=list)
    references: list[ToolReference] = Field(default_factory=list)

    def is_empty(self) -> bool:
        return not self.dependencies and not self.references

    def filter(self, tools: list[tuple[str, str]]) -> "ToolDependencies":
        tool_names = {f"{provider}.{tool_name}" for provider, tool_name in tools}
        return ToolDependencies(
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

    def merge(self, other: "ToolDependencies") -> "ToolDependencies":
        dep_map: dict[str, ToolDependency] = {}
        for dep in self.dependencies:
            key = f"{dep.provider}.{dep.tool_name}"
            dep_map[key] = dep
        for dep in other.dependencies:
            key = f"{dep.provider}.{dep.tool_name}"
            if key not in dep_map:
                dep_map[key] = dep

        ref_map: dict[str, ToolReference] = {}
        for ref in self.references:
            ref_map[ref.uuid] = ref
        for ref in other.references:
            if ref.uuid not in ref_map:
                ref_map[ref.uuid] = ref

        return ToolDependencies(
            dependencies=list(dep_map.values()),
            references=list(ref_map.values()),
        )

    def remove_tools(self, tools: list[ToolDependency]) -> "ToolDependencies":
        tool_keys = {f"{tool.provider}.{tool.tool_name}" for tool in tools}
        return ToolDependencies(
            dependencies=[
                dependency
                for dependency in self.dependencies
                if f"{dependency.provider}.{dependency.tool_name}" not in tool_keys
            ],
            references=[
                reference
                for reference in self.references
                if f"{reference.provider}.{reference.tool_name}" not in tool_keys
            ],
        )
