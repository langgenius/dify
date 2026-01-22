from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.asset_references import AssetReferences
from core.skill.entities.tool_dependencies import ToolDependencies


class SourceInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str = Field(description="Asset ID of the source skill file")
    content_digest: str = Field(description="Hash of the original content for change detection")


class SkillBundleEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skill_id: str = Field(description="Unique identifier for this skill")
    source: SourceInfo = Field(description="Source file information")
    tools: ToolDependencies = Field(description="All tool dependencies (transitive closure)")
    files: AssetReferences = Field(description="All file references (transitive closure)")
    content: str = Field(description="Resolved content with all references replaced")
