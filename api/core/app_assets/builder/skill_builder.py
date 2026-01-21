import json

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.entities import AssetItem, FileAsset
from core.app_assets.paths import AssetPaths
from core.skill.entities.skill_document import SkillDocument
from core.skill.skill_compiler import SkillCompiler
from core.skill.skill_manager import SkillManager
from extensions.ext_storage import storage

from .base import BuildContext


class SkillBuilder:
    _nodes: list[tuple[AppAssetNode, str]]

    def __init__(self) -> None:
        self._nodes = []

    def accept(self, node: AppAssetNode) -> bool:
        return node.extension == "md"

    def collect(self, node: AppAssetNode, path: str, ctx: BuildContext) -> None:
        self._nodes.append((node, path))

    def build(self, tree: AppAssetFileTree, ctx: BuildContext) -> list[AssetItem]:
        if not self._nodes:
            return []

        # 1. Load and create documents
        documents: list[SkillDocument] = []
        for node, _ in self._nodes:
            draft_key = AssetPaths.draft_file(ctx.tenant_id, ctx.app_id, node.id)
            try:
                data = json.loads(storage.load_once(draft_key))
                content = data.get("content", "") if isinstance(data, dict) else ""
                metadata = data.get("metadata", {}) if isinstance(data, dict) else {}
            except Exception:
                content = ""
                metadata = {}

            documents.append(
                SkillDocument(
                    skill_id=node.id,
                    content=content,
                    metadata=metadata,
                )
            )

        # 2. Compile all skills
        compiler = SkillCompiler()
        artifact_set = compiler.compile_all(documents, tree, ctx.build_id)

        # 3. Save tool artifact
        SkillManager.save_tool_artifact(
            ctx.tenant_id,
            ctx.app_id,
            ctx.build_id,
            artifact_set.get_tool_artifact(),
        )

        # 4. Save compiled content to storage and return FileAssets
        results: list[AssetItem] = []
        for node, path in self._nodes:
            artifact = artifact_set.get(node.id)
            if artifact is None:
                continue

            # Write compiled content to storage
            resolved_key = AssetPaths.build_resolved_file(
                ctx.tenant_id, ctx.app_id, ctx.build_id, node.id
            )
            storage.save(resolved_key, artifact.content.encode("utf-8"))

            results.append(
                FileAsset(
                    asset_id=node.id,
                    path=path,
                    file_name=node.name,
                    extension=node.extension or "",
                    storage_key=resolved_key,
                )
            )

        return results
