from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.skill_metadata import FileReference


class FilesArtifact(BaseModel):
    """
    File artifact - contains all file references (transitive closure)
    """

    model_config = ConfigDict(extra="forbid")

    references: list[FileReference] = Field(default_factory=list, description="All file references")
