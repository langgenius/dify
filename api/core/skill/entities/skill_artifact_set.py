from collections.abc import Iterable
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.skill_artifact import SkillArtifact
from core.skill.entities.skill_metadata import ToolReference
from core.skill.entities.tool_artifact import ToolArtifact, ToolDependency


class SkillArtifactSet(BaseModel):
    """
    Compiled index for an entire skill project.

    - Corresponds to a single JSON file in S3
    - Load once, query multiple times
    - All persistence operations handled by SkillManager
    """

    model_config = ConfigDict(extra="forbid")

    assets_id: str = Field(description="Assets ID this artifact set belongs to")
    schema_version: int = Field(default=1, description="Schema version for forward compatibility")
    built_at: datetime | None = Field(default=None, description="Build timestamp")

    items: dict[str, SkillArtifact] = Field(default_factory=dict, description="skill_id -> SkillArtifact")

    dependency_graph: dict[str, list[str]] = Field(
        default_factory=dict,
        description="skill_id -> list of skill_ids it depends on",
    )

    reverse_graph: dict[str, list[str]] = Field(
        default_factory=dict,
        description="skill_id -> list of skill_ids that depend on it",
    )

    def get(self, skill_id: str) -> SkillArtifact | None:
        return self.items.get(skill_id)

    def upsert(self, artifact: SkillArtifact) -> None:
        self.items[artifact.skill_id] = artifact

    def remove(self, skill_id: str) -> None:
        self.items.pop(skill_id, None)
        self.dependency_graph.pop(skill_id, None)
        self.reverse_graph.pop(skill_id, None)
        for deps in self.reverse_graph.values():
            if skill_id in deps:
                deps.remove(skill_id)
        for deps in self.dependency_graph.values():
            if skill_id in deps:
                deps.remove(skill_id)

    def referenced_skill_ids(self, skill_id: str) -> set[str]:
        return set(self.dependency_graph.get(skill_id, []))

    def recompile_group_ids(self, skill_id: str) -> set[str]:
        result: set[str] = {skill_id}
        queue = [skill_id]
        while queue:
            current = queue.pop()
            for dependent in self.reverse_graph.get(current, []):
                if dependent not in result:
                    result.add(dependent)
                    queue.append(dependent)
        return result

    def subset(self, skill_ids: Iterable[str]) -> "SkillArtifactSet":
        skill_id_set = set(skill_ids)
        return SkillArtifactSet(
            assets_id=self.assets_id,
            schema_version=self.schema_version,
            built_at=self.built_at,
            items={sid: self.items[sid] for sid in skill_id_set if sid in self.items},
            dependency_graph={
                sid: [dep for dep in deps if dep in skill_id_set]
                for sid, deps in self.dependency_graph.items()
                if sid in skill_id_set
            },
            reverse_graph={
                sid: [dep for dep in deps if dep in skill_id_set]
                for sid, deps in self.reverse_graph.items()
                if sid in skill_id_set
            },
        )

    def get_tool_artifact(self) -> ToolArtifact:
        dependencies: dict[str, ToolDependency] = {}
        references: dict[str, ToolReference] = {}

        for artifact in self.items.values():
            for dep in artifact.tools.dependencies:
                key = f"{dep.provider}.{dep.tool_name}"
                if key not in dependencies:
                    dependencies[key] = dep

            for ref in artifact.tools.references:
                if ref.uuid not in references:
                    references[ref.uuid] = ref

        return ToolArtifact(
            dependencies=list(dependencies.values()),
            references=list(references.values()),
        )
