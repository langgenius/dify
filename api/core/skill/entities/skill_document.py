from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.skill_metadata import SkillMetadata


class SkillFile(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SkillDocument(BaseModel):
    """Input document for skill compilation."""

    model_config = ConfigDict(extra="forbid")

    skill_id: str = Field(description="Unique identifier, must match SkillAsset.asset_id")
    content: str = Field(description="Raw content with reference placeholders")
    metadata: SkillMetadata = Field(default_factory=SkillMetadata, description="Additional metadata for this skill")
