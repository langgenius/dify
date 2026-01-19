from core.app.entities.app_asset_entities import AppAssetFileTree
from core.app_assets.entities import AssetItem
from core.app_assets.paths import AssetPaths

from .base import AssetItemParser, FileAssetParser


class AssetParser:
    def __init__(
        self,
        tree: AppAssetFileTree,
        tenant_id: str,
        app_id: str,
    ) -> None:
        self._tree = tree
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._parsers = {}
        self._default_parser = FileAssetParser()

    def register(self, extension: str, parser: AssetItemParser) -> None:
        self._parsers[extension] = parser

    def parse(self) -> list[AssetItem]:
        assets: list[AssetItem] = []

        for node in self._tree.walk_files():
            path = self._tree.get_path(node.id).lstrip("/")
            storage_key = AssetPaths.draft_file(self._tenant_id, self._app_id, node.id)
            extension = node.extension or ""

            parser = self._parsers.get(extension, self._default_parser)
            asset = parser.parse(node.id, path, node.name, extension, storage_key)
            assets.append(asset)

        return assets
