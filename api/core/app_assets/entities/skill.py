from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .assets import AssetItem


@dataclass
class SkillAsset(AssetItem):
    metadata: Mapping[str, Any] = field(default_factory=dict)
