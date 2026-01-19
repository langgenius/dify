import json
import logging
import re
from typing import Any

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.entities import (
    SkillAsset,
    SkillMetadata,
)
from core.app_assets.entities.skill import FileReference, ToolConfiguration, ToolReference
from core.app_assets.paths import AssetPaths
from core.tools.entities.tool_entities import ToolProviderType
from extensions.ext_storage import storage

from .base import AssetItemParser

TOOL_REFERENCE_PATTERN = re.compile(r"§\[tool\]\.\[([^\]]+)\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")
FILE_REFERENCE_PATTERN = re.compile(r"§\[file\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")

logger = logging.getLogger(__name__)


class SkillAssetParser(AssetItemParser):
    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        assets_id: str,
        tree: AppAssetFileTree,
    ) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id
        self._tree = tree

    def parse(
        self,
        node_id: str,
        path: str,
        file_name: str,
        extension: str,
        storage_key: str,
    ) -> SkillAsset:
        try:
            return self._parse_skill_asset(node_id, path, file_name, extension, storage_key)
        except Exception:
            logger.exception("Failed to parse skill asset %s", node_id)
            # handle as plain text
            return SkillAsset(
                node_id=node_id,
                path=path,
                file_name=file_name,
                extension=extension,
                storage_key=storage_key,
                metadata=SkillMetadata(),
            )

    def _parse_skill_asset(
        self, node_id: str, path: str, file_name: str, extension: str, storage_key: str
    ) -> SkillAsset:
        try:
            data = json.loads(storage.load_once(storage_key))
        except (json.JSONDecodeError, UnicodeDecodeError):
            # handle as plain text
            return SkillAsset(
                node_id=node_id,
                path=path,
                file_name=file_name,
                extension=extension,
                storage_key=storage_key,
                metadata=SkillMetadata(),
            )

        if not isinstance(data, dict):
            raise ValueError(f"Skill document {node_id} must be a JSON object")

        data_dict: dict[str, Any] = data
        metadata_raw = data_dict.get("metadata", {})
        content = data_dict.get("content", "")

        if not isinstance(content, str):
            raise ValueError(f"Skill document {node_id} 'content' must be a string")

        resolved_key = AssetPaths.build_resolved_file(self._tenant_id, self._app_id, self._assets_id, node_id)
        current_file = self._tree.get(node_id)
        if current_file is None:
            raise ValueError(f"File not found for id={node_id}")

        metadata = self._resolve_metadata(content, metadata_raw)
        storage.save(resolved_key, self._resolve_content(current_file, content, metadata).encode("utf-8"))

        return SkillAsset(
            node_id=node_id,
            path=path,
            file_name=file_name,
            extension=extension,
            storage_key=resolved_key,
            metadata=metadata,
        )

    def _resolve_content(self, current_file: AppAssetNode, content: str, metadata: SkillMetadata) -> str:
        for match in FILE_REFERENCE_PATTERN.finditer(content):
            # replace with file relative path
            file_id = match.group(2)
            file = self._tree.get(file_id)
            if file is None:
                logger.warning("File not found for id=%s, skipping", file_id)
                # replace with file not found placeholder
                content = content.replace(match.group(0), "[File not found]")
                continue
            content = content.replace(match.group(0), self._tree.relative_path(current_file, file))

        for match in TOOL_REFERENCE_PATTERN.finditer(content):
            tool_id = match.group(3)
            tool = metadata.tools.get(tool_id)
            if tool is None:
                logger.warning("Tool not found for id=%s, skipping", tool_id)
                # replace with tool not found placeholder
                content = content.replace(match.group(0), f"[Tool not found: {tool_id}]")
                continue
            content = content.replace(match.group(0), f"[Bash Command: {tool.tool_name}_{tool_id}]")
        return content

    def _resolve_file_references(self, content: str) -> list[FileReference]:
        file_references: list[FileReference] = []
        for match in FILE_REFERENCE_PATTERN.finditer(content):
            file_references.append(
                FileReference(
                    source=match.group(1),
                    uuid=match.group(2),
                )
            )
        return file_references

    def _resolve_tool_references(self, content: str, tools: dict[str, Any]) -> dict[str, ToolReference]:
        tool_references: dict[str, ToolReference] = {}
        for match in TOOL_REFERENCE_PATTERN.finditer(content):
            tool_id = match.group(3)
            tool_name = match.group(2)
            tool_provider = match.group(1)
            metadata = tools.get(tool_id)
            if metadata is None:
                raise ValueError(f"Tool metadata for {tool_id} not found")

            configuration = ToolConfiguration.model_validate(metadata.get("configuration", {}))
            tool_references[tool_id] = ToolReference(
                uuid=tool_id,
                type=ToolProviderType.value_of(metadata.get("type", None)),
                provider=tool_provider,
                tool_name=tool_name,
                credential_id=metadata.get("credential_id", None),
                configuration=configuration,
            )
        return tool_references

    def _resolve_metadata(self, content: str, metadata: dict[str, Any]) -> SkillMetadata:
        return SkillMetadata(
            files=self._resolve_file_references(content=content),
            tools=self._resolve_tool_references(content=content, tools=metadata.get("tools", {})),
        )
