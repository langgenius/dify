from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SkillDocument(BaseModel):
    """Input document for skill compilation."""

    model_config = ConfigDict(extra="forbid")

    skill_id: str = Field(description="Unique identifier, must match SkillAsset.asset_id")
    content: str = Field(description="Raw content with reference placeholders")
    metadata: Mapping[str, Any] = Field(default_factory=dict, description="Raw metadata dict")
