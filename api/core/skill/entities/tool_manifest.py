from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.app_assets.skill import ToolType


class ToolManifestEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    type: ToolType
    provider: str | None = None
    tool_name: str | None = None
    credential_id: str | None = None
    configuration: dict[str, Any] | None = None


class ToolManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: dict[str, ToolManifestEntry] = Field(default_factory=dict)
    references: list[str] = Field(default_factory=list)
