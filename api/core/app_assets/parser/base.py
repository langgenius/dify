from abc import ABC, abstractmethod

from core.app_assets.entities import AssetItem, FileAsset


class AssetItemParser(ABC):
    @abstractmethod
    def parse(
        self,
        asset_id: str,
        path: str,
        file_name: str,
        extension: str,
        storage_key: str,
    ) -> AssetItem:
        raise NotImplementedError


class FileAssetParser(AssetItemParser):
    def parse(
        self,
        asset_id: str,
        path: str,
        file_name: str,
        extension: str,
        storage_key: str,
    ) -> FileAsset:
        return FileAsset(
            asset_id=asset_id,
            path=path,
            file_name=file_name,
            extension=extension,
            storage_key=storage_key,
        )
