"""Placeholder replacers for skill content.

Each replacer handles one category of ``§[...]§`` placeholder via the unified
``Replacer`` protocol. The shared ``resolve_content`` pipeline in
``core.skill.assembler.common`` builds a ``list[Replacer]`` and applies them
in order:

  ``FileReplacer`` → ``ToolGroupReplacer`` → ``ToolReplacer``

``ToolGroupReplacer`` MUST run before ``ToolReplacer`` so that group brackets
``[§[tool]...§, §[tool]...§]`` are resolved atomically; otherwise individual
tool replacement would destroy the group structure.
"""

import re
from typing import Protocol

from core.app.entities.app_asset_entities import AppAssetFileTree
from core.skill.entities.skill_metadata import SkillMetadata

TOOL_METADATA_PATTERN: re.Pattern[str] = re.compile(r"§\[tool\]\.\[([^\]]+)\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")
TOOL_PATTERN: re.Pattern[str] = re.compile(r"§\[tool\]\.\[.*?\]\.\[.*?\]\.\[(.*?)\]§")
TOOL_GROUP_PATTERN: re.Pattern[str] = re.compile(
    r"\[\s*§\[tool\]\.\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\]§"
    r"(?:\s*,\s*§\[tool\]\.\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\]§)*\s*\]"
)
FILE_PATTERN: re.Pattern[str] = re.compile(r"§\[file\]\.\[([^\]]+)\]\.\[([^\]]+)\]§")


class Replacer(Protocol):
    def resolve(self, content: str) -> str: ...


class FileReplacer:
    _tree: AppAssetFileTree
    _current_id: str
    _base_path: str

    def __init__(self, tree: AppAssetFileTree, current_id: str, base_path: str = "") -> None:
        self._tree = tree
        self._current_id = current_id
        self._base_path = base_path.rstrip("/")

    def resolve(self, content: str) -> str:
        return FILE_PATTERN.sub(self._replace_match, content)

    def _replace_match(self, match: re.Match[str]) -> str:
        target_id = match.group(2)
        source_node = self._tree.get(self._current_id)
        target_node = self._tree.get(target_id)

        if target_node is None:
            return "[File not found]"

        if source_node is not None:
            return self._tree.relative_path(source_node, target_node)

        full_path = self._tree.get_path(target_node.id)
        if self._base_path:
            return f"{self._base_path}/{full_path}"
        return full_path


class ToolReplacer:
    _metadata: SkillMetadata

    def __init__(self, metadata: SkillMetadata) -> None:
        self._metadata = metadata

    def resolve(self, content: str) -> str:
        return TOOL_PATTERN.sub(self._replace_match, content)

    def _replace_match(self, match: re.Match[str]) -> str:
        tool_id = match.group(1)
        tool_ref = self._metadata.tools.get(tool_id)
        if tool_ref is None:
            return f"[Tool not found or disabled: {tool_id}]"
        if not tool_ref.enabled:
            return ""
        return f"[Executable: {tool_ref.tool_name}_{tool_ref.uuid} --help command]"


class ToolGroupReplacer:
    _metadata: SkillMetadata

    def __init__(self, metadata: SkillMetadata) -> None:
        self._metadata = metadata

    def resolve(self, content: str) -> str:
        return TOOL_GROUP_PATTERN.sub(self._replace_match, content)

    def _replace_match(self, match: re.Match[str]) -> str:
        group_text = match.group(0)
        enabled_renders: list[str] = []

        for tool_match in TOOL_PATTERN.finditer(group_text):
            tool_id = tool_match.group(1)
            tool_ref = self._metadata.tools.get(tool_id)
            if tool_ref is None:
                enabled_renders.append(f"[Tool not found or disabled: {tool_id}]")
                continue
            if not tool_ref.enabled:
                continue
            enabled_renders.append(f"[Executable: {tool_ref.tool_name}_{tool_ref.uuid} --help command]")

        if not enabled_renders:
            return ""
        return "[" + ", ".join(enabled_renders) + "]"
