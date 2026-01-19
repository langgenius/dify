import json
import logging
import re
from typing import Any

from core.app_assets.entities import (
    FileReference,
    SkillAsset,
    SkillMetadata,
    ToolReference,
)
from core.app_assets.paths import AssetPaths
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
    ) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

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
            logger.exception("Failed to parse skill asset %s: %s", node_id)
            # handle as plain text
            return SkillAsset(
                node_id=node_id,
                path=path,
                file_name=file_name,
                extension=extension,
                storage_key=storage_key,
                metadata=SkillMetadata(),
                tool_references=[],
                file_references=[],
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
                tool_references=[],
                file_references=[],
            )

        if not isinstance(data, dict):
            raise ValueError(f"Skill document {node_id} must be a JSON object")

        data_dict: dict[str, Any] = data
        metadata_raw = data_dict.get("metadata", {})
        content = data_dict.get("content", "")

        if not isinstance(content, str):
            raise ValueError(f"Skill document {node_id} 'content' must be a string")

        metadata = SkillMetadata.model_validate(metadata_raw)

        tool_references: list[ToolReference] = self._parse_tool_references(content)
        file_references: list[FileReference] = self._parse_file_references(content)

        resolved_content = self._resolve_content(content, tool_references, file_references)
        resolved_key = AssetPaths.build_resolved_file(self._tenant_id, self._app_id, self._assets_id, node_id)
        storage.save(resolved_key, resolved_content.encode("utf-8"))

        return SkillAsset(
            node_id=node_id,
            path=path,
            file_name=file_name,
            extension=extension,
            storage_key=resolved_key,
            metadata=metadata,
            tool_references=tool_references,
            file_references=file_references,
        )

    def _resolve_content(
        self,
        content: str,
        tool_references: list[ToolReference],
        file_references: list[FileReference],
    ) -> str:
        for ref in tool_references:
            replacement = f"{ref.tool_name}"
            content = content.replace(ref.raw, replacement)

        for ref in file_references:
            replacement = f"[file:{ref.uuid}]"
            content = content.replace(ref.raw, replacement)

        return content

    def _parse_tool_references(self, content: str) -> list[ToolReference]:
        tool_references: list[ToolReference] = []
        for match in TOOL_REFERENCE_PATTERN.finditer(content):
            tool_references.append(
                ToolReference(
                    provider=match.group(1),
                    tool_name=match.group(2),
                    uuid=match.group(3),
                    raw=match.group(0),
                )
            )

        return tool_references

    def _parse_file_references(self, content: str) -> list[FileReference]:
        file_references: list[FileReference] = []
        for match in FILE_REFERENCE_PATTERN.finditer(content):
            file_references.append(
                FileReference(
                    source=match.group(1),
                    uuid=match.group(2),
                    raw=match.group(0),
                )
            )
        return file_references
