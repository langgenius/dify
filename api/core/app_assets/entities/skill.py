from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .assets import AssetItem


@dataclass
class SkillAsset(AssetItem):
    storage_key: str
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def get_storage_key(self) -> str:
        return self.storage_key
