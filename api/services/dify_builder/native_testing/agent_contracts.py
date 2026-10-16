"""Pure protected Agent association structures, never backend ACK/cleanup authority.

The trusted future backend producer must read its actual checkpoint/event and
verified terminal state before storing these records. Parsing or storing a
reference does not authorize an effect, resume, or physical-capacity release.
"""

from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, TypeAdapter, field_validator, model_validator

from services.dify_builder.execution_contracts import Digest
from services.dify_builder.native_testing.contracts import ID, Counter, FiniteJSON, FrozenDTO, NativeTestContextRef


class AgentTestWorkspaceRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    binding_id: str
    workspace_id: str
    backend_binding_ref: str
    backend_workspace_ref: str
    pinned_snapshot_id: str
    home_snapshot_id: str
    workspace_generation: int


class AgentParentNodeRef(FrozenDTO):
    """Actual bound execution UUID and existing protected typed inputs, not an effect key."""

    ref: NativeTestContextRef
    execution_id: ID
    input_result_ref: ID
    input_digest: Digest

    @field_validator("execution_id")
    @classmethod
    def canonical_execution_uuid(cls, value: str) -> str:
        if str(UUID(value)) != value:
            raise ValueError("expected canonical execution UUID")
        return value


class AgentNodeAssociation(FrozenDTO):
    parent_node: AgentParentNodeRef
    workflow_native_run_id: ID
    agent_run_id: ID
    config_ref: ID
    config_digest: Digest
    pinned_snapshot_id: ID
    home_snapshot_id: ID
    workspace: AgentTestWorkspaceRef

    @field_validator("workspace", mode="before")
    @classmethod
    def strict_workspace_values(cls, value: object) -> object:
        raw = value.model_dump() if isinstance(value, AgentTestWorkspaceRef) else value
        if not isinstance(raw, dict):
            raise ValueError("expected workspace reference")
        for name in AgentTestWorkspaceRef.model_fields:
            TypeAdapter(Counter if name == "workspace_generation" else ID).validate_python(raw.get(name))
        return value

    @model_validator(mode="after")
    def distinct_runs_and_pins(self) -> Self:
        if self.agent_run_id == self.workflow_native_run_id:
            raise ValueError("Agent and Workflow Run identities are distinct")
        if (self.pinned_snapshot_id, self.home_snapshot_id) != (
            self.workspace.pinned_snapshot_id,
            self.workspace.home_snapshot_id,
        ):
            raise ValueError("workspace pin mismatch")
        return self


class AgentWaitAssociation(FrozenDTO):
    """Selected private object/event references; cannot certify an external Redis ACK."""

    parent_node: AgentParentNodeRef
    association_object_ref: ID
    agent_generation: Counter
    checkpoint_object_ref: ID
    checkpoint_digest: Digest
    backend_wait_event_id: ID


class AgentProtectedState(FrozenDTO):
    """Owned decoded material; actual backend proof and current C02 checks remain external."""

    association_object_ref: ID
    association: AgentNodeAssociation
    wait: AgentWaitAssociation | None
    checkpoint: FiniteJSON
    terminal_result_ref: ID | None
    terminal_result: FiniteJSON
