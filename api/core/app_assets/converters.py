from __future__ import annotations

from core.app.entities.app_asset_entities import AppAssetFileTree, AssetNodeType
from core.app_assets.entities import AssetItem
from core.app_assets.storage import AssetPaths


def tree_to_asset_items(tree: AppAssetFileTree, tenant_id: str, app_id: str) -> list[AssetItem]:
    """Convert AppAssetFileTree to list of AssetItem for packaging."""
    return [
        AssetItem(
            asset_id=node.id,
            path=tree.get_path(node.id),
            file_name=node.name,
            extension=node.extension or "",
            storage_key=AssetPaths.draft(tenant_id, app_id, node.id),
        )
        for node in tree.nodes
        if node.node_type == AssetNodeType.FILE
    ]
