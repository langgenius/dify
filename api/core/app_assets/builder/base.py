from dataclasses import dataclass
from typing import Protocol

from core.app.entities.app_asset_entities import AppAssetFileTree, AppAssetNode
from core.app_assets.entities import AssetItem


@dataclass
class BuildContext:
    tenant_id: str
    app_id: str
    build_id: str


class AssetBuilder(Protocol):
    def accept(self, node: AppAssetNode) -> bool: ...

    def collect(self, node: AppAssetNode, path: str, ctx: BuildContext) -> None: ...

    def build(self, tree: AppAssetFileTree, ctx: BuildContext) -> list[AssetItem]: ...
