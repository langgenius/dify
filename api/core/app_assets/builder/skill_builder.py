import json
import logging

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.accessor import CachedContentAccessor
from core.app_assets.entities import AssetItem
from core.app_assets.storage import AssetPaths
from core.skill.assembler import SkillBundleAssembler
from core.skill.entities.skill_bundle import SkillBundle
from core.skill.entities.skill_document import SkillDocument
from extensions.storage.base_storage import BaseStorage

from .base import BuildContext

logger = logging.getLogger(__name__)


class SkillBuilder:
    _nodes: list[tuple[AppAssetNode, str]]
    _accessor: CachedContentAccessor
    _storage: BaseStorage

    def __init__(self, accessor: CachedContentAccessor, storage: BaseStorage) -> None:
        self._nodes = []
        self._accessor = accessor
        self._storage = storage

    def accept(self, node: AppAssetNode) -> bool:
        return node.extension == "md"

    def collect(self, node: AppAssetNode, path: str, ctx: BuildContext) -> None:
        self._nodes.append((node, path))

    def build(self, tree: AppAssetFileTree, ctx: BuildContext) -> list[AssetItem]:
        from core.skill.skill_manager import SkillManager

        if not self._nodes:
            SkillManager.save_bundle(
                ctx.tenant_id, ctx.app_id, ctx.build_id, SkillBundle(assets_id=ctx.build_id, asset_tree=tree)
            )
            return []

        # Batch-load all skill draft content in one DB query (with S3 fallback on miss).
        nodes_only = [node for node, _ in self._nodes]
        raw_contents = self._accessor.bulk_load(nodes_only)

        # Parse documents — skip nodes whose draft content is still the empty
        # placeholder written at creation time.
        documents: dict[str, SkillDocument] = {}
        for node, _ in self._nodes:
            try:
                raw = raw_contents.get(node.id)
                if not raw:
                    continue
                data = {"skill_id": node.id, **json.loads(raw)}
                documents[node.id] = SkillDocument.model_validate(data)
            except (FileNotFoundError, json.JSONDecodeError, TypeError, ValueError) as e:
                logger.exception("Failed to load or parse skill document for node %s", node.id)
                raise ValueError(f"Failed to load or parse skill document for node {node.id}") from e

        bundle = SkillBundleAssembler(tree).assemble_bundle(documents, ctx.build_id)
        SkillManager.save_bundle(ctx.tenant_id, ctx.app_id, ctx.build_id, bundle)

        items: list[AssetItem] = []
        for node, path in self._nodes:
            skill = bundle.get(node.id)
            if skill is None:
                continue
            storage_key = AssetPaths.resolved(ctx.tenant_id, ctx.app_id, ctx.build_id, node.id)
            self._storage.save(storage_key, skill.content.encode("utf-8"))
            items.append(
                AssetItem(
                    asset_id=node.id,
                    path=path,
                    file_name=node.name,
                    extension=node.extension or "",
                    storage_key=storage_key,
                )
            )
        return items
