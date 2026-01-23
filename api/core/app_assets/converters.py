from __future__ import annotations

from core.app.entities.app_asset_entities import AppAssetFileTree, AssetNodeType
from core.app_assets.entities import FileAsset
from core.app_assets.entities.assets import AssetItem
from core.app_assets.paths import AssetPaths


def tree_to_asset_items(
    tree: AppAssetFileTree,
    tenant_id: str,
    app_id: str,
) -> list[AssetItem]:
    """
    Convert AppAssetFileTree to list of FileAsset for packaging.

    Args:
        tree: The asset file tree to convert
        tenant_id: Tenant ID for storage key generation
        app_id: App ID for storage key generation

    Returns:
        List of FileAsset items ready for packaging
    """
    items: list[AssetItem] = []
    for node in tree.nodes:
        if node.node_type == AssetNodeType.FILE:
            path = tree.get_path(node.id)
            storage_key = AssetPaths.draft_file(tenant_id, app_id, node.id)
            items.append(
                FileAsset(
                    asset_id=node.id,
                    path=path,
                    file_name=node.name,
                    extension=node.extension or "",
                    storage_key=storage_key,
                )
            )
    return items
