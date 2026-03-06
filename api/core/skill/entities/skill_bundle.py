from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from core.app.entities.app_asset_entities import AppAssetFileTree
from core.skill.entities.skill_metadata import FileReference
from core.skill.entities.tool_dependencies import ToolDependencies, ToolDependency

if TYPE_CHECKING:
    from core.skill.entities.skill_metadata import SkillMetadata


class SkillDependance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: ToolDependencies = Field(description="Direct tool dependencies parsed from this skill only")

    files: set[FileReference] = Field(
        default_factory=set,
        description="Direct file references parsed from this skill only",
    )

    def __or__(self, other: "SkillDependance") -> "SkillDependance":
        return SkillDependance(tools=self.tools.merge(other.tools), files=self.files | other.files)

    @staticmethod
    def from_metadata(metadata: "SkillMetadata") -> "SkillDependance":
        """Convert parsed metadata into direct tool/file dependency model."""
        from core.skill.entities.skill_metadata import ToolReference

        dep_map: dict[str, ToolDependency] = {}
        ref_map: dict[str, ToolReference] = {}

        for tool_ref in metadata.tools.values():
            dep_map.setdefault(
                tool_ref.tool_id(),
                ToolDependency(
                    type=tool_ref.type,
                    provider=tool_ref.provider,
                    tool_name=tool_ref.tool_name,
                    enabled=tool_ref.enabled,
                ),
            )
            ref_map.setdefault(tool_ref.uuid, tool_ref)

        return SkillDependance(
            tools=ToolDependencies(
                dependencies=[dep_map[key] for key in sorted(dep_map.keys())],
                references=[ref_map[key] for key in sorted(ref_map.keys())],
            ),
            files=metadata.files,
        )


class Skill(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skill_id: str = Field(description="Unique identifier for this skill, same with skill_id")

    direct_dependance: SkillDependance = Field(description="Direct dependencies parsed from this skill only")

    dependance: SkillDependance = Field(description="All dependencies including transitive closure")

    content: str = Field(description="Resolved content with all references replaced")

    @property
    def tools(self) -> ToolDependencies:
        return self.dependance.tools


class SkillBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_tree: AppAssetFileTree = Field(description="Asset tree for this bundle")

    assets_id: str = Field(description="Assets ID this bundle belongs to")

    skills: dict[str, Skill] = Field(default_factory=dict)

    @property
    def entries(self) -> dict[str, Skill]:
        return self.skills

    def get(self, skill_id: str) -> Skill | None:
        return self.skills.get(skill_id)

    def get_tool_dependencies(self) -> ToolDependencies:
        merged = ToolDependencies()
        for skill in self.skills.values():
            merged = merged.merge(skill.dependance.tools)
        return merged

    def put(self, skill: Skill) -> None:
        self.skills[skill.skill_id] = skill
