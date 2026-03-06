import json
import logging

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.entities import AssetItem
from core.app_assets.storage import AssetPaths
from core.skill.assembler import SkillBundleAssembler
from core.skill.entities.skill_bundle import SkillBundle
from core.skill.entities.skill_document import SkillDocument
from extensions.storage.cached_presign_storage import CachedPresignStorage

from .base import BuildContext

logger = logging.getLogger(__name__)


class SkillBuilder:
    _nodes: list[tuple[AppAssetNode, str]]
    _storage: CachedPresignStorage

    def __init__(self, storage: CachedPresignStorage) -> None:
        self._nodes = []
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

        # load documents – skip nodes whose draft content is still the empty
        # placeholder written at creation time (the front-end has not uploaded
        # the actual skill document yet).
        documents: dict[str, SkillDocument] = {}
        for node, _ in self._nodes:
            try:
                key = AssetPaths.draft(ctx.tenant_id, ctx.app_id, node.id)
                raw = self._storage.load_once(key)
                # skip empty content
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
