"""Private DTOs for immutable Home Snapshot operations."""

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field


class InitializeHomeSnapshotRequest(BaseModel):
    tenant_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    home_snapshot_id: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateHomeSnapshotFromBindingRequest(BaseModel):
    tenant_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    home_snapshot_id: str = Field(min_length=1)
    backend_binding_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DeleteHomeSnapshotRequest(BaseModel):
    snapshot_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class HomeSnapshotResponse(BaseModel):
    snapshot_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "CreateHomeSnapshotFromBindingRequest",
    "DeleteHomeSnapshotRequest",
    "HomeSnapshotResponse",
    "InitializeHomeSnapshotRequest",
]
