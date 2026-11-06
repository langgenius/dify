"""Immutable confirmed-recovery relations. Decoding grants no handoff authority.

The private scheduler must independently verify the protected relation and CAS
its exact predecessor. These DTOs execute nothing and carry no permits or state.
"""

import hashlib
import json

from typing import Annotated, Literal, Self

from pydantic import BeforeValidator, Field, model_validator

from dify_agent.protocol.native_continuation import RedisStreamID
from dify_agent.protocol.native_testing import AgentCheckpointRef, AgentParentNodeRef, Counter, Digest, ID, NativeDTO


def _recovery_protocol_version(value: object) -> int:
    """Require integer version one; bool/coerced versions cannot select this schema."""
    if not isinstance(value, int) or isinstance(value, bool) or value != 1:
        raise ValueError("unsupported recovery protocol version")
    return value


RecoveryProtocolVersion = Annotated[Literal[1], BeforeValidator(_recovery_protocol_version)]


class AgentRecoveryReconstruction(NativeDTO):
    """First reconstruction whitelist; hydration stays with the binding owner."""

    protocol_version: RecoveryProtocolVersion = 1
    kind: Literal["empty-bootstrap-v1"]
    home_snapshot_id: ID | None
    home_snapshot_digest: Digest | None

    @model_validator(mode="after")
    def paired_home(self) -> Self:
        if (self.home_snapshot_id is None) != (self.home_snapshot_digest is None):
            raise ValueError("incomplete pinned Home identity")
        return self


class AgentRecoveryBinding(NativeDTO):
    """One exact logical/physical selection, with its immutable config association."""

    binding_id: ID
    workspace_id: ID
    binding_ref: ID
    workspace_ref: ID
    workspace_generation: Counter
    association_object_ref: ID
    config_ref: ID
    config_digest: Digest


class AgentRecoveryOperationSubstitution(NativeDTO):
    predecessor_operation_id: ID
    successor_operation_id: ID

    @model_validator(mode="after")
    def fresh_operation(self) -> Self:
        """Require distinct operation IDs; actual never-dispatched proof is owner-held."""
        if self.predecessor_operation_id == self.successor_operation_id:
            raise ValueError("recovery requires a fresh pending operation")
        return self


class AgentRecoverySuccessor(NativeDTO):
    """Bind an exact old wait to a fresh workspace, config and sanitized checkpoint."""

    protocol_version: RecoveryProtocolVersion = 1
    attempt_id: Digest
    parent_node: AgentParentNodeRef
    agent_run_id: ID
    expected_parent_generation: Counter
    expected_agent_generation: Counter
    predecessor: AgentRecoveryBinding
    successor: AgentRecoveryBinding
    predecessor_checkpoint: AgentCheckpointRef
    successor_checkpoint: AgentCheckpointRef
    predecessor_waiting_event_id: RedisStreamID
    reconstruction_object_ref: ID
    reconstruction_digest: Digest
    pending_operation_substitutions: tuple[AgentRecoveryOperationSubstitution, ...] = Field(
        min_length=1, max_length=4096
    )

    @model_validator(mode="after")
    def fresh_identity(self) -> Self:
        """Reject reused resources, skipped generations and ambiguous pending mappings."""
        old, new = self.predecessor, self.successor
        if new.workspace_generation != old.workspace_generation + 1 or any(
            before == after
            for before, after in (
                (old.binding_id, new.binding_id),
                (old.workspace_id, new.workspace_id),
                (old.binding_ref, new.binding_ref),
                (old.workspace_ref, new.workspace_ref),
                (old.association_object_ref, new.association_object_ref),
                (old.config_ref, new.config_ref),
                (old.config_digest, new.config_digest),
                (self.predecessor_checkpoint.checkpoint_id, self.successor_checkpoint.checkpoint_id),
                (self.predecessor_checkpoint.payload_digest, self.successor_checkpoint.payload_digest),
            )
        ):
            raise ValueError("recovery requires a fresh exact successor")
        before = {p.predecessor_operation_id for p in self.pending_operation_substitutions}
        after = {p.successor_operation_id for p in self.pending_operation_substitutions}
        if len(before) != len(self.pending_operation_substitutions) or len(after) != len(before) or before & after:
            raise ValueError("ambiguous recovery operation substitution")
        return self


def recovery_successor_digest(successor: AgentRecoverySuccessor) -> str:
    """Hash the exact validated relation as canonical finite JSON, without I/O."""
    raw = json.dumps(
        successor.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class InstallConfirmedRecoverySuccessorRequest(NativeDTO):
    successor: AgentRecoverySuccessor
    successor_object_ref: ID
    successor_digest: Digest

    @model_validator(mode="after")
    def exact_relation_digest(self) -> Self:
        """Reject conflicting relation bytes before the protected owner validates authority."""
        if self.successor_digest != recovery_successor_digest(self.successor):
            raise ValueError("recovery successor digest mismatch")
        return self


class InstallConfirmedRecoverySuccessorReceipt(NativeDTO):
    """Exact acknowledged relation and selected wait, with all three generations."""

    protocol_version: RecoveryProtocolVersion = 1
    attempt_id: Digest
    successor_digest: Digest
    agent_run_id: ID
    parent_generation: Counter
    agent_generation: Counter
    workspace_generation: Counter
    config_ref: ID
    config_digest: Digest
    checkpoint: AgentCheckpointRef
    waiting_event_id: RedisStreamID


__all__ = [
    "recovery_successor_digest",
    "AgentRecoveryReconstruction",
    "AgentRecoveryBinding",
    "AgentRecoveryOperationSubstitution",
    "AgentRecoverySuccessor",
    "InstallConfirmedRecoverySuccessorRequest",
    "InstallConfirmedRecoverySuccessorReceipt",
]
