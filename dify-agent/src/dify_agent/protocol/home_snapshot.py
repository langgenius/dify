"""Wire DTOs for stateless Home Snapshot control-plane operations.

Initialization and Build Apply are deliberately separate contracts. The first
lets a backend create its native initial Home, while the second snapshots one
exact retained Sandbox selected by Dify API.
"""

from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

from .sandbox import SandboxLocator


class InitializeHomeSnapshotRequest(BaseModel):
    tenant_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    home_snapshot_id: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateHomeSnapshotFromSandboxRequest(BaseModel):
    tenant_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    home_snapshot_id: str = Field(min_length=1)
    source_sandbox: SandboxLocator

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class HomeSnapshotResponse(BaseModel):
    snapshot_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "CreateHomeSnapshotFromSandboxRequest",
    "HomeSnapshotResponse",
    "InitializeHomeSnapshotRequest",
]
