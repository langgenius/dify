import json
import re
from typing import TYPE_CHECKING, Any

from core.app_assets.paths import AssetPaths
from core.app_assets.skill import (
    FileReference,
    SkillAsset,
    SkillMetadata,
    ToolReference,
)

from .base import AssetItemParser

if TYPE_CHECKING:
    from extensions.ext_storage import Storage

TOOL_REFERENCE_PATTERN = re.compile(r"§\[tool\]\.\[([^\]]+)\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")
FILE_REFERENCE_PATTERN = re.compile(r"§\[file\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")


class SkillAssetParser(AssetItemParser):
    _tenant_id: str
    _app_id: str
    _publish_id: str
    _storage: "Storage"

    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        publish_id: str,
        storage: "Storage",
    ) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._publish_id = publish_id
        self._storage = storage

    def _get_resolved_key(self, node_id: str) -> str:
        return AssetPaths.published_resolved_file(self._tenant_id, self._app_id, self._publish_id, node_id)

    def parse(
        self,
        node_id: str,
        path: str,
        file_name: str,
        extension: str,
        storage_key: str,
        raw_bytes: bytes,
    ) -> SkillAsset:
        try:
            data = json.loads(raw_bytes.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError(f"Invalid skill document JSON for {node_id}: {e}") from e

        if not isinstance(data, dict):
            raise ValueError(f"Skill document {node_id} must be a JSON object")

        data_dict: dict[str, Any] = data
        metadata_raw = data_dict.get("metadata", {})
        content = data_dict.get("content", "")

        if not isinstance(content, str):
            raise ValueError(f"Skill document {node_id} 'content' must be a string")

        metadata = SkillMetadata.model_validate(metadata_raw)

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

        file_references: list[FileReference] = []
        for match in FILE_REFERENCE_PATTERN.finditer(content):
            file_references.append(
                FileReference(
                    source=match.group(1),
                    uuid=match.group(2),
                    raw=match.group(0),
                )
            )

        resolved_content = self._resolve_content(content, tool_references, file_references)
        resolved_key = self._get_resolved_key(node_id)
        self._storage.save(resolved_key, resolved_content.encode("utf-8"))

        return SkillAsset(
            node_id=node_id,
            path=path,
            file_name=file_name,
            extension=extension,
            storage_key=resolved_key,
            metadata=metadata,
            content=resolved_content,
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
            replacement = f"{ref.provider}/{ref.tool_name}"
            content = content.replace(ref.raw, replacement)

        for ref in file_references:
            replacement = f"[file:{ref.uuid}]"
            content = content.replace(ref.raw, replacement)

        return content
