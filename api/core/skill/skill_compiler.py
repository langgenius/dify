import hashlib
import logging
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

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
)
from core.skill.entities.tool_dependencies import ToolDependencies, ToolDependency
from core.tools.entities.tool_entities import ToolProviderType

logger = logging.getLogger(__name__)

TOOL_REFERENCE_PATTERN = re.compile(r"§\[tool\]\.\[([^\]]+)\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")
FILE_REFERENCE_PATTERN = re.compile(r"§\[file\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")


class SkillCompiler:
    def _parse_metadata(self, content: str, raw_metadata: Mapping[str, Any]) -> SkillMetadata:
        tools_raw: dict[str, Any] = dict(raw_metadata.get("tools", {}))
        tools: dict[str, ToolReference] = {}
        files: list[FileReference] = []

        for match in TOOL_REFERENCE_PATTERN.finditer(content):
            tool_id = match.group(3)
            tool_name = match.group(2)
            tool_provider = match.group(1)
            tool_meta = tools_raw.get(tool_id)
            if tool_meta is None:
                continue

            config_raw = tool_meta.get("configuration", {})
            configuration = ToolConfiguration.model_validate(config_raw) if config_raw else None
            tools[tool_id] = ToolReference(
                uuid=tool_id,
                type=ToolProviderType.value_of(tool_meta.get("type")),
                provider=tool_provider,
                tool_name=tool_name,
                credential_id=tool_meta.get("credential_id"),
                configuration=configuration,
            )

        for match in FILE_REFERENCE_PATTERN.finditer(content):
            files.append(
                FileReference(
                    source=match.group(1),
                    asset_id=match.group(2),
                )
            )

        return SkillMetadata(tools=tools, files=files)

    def compile_all(
        self,
        documents: list[SkillDocument],
        file_tree: AppAssetFileTree,
        assets_id: str,
    ) -> SkillBundle:
        bundle = SkillBundle(
            assets_id=assets_id,
            built_at=datetime.now(UTC),
        )

        doc_map: dict[str, SkillDocument] = {doc.skill_id: doc for doc in documents}
        parsed_metadata: dict[str, SkillMetadata] = {}

        for doc in documents:
            metadata = self._parse_metadata(doc.content, doc.metadata)
            parsed_metadata[doc.skill_id] = metadata
            direct_skill_refs = self._extract_skill_refs(metadata, doc_map)
            bundle.dependency_graph[doc.skill_id] = list(direct_skill_refs)
            for ref_id in direct_skill_refs:
                if ref_id not in bundle.reverse_graph:
                    bundle.reverse_graph[ref_id] = []
                bundle.reverse_graph[ref_id].append(doc.skill_id)

        for doc in documents:
            metadata = parsed_metadata[doc.skill_id]
            entry = self._compile_single(doc, metadata, bundle, parsed_metadata, file_tree)
            bundle.upsert(entry)

        return bundle

    def compile_one(
        self,
        bundle: SkillBundle,
        document: SkillDocument,
        file_tree: AppAssetFileTree,
        all_documents: dict[str, SkillDocument] | None = None,
    ) -> SkillBundleEntry:
        doc_map = all_documents or {}
        if document.skill_id not in doc_map:
            doc_map[document.skill_id] = document

        parsed_metadata: dict[str, SkillMetadata] = {}
        for skill_id, doc in doc_map.items():
            parsed_metadata[skill_id] = self._parse_metadata(doc.content, doc.metadata)

        metadata = parsed_metadata[document.skill_id]
        direct_skill_refs = self._extract_skill_refs(metadata, doc_map)
        bundle.dependency_graph[document.skill_id] = list(direct_skill_refs)
        for ref_id in direct_skill_refs:
            if ref_id not in bundle.reverse_graph:
                bundle.reverse_graph[ref_id] = []
            if document.skill_id not in bundle.reverse_graph[ref_id]:
                bundle.reverse_graph[ref_id].append(document.skill_id)

        return self._compile_single(document, metadata, bundle, parsed_metadata, file_tree)

    def _compile_single(
        self,
        document: SkillDocument,
        metadata: SkillMetadata,
        bundle: SkillBundle,
        parsed_metadata: dict[str, SkillMetadata],
        file_tree: AppAssetFileTree,
    ) -> SkillBundleEntry:
        all_tools, all_files = self._compute_transitive_closure(document.skill_id, bundle, parsed_metadata)

        current_node = file_tree.get(document.skill_id)

        resolved_content = self._resolve_content(document.content, metadata, current_node, file_tree)

        content_digest = hashlib.sha256(document.content.encode("utf-8")).hexdigest()

        return SkillBundleEntry(
            skill_id=document.skill_id,
            source=SourceInfo(
                asset_id=document.skill_id,
                content_digest=content_digest,
            ),
            tools=ToolDependencies(
                dependencies=list(all_tools.values()),
                references=list(metadata.tools.values()),
            ),
            files=AssetReferences(
                references=list(all_files.values()),
            ),
            content=resolved_content,
        )

    def _extract_skill_refs(
        self,
        metadata: SkillMetadata,
        doc_map: dict[str, SkillDocument],
    ) -> set[str]:
        skill_refs: set[str] = set()
        for file_ref in metadata.files:
            if file_ref.asset_id in doc_map:
                skill_refs.add(file_ref.asset_id)
        return skill_refs

    def _compute_transitive_closure(
        self,
        skill_id: str,
        bundle: SkillBundle,
        parsed_metadata: dict[str, SkillMetadata],
    ) -> tuple[dict[str, ToolDependency], dict[str, FileReference]]:
        all_tools: dict[str, ToolDependency] = {}
        all_files: dict[str, FileReference] = {}

        visited: set[str] = set()
        queue = [skill_id]

        while queue:
            current_id = queue.pop(0)
            if current_id in visited:
                continue
            visited.add(current_id)

            metadata = parsed_metadata.get(current_id)
            if metadata is None:
                existing_entry = bundle.get(current_id)
                if existing_entry:
                    for dep in existing_entry.tools.dependencies:
                        key = f"{dep.provider}.{dep.tool_name}"
                        if key not in all_tools:
                            all_tools[key] = dep
                    for file_ref in existing_entry.files.references:
                        if file_ref.asset_id not in all_files:
                            all_files[file_ref.asset_id] = file_ref
                continue

            for tool_ref in metadata.tools.values():
                key = f"{tool_ref.provider}.{tool_ref.tool_name}"
                if key not in all_tools:
                    all_tools[key] = ToolDependency(
                        type=tool_ref.type,
                        provider=tool_ref.provider,
                        tool_name=tool_ref.tool_name,
                    )

            for file_ref in metadata.files:
                if file_ref.asset_id not in all_files:
                    all_files[file_ref.asset_id] = file_ref

            for dep_id in bundle.dependency_graph.get(current_id, []):
                if dep_id not in visited:
                    queue.append(dep_id)

        return all_tools, all_files

    def _resolve_content(
        self,
        content: str,
        metadata: SkillMetadata,
        current_node: Any,
        file_tree: AppAssetFileTree,
    ) -> str:
        if not content:
            return content

        for match in FILE_REFERENCE_PATTERN.finditer(content):
            file_id = match.group(2)
            file_node = file_tree.get(file_id)
            if file_node is None:
                logger.warning("File not found for id=%s, skipping", file_id)
                content = content.replace(match.group(0), "[File not found]")
                continue
            if current_node is not None:
                content = content.replace(match.group(0), file_tree.relative_path(current_node, file_node))
            else:
                content = content.replace(match.group(0), f"[{file_node.name}]")

        for match in TOOL_REFERENCE_PATTERN.finditer(content):
            tool_id = match.group(3)
            tool = metadata.tools.get(tool_id)
            if tool is None:
                logger.warning("Tool not found for id=%s, skipping", tool_id)
                content = content.replace(match.group(0), f"[Tool not found: {tool_id}]")
                continue
            content = content.replace(match.group(0), f"[Bash Command: {tool.tool_name}_{tool_id}]")

        return content
