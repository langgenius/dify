"""Client-safe DTOs for the Dify drive declaration layer.

The drive layer is a config-only manifest of the Skills & Files an agent has
in its drive. It is an index, never the content: each entry carries only a
display name, a model-facing description, and the drive key needed to fetch
the real bytes through the back proxy (``GET /inner/api/drive/<drive_ref>/
manifest`` → internal download URL). Inlining SKILL.md bodies here would break
the PRD's dynamic-loading principle and bloat every run request.

The API backend catalogs and writes this config; the Agent backend consumes it
(ENG-387: pull via back proxy, lazy-load SKILL.md, materialize files).
"""

from typing import Final

from pydantic import BaseModel, ConfigDict, Field

from agenton.layers import LayerConfig


DIFY_DRIVE_LAYER_TYPE_ID: Final[str] = "dify.drive"


class DifyDriveSkillConfig(BaseModel):
    """Runtime declaration of one standardized skill — an index, not content."""

    model_config = ConfigDict(extra="forbid")

    name: str
    # The model judges from this description whether the skill is worth loading.
    description: str
    # "<slug>/SKILL.md" — the canonical entry document in the drive.
    skill_md_key: str
    # "<slug>/.DIFY-SKILL-FULL.zip" — full archive for restoring the complete skill.
    archive_key: str | None = None


class DifyDriveFileConfig(BaseModel):
    """Runtime declaration of one plain drive file."""

    model_config = ConfigDict(extra="forbid")

    name: str
    # "files/<filename>" — the drive key of the file value.
    key: str
    size: int | None = None
    mime_type: str | None = None


class DifyDriveLayerConfig(LayerConfig):
    """Config-only declaration layer: API writes the catalog, the agent pulls
    the listed entries through the back proxy using ``drive_ref``."""

    # "agent-<agent_id>" — storage addressing, deliberately explicit instead of
    # derived from execution context so a shared (non-agent-bound) drive stays
    # possible later.
    drive_ref: str
    skills: list[DifyDriveSkillConfig] = Field(default_factory=list)
    files: list[DifyDriveFileConfig] = Field(default_factory=list)


__all__ = [
    "DIFY_DRIVE_LAYER_TYPE_ID",
    "DifyDriveFileConfig",
    "DifyDriveLayerConfig",
    "DifyDriveSkillConfig",
]
