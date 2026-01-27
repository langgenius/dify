from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.entities import AssetItem, FileAsset
from core.app_assets.storage import AssetPath

from .base import BuildContext


class FileBuilder:
    _nodes: list[tuple[AppAssetNode, str]]

    def __init__(self) -> None:
        self._nodes = []

    def accept(self, node: AppAssetNode) -> bool:
        return True

    def collect(self, node: AppAssetNode, path: str, ctx: BuildContext) -> None:
        self._nodes.append((node, path))

    def build(self, tree: AppAssetFileTree, ctx: BuildContext) -> list[AssetItem]:
        return [
            FileAsset(
                asset_id=node.id,
                path=path,
                file_name=node.name,
                extension=node.extension or "",
                storage_key=AssetPath.draft(ctx.tenant_id, ctx.app_id, node.id).get_storage_key(),
            )
            for node, path in self._nodes
        ]
