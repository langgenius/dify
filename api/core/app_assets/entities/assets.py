from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class AssetItem(ABC):
    node_id: str
    path: str
    file_name: str
    extension: str

    @abstractmethod
    def get_storage_key(self) -> str:
        raise NotImplementedError


@dataclass
class FileAsset(AssetItem):
    storage_key: str

    def get_storage_key(self) -> str:
        return self.storage_key
