from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.file_artifact import FilesArtifact
from core.skill.entities.tool_artifact import ToolArtifact


class SkillSourceInfo(BaseModel):
    """Source file information for change detection."""

    model_config = ConfigDict(extra="forbid")

    asset_id: str = Field(description="Asset ID of the source skill file")
    content_digest: str = Field(description="Hash of the original content for change detection")


class SkillArtifact(BaseModel):
    """
    Compiled artifact for a single skill.

    Contains the transitive closure of all tool and file dependencies,
    plus the resolved content with all references replaced.
    """

    model_config = ConfigDict(extra="forbid")

    skill_id: str = Field(description="Unique identifier for this skill")
    source: SkillSourceInfo = Field(description="Source file information")
    tools: ToolArtifact = Field(description="All tool dependencies (transitive closure)")
    files: FilesArtifact = Field(description="All file references (transitive closure)")
    content: str = Field(description="Resolved content with all references replaced")
