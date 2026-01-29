from dataclasses import dataclass


@dataclass
class AssetItem:
    asset_id: str
    path: str
    file_name: str
    extension: str
    storage_key: str
