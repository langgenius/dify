"""Client-safe DTOs for the Dify drive declaration layer.

The drive layer carries the runtime drive catalog plus the prompt-mentioned
targets that must be pulled eagerly when the layer enters. It is still config
only: skills are declared as metadata, not content, and plain files are listed
only when the prompt explicitly mentions their drive keys.

The API backend catalogs and writes this config; the Agent backend consumes it
by running sandbox-visible ``dify-agent drive pull`` commands through the shell
layer so materialized files live in the same filesystem that model shell jobs
use.
"""

from typing import Final

from pydantic import BaseModel, ConfigDict, Field

from agenton.layers import LayerConfig


DIFY_DRIVE_LAYER_TYPE_ID: Final[str] = "dify.drive"


class DifyDriveSkillConfig(BaseModel):
    """Runtime declaration of one standardized skill — metadata, not content."""

    model_config = ConfigDict(extra="forbid")

    name: str
    # The model judges from this description whether the skill is worth loading.
    description: str
    # "<slug>/SKILL.md" — the canonical entry document in the drive.
    skill_md_key: str
    # "<slug>/.DIFY-SKILL-FULL.zip" — full archive for restoring the complete skill.
    archive_key: str | None = None
    path: str


class DifyDriveLayerConfig(LayerConfig):
    """Drive runtime catalog plus eager-pull instructions for mentioned targets."""

    # "agent-<agent_id>" — storage addressing, deliberately explicit instead of
    # derived from execution context so a shared (non-agent-bound) drive stays
    # possible later.
    drive_ref: str
    skills: list[DifyDriveSkillConfig] = Field(default_factory=list)
    mentioned_skill_keys: list[str] = Field(default_factory=list)
    mentioned_file_keys: list[str] = Field(default_factory=list)


__all__ = [
    "DIFY_DRIVE_LAYER_TYPE_ID",
    "DifyDriveLayerConfig",
    "DifyDriveSkillConfig",
]
