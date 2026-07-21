"""Wire DTOs for stateless Home Snapshot control-plane operations."""

from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field


class HomeSnapshotSourceFile(BaseModel):
    path: str = Field(min_length=1)
    content_base64: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateHomeSnapshotRequest(BaseModel):
    tenant_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    agent_config_version_id: str = Field(min_length=1)
    source_digest: str = Field(min_length=1)
    files: list[HomeSnapshotSourceFile] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateHomeSnapshotResponse(BaseModel):
    snapshot_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["CreateHomeSnapshotRequest", "CreateHomeSnapshotResponse", "HomeSnapshotSourceFile"]
