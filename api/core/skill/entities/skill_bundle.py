from collections.abc import Iterable
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.asset_references import AssetReferences
from core.skill.entities.skill_bundle_entry import SkillBundleEntry
from core.skill.entities.skill_metadata import ToolReference
from core.skill.entities.tool_dependencies import ToolDependencies, ToolDependency
from core.skill.graph_utils import collect_reachable, invert_dependency_map


class SkillBundle(BaseModel):
    """Persisted skill compilation snapshot with graph metadata and merge support."""

    model_config = ConfigDict(extra="forbid")

    assets_id: str = Field(description="Assets ID this bundle belongs to")
    schema_version: int = Field(default=2, description="Schema version for forward compatibility")
    built_at: datetime | None = Field(default=None, description="Build timestamp")

    entries: dict[str, SkillBundleEntry] = Field(default_factory=dict, description="skill_id -> SkillBundleEntry")

    depends_on_map: dict[str, list[str]] = Field(
        default_factory=dict,
        description="skill_id -> list of skill_ids it depends on",
    )

    reference_map: dict[str, list[str]] = Field(
        default_factory=dict,
        description="skill_id -> list of skill_ids that depend on it",
    )

    def get(self, skill_id: str) -> SkillBundleEntry | None:
        return self.entries.get(skill_id)

    def upsert(self, entry: SkillBundleEntry) -> None:
        self.entries[entry.skill_id] = entry

    def remove(self, skill_id: str) -> None:
        self.entries.pop(skill_id, None)
        self.depends_on_map.pop(skill_id, None)
        self.reference_map.pop(skill_id, None)
        for deps in self.reference_map.values():
            if skill_id in deps:
                deps.remove(skill_id)
        for deps in self.depends_on_map.values():
            if skill_id in deps:
                deps.remove(skill_id)

    def referenced_skill_ids(self, skill_id: str) -> set[str]:
        return set(self.depends_on_map.get(skill_id, []))

    def recompile_group_ids(self, skill_id: str) -> set[str]:
        return collect_reachable([skill_id], self.reference_map)

    def merge(self, patch: "SkillBundle") -> "SkillBundle":
        """Return a new bundle with patch entries merged and affected closure recomputed."""
        if self.assets_id != patch.assets_id:
            raise ValueError("bundle assets_id mismatch")

        changed_skill_ids = set(patch.entries.keys())
        if not changed_skill_ids:
            return self.model_copy(deep=True)

        merged_entries = dict(self.entries)
        merged_entries.update(patch.entries)

        merged_depends_on_map: dict[str, list[str]] = {
            skill_id: [dep for dep in deps if dep in merged_entries]
            for skill_id, deps in self.depends_on_map.items()
            if skill_id in merged_entries
        }

        for skill_id in changed_skill_ids:
            deps = patch.depends_on_map.get(skill_id)
            if deps is None:
                entry = patch.entries[skill_id]
                deps = [f.asset_id for f in entry.direct_files.references]
            merged_depends_on_map[skill_id] = [dep for dep in _dedupe(deps) if dep in merged_entries]

        for skill_id in merged_entries:
            merged_depends_on_map.setdefault(skill_id, [])

        reference_map = {
            skill_id: sorted(referrers)
            for skill_id, referrers in invert_dependency_map(merged_depends_on_map, merged_entries.keys()).items()
        }

        affected_skill_ids = collect_reachable(changed_skill_ids, reference_map)
        recomputed_entries = _recompute_affected_entries(merged_entries, merged_depends_on_map, affected_skill_ids)
        merged_entries.update(recomputed_entries)

        return SkillBundle(
            assets_id=self.assets_id,
            schema_version=max(self.schema_version, patch.schema_version),
            built_at=patch.built_at or self.built_at,
            entries=merged_entries,
            depends_on_map=dict(merged_depends_on_map),
            reference_map=reference_map,
        )

    def subset(self, skill_ids: Iterable[str]) -> "SkillBundle":
        skill_id_set = set(skill_ids)
        return SkillBundle(
            assets_id=self.assets_id,
            schema_version=self.schema_version,
            built_at=self.built_at,
            entries={sid: self.entries[sid] for sid in skill_id_set if sid in self.entries},
            depends_on_map={
                sid: [dep for dep in deps if dep in skill_id_set]
                for sid, deps in self.depends_on_map.items()
                if sid in skill_id_set
            },
            reference_map={
                sid: [dep for dep in deps if dep in skill_id_set]
                for sid, deps in self.reference_map.items()
                if sid in skill_id_set
            },
        )

    def get_tool_dependencies(self) -> ToolDependencies:
        dependencies: dict[str, ToolDependency] = {}
        references: dict[str, ToolReference] = {}

        for entry in self.entries.values():
            for dep in entry.tools.dependencies:
                key = f"{dep.provider}.{dep.tool_name}"
                if key not in dependencies:
                    dependencies[key] = dep

            for ref in entry.tools.references:
                if ref.uuid not in references:
                    references[ref.uuid] = ref

        return ToolDependencies(
            dependencies=list(dependencies.values()),
            references=list(references.values()),
        )


def _dedupe(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _recompute_affected_entries(
    entries: dict[str, SkillBundleEntry],
    depends_on_map: dict[str, list[str]],
    affected_skill_ids: set[str],
) -> dict[str, SkillBundleEntry]:
    recomputed_entries = {skill_id: entries[skill_id] for skill_id in affected_skill_ids if skill_id in entries}
    changed = True
    while changed:
        changed = False
        for skill_id in affected_skill_ids:
            current_entry = recomputed_entries.get(skill_id)
            if current_entry is None:
                continue

            merged_tool_deps: dict[str, ToolDependency] = {
                dep.tool_id(): dep for dep in current_entry.direct_tools.dependencies
            }
            merged_tool_refs: dict[str, ToolReference] = {
                ref.uuid: ref for ref in current_entry.direct_tools.references
            }
            merged_files = {f.asset_id: f for f in current_entry.direct_files.references}

            for dep_id in depends_on_map.get(skill_id, []):
                dep_entry = recomputed_entries.get(dep_id) or entries.get(dep_id)
                if dep_entry is None:
                    continue

                for dep in dep_entry.tools.dependencies:
                    merged_tool_deps.setdefault(dep.tool_id(), dep)

                for ref in dep_entry.tools.references:
                    merged_tool_refs.setdefault(ref.uuid, ref)

                for file_ref in dep_entry.files.references:
                    merged_files.setdefault(file_ref.asset_id, file_ref)

            merged_tools = ToolDependencies(
                dependencies=[merged_tool_deps[key] for key in sorted(merged_tool_deps.keys())],
                references=[merged_tool_refs[key] for key in sorted(merged_tool_refs.keys())],
            )
            merged_asset_refs = AssetReferences(references=[merged_files[key] for key in sorted(merged_files.keys())])
            if merged_tools != current_entry.tools or merged_asset_refs != current_entry.files:
                recomputed_entries[skill_id] = current_entry.model_copy(
                    update={
                        "tools": merged_tools,
                        "files": merged_asset_refs,
                    }
                )
                changed = True

    return recomputed_entries
