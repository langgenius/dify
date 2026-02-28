import hashlib
import re
from collections.abc import Iterable, Mapping
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
from core.skill.graph_utils import invert_dependency_map
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
    """Compile skill documents into full bundles or incremental patches."""

    def __init__(
        self,
        path_resolver: PathResolver | None = None,
        tool_resolver: ToolResolver | None = None,
        config: CompilerConfig | None = None,
    ):
        self._path_resolver = path_resolver
        self._tool_resolver = tool_resolver or DefaultToolResolver()
        self._config = config or CompilerConfig()

    def compile_bundle(
        self,
        documents: Iterable[SkillDocument],
        file_tree: AppAssetFileTree,
        assets_id: str,
    ) -> SkillBundle:
        """Compile all provided documents into a complete persisted bundle."""
        path_resolver = self._path_resolver or FileTreePathResolver(file_tree)
        doc_map = {doc.skill_id: doc for doc in documents}
        entries, metadata_cache = self._compile_documents_direct(doc_map.values(), path_resolver)
        depends_on_map = self._build_depends_on_map(metadata_cache, set(entries.keys()))

        direct_bundle = SkillBundle(
            assets_id=assets_id,
            entries=entries,
            depends_on_map=depends_on_map,
            reference_map=self._build_reference_map(depends_on_map, set(entries.keys())),
        )
        return SkillBundle(assets_id=assets_id).merge(direct_bundle)

    def compile_increment(
        self,
        base_bundle: SkillBundle,
        documents: Iterable[SkillDocument],
        file_tree: AppAssetFileTree,
        base_path: str = "",
    ) -> SkillBundle:
        """Compile changed documents against base bundle and return a merge-ready patch."""
        doc_map = {doc.skill_id: doc for doc in documents}
        if not doc_map:
            return SkillBundle(assets_id=base_bundle.assets_id)

        path_resolver = self._path_resolver or FileTreePathResolver(file_tree, base_path)
        entries, metadata_cache = self._compile_documents_direct(doc_map.values(), path_resolver)
        known_skill_ids = set(base_bundle.entries.keys()) | set(entries.keys())
        depends_on_map = self._build_depends_on_map(metadata_cache, known_skill_ids)

        direct_patch = SkillBundle(
            assets_id=base_bundle.assets_id,
            entries=entries,
            depends_on_map=depends_on_map,
            reference_map=self._build_reference_map(depends_on_map, set(entries.keys())),
        )
        merged_bundle = base_bundle.merge(direct_patch)
        compiled_entries = {
            skill_id: merged_bundle.entries[skill_id] for skill_id in entries if skill_id in merged_bundle.entries
        }

        return SkillBundle(
            assets_id=base_bundle.assets_id,
            schema_version=merged_bundle.schema_version,
            built_at=merged_bundle.built_at,
            entries=compiled_entries,
            depends_on_map=depends_on_map,
            reference_map=self._build_reference_map(depends_on_map, set(compiled_entries.keys())),
        )

    def compile_document(
        self,
        bundle: SkillBundle,
        document: SkillDocument,
        file_tree: AppAssetFileTree,
        base_path: str = "",
    ) -> SkillBundleEntry:
        """Compile one document with bundle context without mutating the bundle."""
        patch = self.compile_increment(bundle, [document], file_tree, base_path)
        entry = patch.get(document.skill_id)
        if entry is not None:
            return entry

        path_resolver = self._path_resolver or FileTreePathResolver(file_tree, base_path)
        metadata = self._parse_metadata(document.content, document.metadata)
        return self._build_direct_entry(document, metadata, path_resolver)

    def put(
        self,
        base_bundle: SkillBundle,
        document: SkillDocument,
        file_tree: AppAssetFileTree,
        base_path: str = "",
    ) -> SkillBundle:
        """Compile one document and merge it into a newly returned bundle."""
        patch = self.compile_increment(base_bundle, [document], file_tree, base_path)
        return base_bundle.merge(patch)

    def compile_all(
        self,
        documents: Iterable[SkillDocument],
        file_tree: AppAssetFileTree,
        assets_id: str,
    ) -> SkillBundle:
        return self.compile_bundle(documents, file_tree, assets_id)

    def compile_one(
        self,
        bundle: SkillBundle,
        document: SkillDocument,
        file_tree: AppAssetFileTree,
        base_path: str = "",
    ) -> SkillBundleEntry:
        return self.compile_document(bundle, document, file_tree, base_path)

    def _compile_documents_direct(
        self,
        documents: Iterable[SkillDocument],
        path_resolver: PathResolver,
    ) -> tuple[dict[str, SkillBundleEntry], dict[str, SkillMetadata]]:
        entries: dict[str, SkillBundleEntry] = {}
        metadata_cache: dict[str, SkillMetadata] = {}
        for doc in documents:
            metadata = self._parse_metadata(doc.content, doc.metadata)
            metadata_cache[doc.skill_id] = metadata
            entries[doc.skill_id] = self._build_direct_entry(doc, metadata, path_resolver)
        return entries, metadata_cache

    def _build_depends_on_map(
        self,
        metadata_cache: Mapping[str, SkillMetadata],
        known_skill_ids: set[str],
    ) -> dict[str, list[str]]:
        depends_on_map: dict[str, list[str]] = {}
        for skill_id, metadata in metadata_cache.items():
            deps: list[str] = []
            seen: set[str] = set()
            for file_ref in metadata.files:
                dep_id = file_ref.asset_id
                if dep_id in known_skill_ids and dep_id not in seen:
                    seen.add(dep_id)
                    deps.append(dep_id)
            depends_on_map[skill_id] = deps
        return depends_on_map

    def _build_reference_map(
        self,
        depends_on_map: Mapping[str, list[str]],
        all_skill_ids: set[str],
    ) -> dict[str, list[str]]:
        return {
            skill_id: sorted(referrers)
            for skill_id, referrers in invert_dependency_map(depends_on_map, all_skill_ids).items()
        }

    def _build_direct_entry(
        self,
        doc: SkillDocument,
        metadata: SkillMetadata,
        path_resolver: PathResolver,
    ) -> SkillBundleEntry:
        direct_tool_deps: dict[str, ToolDependency] = {}
        direct_tool_refs: dict[str, ToolReference] = {}
        for tool_ref in metadata.tools.values():
            direct_tool_deps.setdefault(
                tool_ref.tool_id(),
                ToolDependency(
                    type=tool_ref.type,
                    provider=tool_ref.provider,
                    tool_name=tool_ref.tool_name,
                    enabled=tool_ref.enabled,
                ),
            )
            direct_tool_refs[tool_ref.uuid] = tool_ref

        direct_files: dict[str, FileReference] = {f.asset_id: f for f in metadata.files}
        resolved_content = self._resolve_content(doc.content, metadata, path_resolver, doc.skill_id)

        direct_tools = ToolDependencies(
            dependencies=list(direct_tool_deps.values()),
            references=list(direct_tool_refs.values()),
        )
        direct_file_refs = AssetReferences(references=list(direct_files.values()))

        return SkillBundleEntry(
            skill_id=doc.skill_id,
            source=SourceInfo(
                asset_id=doc.skill_id,
                content_digest=hashlib.sha256(doc.content.encode("utf-8")).hexdigest(),
            ),
            direct_tools=direct_tools,
            direct_files=direct_file_refs,
            tools=ToolDependencies(
                dependencies=list(direct_tool_deps.values()),
                references=list(direct_tool_refs.values()),
            ),
            files=AssetReferences(references=list(direct_files.values())),
            content=resolved_content,
        )

    def _resolve_content(
        self,
        content: str,
        metadata: SkillMetadata,
        path_resolver: PathResolver,
        current_id: str,
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
        self,
        content: str,
        raw_metadata: Mapping[str, Any],
        disabled_tools: list[ToolDependency] | None = None,
    ) -> SkillMetadata:
        tools_raw = dict(raw_metadata.get("tools", {}))
        tools: dict[str, ToolReference] = {}
        disabled_tools_set = {tool.tool_id() for tool in disabled_tools or []}
        tool_iter = re.finditer(r"§\[tool\]\.\[([^\]]+)\]\.\[([^\]]+)\]\.\[([^\]]+)\]§", content)
        for match in tool_iter:
            provider, name, uuid = match.group(1), match.group(2), match.group(3)
            if uuid not in tools_raw:
                continue

            meta = tools_raw[uuid]
            meta_dict = cast(dict[str, Any], meta)
            provider_type = cast(str, meta_dict.get("type"))
            if create_tool_id(provider, name) in disabled_tools_set:
                continue

            tools[uuid] = ToolReference(
                uuid=uuid,
                type=ToolProviderType.value_of(provider_type),
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
