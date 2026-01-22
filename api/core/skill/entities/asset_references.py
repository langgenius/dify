from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.skill_metadata import FileReference


class AssetReferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    references: list[FileReference] = Field(default_factory=list)
