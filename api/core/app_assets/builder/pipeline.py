from core.app.entities.app_asset_entities import AppAssetFileTree
from core.app_assets.entities import AssetItem

from .base import AssetBuilder, BuildContext


class AssetBuildPipeline:
    _builders: list[AssetBuilder]

    def __init__(self, builders: list[AssetBuilder]) -> None:
        self._builders = builders

    def build_all(self, tree: AppAssetFileTree, ctx: BuildContext) -> list[AssetItem]:
        # 1. Distribute: each node goes to first accepting builder
        for node in tree.walk_files():
            path = tree.get_path(node.id)
            for builder in self._builders:
                if builder.accept(node):
                    builder.collect(node, path, ctx)
                    break

        # 2. Each builder builds its collected nodes
        results: list[AssetItem] = []
        for builder in self._builders:
            results.extend(builder.build(tree, ctx))

        return results
