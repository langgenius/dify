from abc import ABC, abstractmethod

from core.app_assets.assets import AssetItem, FileAsset


class AssetItemParser(ABC):
    @abstractmethod
    def parse(
        self,
        node_id: str,
        path: str,
        file_name: str,
        extension: str,
        storage_key: str,
        raw_bytes: bytes,
    ) -> AssetItem:
        raise NotImplementedError


class FileAssetParser(AssetItemParser):
    def parse(
        self,
        node_id: str,
        path: str,
        file_name: str,
        extension: str,
        storage_key: str,
        raw_bytes: bytes,
    ) -> FileAsset:
        return FileAsset(
            node_id=node_id,
            path=path,
            file_name=file_name,
            extension=extension,
            storage_key=storage_key,
        )
