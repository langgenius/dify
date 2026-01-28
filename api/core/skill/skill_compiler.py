import hashlib
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, cast

from core.app.entities.app_asset_entities import AppAssetFileTree
from core.skill.entities.asset_references import AssetReferences
from core.skill.entities.skill_bundle import SkillBundle
from core.skill.entities.skill_bundle_entry import SkillBundleEntry, SourceInfo
from core.skill.entities.skill_document import SkillDocument
from core.skill.entities.skill_metadata import (
    FileReference,
    SkillMetadata,
    ToolConfiguration,
    ToolReference,
    create_tool_id,
)
from core.skill.entities.tool_dependencies import ToolDependencies, ToolDependency
from core.tools.entities.tool_entities import ToolProviderType


class PathResolver(Protocol):
    def resolve(self, source_id: str, target_id: str) -> str: ...


class ToolResolver(Protocol):
    def resolve(self, tool_ref: ToolReference) -> str: ...


@dataclass(frozen=True)
class CompilerConfig:
    tool_pattern: re.Pattern[str] = re.compile(r"§\[tool\]\.\[.*?\]\.\[.*?\]\.\[(.*?)\]§")
    # Evolved format: a group of tool placeholders wrapped by "[...]".
    # Example: [§[tool].[provider].[name].[uuid-a]§, §[tool].[provider].[name].[uuid-b]§]
    tool_group_pattern: re.Pattern[str] = re.compile(
        r"\[\s*§\[tool\]\.\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\]§(?:\s*,\s*§\[tool\]\.\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\]§)*\s*\]"
    )
    file_pattern: re.Pattern[str] = re.compile(r"§\[file\]\.\[.*?\]\.\[(.*?)\]§")


class FileTreePathResolver:
    def __init__(self, tree: AppAssetFileTree, base_path: str = ""):
        self._tree = tree
        self._base_path = base_path.rstrip("/")

    def resolve(self, source_id: str, target_id: str) -> str:
        source_node = self._tree.get(source_id)
        target_node = self._tree.get(target_id)

        if target_node is None:
            return "[File not found]"

        if source_node is not None:
            return self._tree.relative_path(source_node, target_node)

        full_path = self._tree.get_path(target_node.id)
        if self._base_path:
            return f"{self._base_path}/{full_path}"
        return full_path


class DefaultToolResolver:
    def resolve(self, tool_ref: ToolReference) -> str:
        # Keep outputs readable for the most common built-in tools.
        if tool_ref.provider == "sandbox" and tool_ref.tool_name == "bash":
            return f"[Bash Command: {tool_ref.tool_name}_{tool_ref.uuid}]"
        if tool_ref.provider == "sandbox" and tool_ref.tool_name == "python":
            return f"[Python Code: {tool_ref.tool_name}_{tool_ref.uuid}]"
        return f"[Executable: {tool_ref.tool_name}_{tool_ref.uuid} --help command]"


