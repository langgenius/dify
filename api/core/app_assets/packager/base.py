from abc import ABC, abstractmethod

from core.app_assets.assets import AssetItem


class AssetPackager(ABC):
    @abstractmethod
    def package(self, assets: list[AssetItem]) -> bytes:
        raise NotImplementedError
