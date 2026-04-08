from collections import deque
from collections.abc import Mapping

from core.app.entities.app_asset_entities import AppAssetFileTree, AssetNodeType
from core.skill.assembler.replacers import (
    FILE_PATTERN,
    TOOL_METADATA_PATTERN,
    FileReplacer,
    Replacer,
    ToolGroupReplacer,
    ToolReplacer,
)
from core.skill.entities.skill_bundle import Skill, SkillDependance
from core.skill.entities.skill_metadata import FileReference, SkillMetadata, ToolReference


def process_skill_content(
    content: str,
    metadata: SkillMetadata,
    file_tree: AppAssetFileTree,
    current_id: str,
    base_path: str = "",
) -> str:
    """Resolve all placeholders in content through the ordered replacer pipeline."""
    replacers: list[Replacer] = [
        FileReplacer(file_tree, current_id, base_path),
        ToolGroupReplacer(metadata),
        ToolReplacer(metadata),
    ]
    for replacer in replacers:
        content = replacer.resolve(content)
    return content


def get_metadata(content: str, metadata: SkillMetadata) -> SkillMetadata:
    """Parse effective metadata from content placeholders and raw metadata."""
    tools: dict[str, ToolReference] = {}
    # find all tool refs actually used in content
    for match in TOOL_METADATA_PATTERN.finditer(content):
        provider, name, uuid = match.group(1), match.group(2), match.group(3)
        tool_ref = metadata.tools.get(uuid)
        if tool_ref is None:
            raise ValueError(f"Tool reference with UUID {uuid} not found in metadata")
        tool_ref.uuid = uuid
        tool_ref.tool_name = name
        tool_ref.provider = provider
        tools[uuid] = tool_ref

    # find all file refs
    files: set[FileReference] = set()
    for match in FILE_PATTERN.finditer(content):
        source, asset_id = match.group(1), match.group(2)
        files.add(FileReference(source=source, asset_id=asset_id))

    return SkillMetadata(tools=tools, files=files)


def build_skill_graph(skills: Mapping[str, Skill], file_tree: AppAssetFileTree) -> dict[str, set[str]]:
    """Build adjacency list: skill_id -> referenced skill IDs."""
    known_skill_ids = set(skills.keys())
    graph: dict[str, set[str]] = {skill_id: set() for skill_id in known_skill_ids}

    for skill_id, skill in skills.items():
        graph[skill_id] = expand_referenced_skill_ids(skill.direct_dependance.files, known_skill_ids, file_tree)

    return graph


def compute_transitive_dependance(
    skills: Mapping[str, Skill],
    graph: Mapping[str, set[str]],
) -> dict[str, SkillDependance]:
    """Compute transitive dependency closure with fixed-point iteration."""
    dependance_map = {skill_id: skill.direct_dependance for skill_id, skill in skills.items()}

    changed = True
    while changed:
        changed = False
        for skill_id in sorted(skills.keys()):
            merged = dependance_map[skill_id]
            for dep_skill_id in sorted(graph.get(skill_id, set())):
                if dep_skill_id == skill_id:
                    continue
                merged = merged | dependance_map[dep_skill_id]

            if merged != dependance_map[skill_id]:
                dependance_map[skill_id] = merged
                changed = True

    return dependance_map


def expand_referenced_skill_ids(
    refs: set[FileReference],
    known_skill_ids: set[str],
    file_tree: AppAssetFileTree,
) -> set[str]:
    """Resolve file/folder references to concrete known skill IDs."""
    resolved: set[str] = set()
    for ref in refs:
        node = file_tree.get(ref.asset_id)
        if node is None:
            continue

        if node.node_type == AssetNodeType.FILE:
            if node.id in known_skill_ids:
                resolved.add(node.id)
            continue

        descendant_ids = file_tree.get_descendant_ids(node.id)
        for descendant_id in descendant_ids:
            descendant = file_tree.get(descendant_id)
            if descendant is None or descendant.node_type != AssetNodeType.FILE:
                continue
            if descendant_id in known_skill_ids:
                resolved.add(descendant_id)

    return resolved


def collect_transitive_skill_ids(
    root_skill_ids: set[str],
    graph: Mapping[str, set[str]],
) -> set[str]:
    """Collect all transitively reachable skill IDs from roots via BFS."""
    visited: set[str] = set()
    queue = deque(sorted(root_skill_ids))
    while queue:
        current = queue.popleft()
        if current in visited:
            continue
        visited.add(current)
        for next_skill_id in sorted(graph.get(current, set())):
            if next_skill_id not in visited:
                queue.append(next_skill_id)
    return visited