class SkillCompiler:
    def __init__(
        self,
        path_resolver: PathResolver | None = None,
        tool_resolver: ToolResolver | None = None,
        config: CompilerConfig | None = None,
    ):
        self._path_resolver = path_resolver
        self._tool_resolver = tool_resolver or DefaultToolResolver()
        self._config = config or CompilerConfig()

    def compile_all(
        self,
        documents: Iterable[SkillDocument],
        file_tree: AppAssetFileTree,
        assets_id: str,
    ) -> SkillBundle:
        path_resolver = self._path_resolver or FileTreePathResolver(file_tree)
        return self._compile_batch_internal(documents, assets_id, path_resolver)

    def compile_one(
        self,
        bundle: SkillBundle,
        document: SkillDocument,
        file_tree: AppAssetFileTree,
        base_path: str = "",
    ) -> SkillBundleEntry:
        path_resolver = self._path_resolver or FileTreePathResolver(file_tree, base_path)
        resolved_content, tool_dependencies = self._compile_template_internal(
            document.content, document.metadata, bundle, path_resolver
        )

        metadata = self._parse_metadata(document.content, document.metadata)
        final_files: dict[str, FileReference] = {f.asset_id: f for f in metadata.files}

        return SkillBundleEntry(
            skill_id=document.skill_id,
            source=SourceInfo(
                asset_id=document.skill_id,
                content_digest=hashlib.sha256(document.content.encode("utf-8")).hexdigest(),
            ),
            tools=tool_dependencies,
            files=AssetReferences(references=list(final_files.values())),
            content=resolved_content,
        )

    def _compile_batch_internal(
        self,
        documents: Iterable[SkillDocument],
        assets_id: str,
        path_resolver: PathResolver,
    ) -> SkillBundle:
        doc_map = {doc.skill_id: doc for doc in documents}
        graph: dict[str, set[str]] = {}
        metadata_cache: dict[str, SkillMetadata] = {}

        # Phase 1: Parse metadata and build dependency graph
        for doc in doc_map.values():
            metadata = self._parse_metadata(doc.content, doc.metadata)
            metadata_cache[doc.skill_id] = metadata

            deps: set[str] = set()
            for file_ref in metadata.files:
                if file_ref.asset_id in doc_map:
                    deps.add(file_ref.asset_id)
            graph[doc.skill_id] = deps

        bundle = SkillBundle(assets_id=assets_id)
        bundle.dependency_graph = {k: list(v) for k, v in graph.items()}

        # Build reverse graph for propagation
        reverse_graph: dict[str, set[str]] = {skill_id: set() for skill_id in doc_map}
        for skill_id, deps in graph.items():
            for dep_id in deps:
                if dep_id in reverse_graph:
                    reverse_graph[dep_id].add(skill_id)
        bundle.reverse_graph = {k: list(v) for k, v in reverse_graph.items()}

        # Phase 2: Compile each skill independently (content + direct dependencies only)
        for skill_id, doc in doc_map.items():
            metadata = metadata_cache[skill_id]
            entry = self._compile_node_direct(doc, metadata, path_resolver)
            bundle.upsert(entry)

        # Phase 3: Propagate transitive dependencies until fixed-point
        self._propagate_transitive_dependencies(bundle, graph)

        return bundle

    def _compile_node_direct(
        self,
        doc: SkillDocument,
        metadata: SkillMetadata,
        path_resolver: PathResolver,
    ) -> SkillBundleEntry:
        """Compile a single skill with only its direct dependencies (no transitive)."""
        direct_tools: dict[str, ToolDependency] = {}
        direct_refs: dict[str, ToolReference] = {}

        for tool_ref in metadata.tools.values():
            key = tool_ref.tool_id()
            if key not in direct_tools:
                direct_tools[key] = ToolDependency(
                    type=tool_ref.type,
                    provider=tool_ref.provider,
                    tool_name=tool_ref.tool_name,
                )
            direct_refs[tool_ref.uuid] = tool_ref

        direct_files: dict[str, FileReference] = {f.asset_id: f for f in metadata.files}
        resolved_content = self._resolve_content(doc.content, metadata, path_resolver, doc.skill_id)

        return SkillBundleEntry(
            skill_id=doc.skill_id,
            source=SourceInfo(
                asset_id=doc.skill_id,
                content_digest=hashlib.sha256(doc.content.encode("utf-8")).hexdigest(),
            ),
            tools=ToolDependencies(
                dependencies=list(direct_tools.values()),
                references=list(direct_refs.values()),
            ),
            files=AssetReferences(
                references=list(direct_files.values()),
            ),
            content=resolved_content,
        )

    def _propagate_transitive_dependencies(
        self,
        bundle: SkillBundle,
        graph: dict[str, set[str]],
    ) -> None:
        """Iteratively propagate transitive dependencies until no changes occur."""
        changed = True
        while changed:
            changed = False
            for skill_id, dep_ids in graph.items():
                entry = bundle.get(skill_id)
                if not entry:
                    continue

                # Collect current tools and files
                current_tools: dict[str, ToolDependency] = {d.tool_id(): d for d in entry.tools.dependencies}
                current_refs: dict[str, ToolReference] = {r.uuid: r for r in entry.tools.references}
                current_files: dict[str, FileReference] = {f.asset_id: f for f in entry.files.references}

                original_tool_count = len(current_tools)
                original_ref_count = len(current_refs)
                original_file_count = len(current_files)

                # Merge from dependencies
                for dep_id in dep_ids:
                    dep_entry = bundle.get(dep_id)
                    if not dep_entry:
                        continue

                    for tool_dep in dep_entry.tools.dependencies:
                        key = tool_dep.tool_id()
                        if key not in current_tools:
                            current_tools[key] = tool_dep

                    for tool_ref in dep_entry.tools.references:
                        if tool_ref.uuid not in current_refs:
                            current_refs[tool_ref.uuid] = tool_ref

                    for file_ref in dep_entry.files.references:
                        if file_ref.asset_id not in current_files:
                            current_files[file_ref.asset_id] = file_ref

                # Check if anything changed
                if (
                    len(current_tools) != original_tool_count
                    or len(current_refs) != original_ref_count
                    or len(current_files) != original_file_count
                ):
                    changed = True
                    # Update the entry with new transitive dependencies
                    updated_entry = SkillBundleEntry(
                        skill_id=entry.skill_id,
                        source=entry.source,
                        tools=ToolDependencies(
                            dependencies=list(current_tools.values()),
                            references=list(current_refs.values()),
                        ),
                        files=AssetReferences(
                            references=list(current_files.values()),
                        ),
                        content=entry.content,
                    )
                    bundle.upsert(updated_entry)

    def _compile_template_internal(
        self,
        content: str,
        metadata_dict: Mapping[str, Any],
        context: SkillBundle,
        path_resolver: PathResolver,
    ) -> tuple[str, ToolDependencies]:
        metadata = self._parse_metadata(content, metadata_dict)

        direct_deps: list[SkillBundleEntry] = []
        for file_ref in metadata.files:
            artifact = context.get(file_ref.asset_id)
            if artifact:
                direct_deps.append(artifact)

        final_tools, final_refs = self._aggregate_dependencies(metadata, direct_deps)

        resolved_content = self._resolve_content(content, metadata, path_resolver, current_id="<template>")

        return resolved_content, ToolDependencies(
            dependencies=list(final_tools.values()), references=list(final_refs.values())
        )

    def _compile_node(
        self,
        doc: SkillDocument,
        metadata: SkillMetadata,
        direct_deps: Sequence[SkillBundleEntry],
        path_resolver: PathResolver,
    ) -> SkillBundleEntry:
        final_tools, final_refs = self._aggregate_dependencies(metadata, direct_deps)

        final_files: dict[str, FileReference] = {}
        for f in metadata.files:
            final_files[f.asset_id] = f

        for dep in direct_deps:
            for f in dep.files.references:
                if f.asset_id not in final_files:
                    final_files[f.asset_id] = f

        resolved_content = self._resolve_content(doc.content, metadata, path_resolver, doc.skill_id)

        return SkillBundleEntry(
            skill_id=doc.skill_id,
            source=SourceInfo(
                asset_id=doc.skill_id,
                content_digest=hashlib.sha256(doc.content.encode("utf-8")).hexdigest(),
            ),
            tools=ToolDependencies(
                dependencies=list(final_tools.values()),
                references=list(final_refs.values()),
            ),
            files=AssetReferences(
                references=list(final_files.values()),
            ),
            content=resolved_content,
        )

    def _aggregate_dependencies(
        self, metadata: SkillMetadata, direct_deps: Sequence[SkillBundleEntry]
    ) -> tuple[dict[str, ToolDependency], dict[str, ToolReference]]:
        all_tools: dict[str, ToolDependency] = {}
        all_refs: dict[str, ToolReference] = {}

        for tool_ref in metadata.tools.values():
            key = tool_ref.tool_id()
            if key not in all_tools:
                all_tools[key] = ToolDependency(
                    type=tool_ref.type,
                    provider=tool_ref.provider,
                    tool_name=tool_ref.tool_name,
                )
            all_refs[tool_ref.uuid] = tool_ref

        for dep in direct_deps:
            for tool_dep in dep.tools.dependencies:
                key = tool_dep.tool_id()
                if key not in all_tools:
                    all_tools[key] = tool_dep

            for tool_ref in dep.tools.references:
                if tool_ref.uuid not in all_refs:
                    all_refs[tool_ref.uuid] = tool_ref

        return all_tools, all_refs

    def _resolve_content(
        self, content: str, metadata: SkillMetadata, path_resolver: PathResolver, current_id: str
    ) -> str:
        def replace_file(match: re.Match[str]) -> str:
            target_id = match.group(1)
            try:
                return path_resolver.resolve(current_id, target_id)
            except Exception:
                return match.group(0)

        def replace_tool(match: re.Match[str]) -> str:
            tool_id = match.group(1)
            tool_ref: ToolReference | None = metadata.tools.get(tool_id)
            if not tool_ref:
                return f"[Tool not found or disabled: {tool_id}]"
            if not tool_ref.enabled:
                return ""
            return self._tool_resolver.resolve(tool_ref)

        def replace_tool_group(match: re.Match[str]) -> str:
            group_text = match.group(0)
            enabled_renders: list[str] = []

            for tool_match in self._config.tool_pattern.finditer(group_text):
                tool_id = tool_match.group(1)
                tool_ref: ToolReference | None = metadata.tools.get(tool_id)
                if not tool_ref:
                    enabled_renders.append(f"[Tool not found or disabled: {tool_id}]")
                    continue
                if not tool_ref.enabled:
                    continue
                enabled_renders.append(self._tool_resolver.resolve(tool_ref))

            if not enabled_renders:
                return ""
            return "[" + ", ".join(enabled_renders) + "]"

        content = self._config.file_pattern.sub(replace_file, content)
        content = self._config.tool_group_pattern.sub(replace_tool_group, content)
        content = self._config.tool_pattern.sub(replace_tool, content)
        return content

    def _parse_metadata(
        self, content: str, raw_metadata: Mapping[str, Any], disabled_tools: list[ToolDependency] = []
    ) -> SkillMetadata:
        tools_raw = dict(raw_metadata.get("tools", {}))
        tools: dict[str, ToolReference] = {}
        disabled_tools_set = {tool.tool_id() for tool in disabled_tools}
        tool_iter = re.finditer(r"§\[tool\]\.\[([^\]]+)\]\.\[([^\]]+)\]\.\[([^\]]+)\]§", content)
        for match in tool_iter:
            provider, name, uuid = match.group(1), match.group(2), match.group(3)
            if uuid in tools_raw:
                meta = tools_raw[uuid]
                meta_dict = cast(dict[str, Any], meta)
                type = cast(str, meta_dict.get("type"))
                if create_tool_id(provider, name) in disabled_tools_set:
                    continue
                tools[uuid] = ToolReference(
                    uuid=uuid,
                    type=ToolProviderType.value_of(type),
                    provider=provider,
                    tool_name=name,
                    enabled=cast(bool, meta_dict.get("enabled", True)),
                    credential_id=cast(str | None, meta_dict.get("credential_id")),
                    configuration=ToolConfiguration.model_validate(meta_dict.get("configuration", {}))
                    if meta_dict.get("configuration")
                    else None,
                )

        parsed_files: list[FileReference] = []
        file_iter = re.finditer(r"§\[file\]\.\[([^\]]+)\]\.\[([^\]]+)\]§", content)
        for match in file_iter:
            source, asset_id = match.group(1), match.group(2)
            parsed_files.append(FileReference(source=source, asset_id=asset_id))

        return SkillMetadata(tools=tools, files=parsed_files)
