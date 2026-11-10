"""Pure private recovery state; parsing and transitions perform no I/O.

Only the existing root writer may persist this record under RECOVERY_RECORD_KEY.
IDs, protected object refs and digests preserve evidence without checkpoint
contents, credentials, scripts, permits, or an unbounded attempt history.
"""

from typing import Literal, Self

from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding, RecoveryProtocolVersion
from dify_agent.protocol.native_testing import AgentCheckpointRef
from pydantic import model_validator

from runtime_contracts.builder.execution import Digest, canonical_digest
from runtime_contracts.builder.native.contracts import ID, Counter, FrozenDTO

RECOVERY_RECORD_KEY = "_agent_confirmed_recovery_v1"
RecoveryPhase = Literal["reserved", "creating", "allocated", "ready", "unknown", "blocked"]


class AgentRecoveryAttemptIdentity(FrozenDTO):
    """Stable predecessor identity, deliberately independent of interaction keys."""

    invocation_id: ID
    parent_execution_id: ID
    predecessor_binding_id: ID
    predecessor_checkpoint_digest: Digest
    predecessor_workspace_generation: Counter


def recovery_attempt_id(identity: AgentRecoveryAttemptIdentity) -> str:
    """Hash validated exact predecessor identity canonically; no allocation occurs."""
    return canonical_digest(identity.model_dump(mode="json"))


class AgentRecoveryRecord(FrozenDTO):
    """One private attempt pointer; immutable arguments remain exact across phases."""

    protocol_version: RecoveryProtocolVersion = 1
    identity: AgentRecoveryAttemptIdentity
    attempt_id: Digest
    predecessor: AgentRecoveryBinding
    predecessor_checkpoint: AgentCheckpointRef
    parent_generation: Counter
    agent_generation: Counter
    reserved_binding_id: ID
    reserved_workspace_id: ID
    next_workspace_generation: Counter
    input_digest: Digest
    definition_digest: Digest
    home_snapshot_id: ID | None
    home_snapshot_digest: Digest | None
    interaction_idempotency_digest: Digest
    phase: RecoveryPhase
    evidence_object_ref: ID
    allocation_receipt_ref: ID | None
    successor_object_ref: ID | None
    successor_digest: Digest | None
    sdk_receipt_ref: ID | None
    successor_wait_ref: ID | None

    @model_validator(mode="after")
    def exact_attempt(self) -> Self:
        """Require coherent predecessor and phase evidence, without granting authority."""
        if (
            self.attempt_id != recovery_attempt_id(self.identity)
            or self.identity.predecessor_binding_id != self.predecessor.binding_id
            or self.identity.predecessor_checkpoint_digest != self.predecessor_checkpoint.payload_digest
            or self.identity.predecessor_workspace_generation != self.predecessor.workspace_generation
            or self.next_workspace_generation != self.predecessor.workspace_generation + 1
            or self.reserved_binding_id == self.predecessor.binding_id
            or self.reserved_workspace_id == self.predecessor.workspace_id
            or (self.home_snapshot_id is None) != (self.home_snapshot_digest is None)
        ):
            raise ValueError("inconsistent recovery attempt identity")
        if self.phase in {"allocated", "ready", "blocked"} and self.allocation_receipt_ref is None:
            raise ValueError("confirmed allocation requires protected receipt")
        if self.phase in {"reserved", "creating", "unknown"} and any(
            ref is not None
            for ref in (
                self.allocation_receipt_ref,
                self.successor_object_ref,
                self.successor_digest,
                self.sdk_receipt_ref,
                self.successor_wait_ref,
            )
        ):
            raise ValueError("unconfirmed allocation cannot carry successor evidence")
        if (self.successor_object_ref is None) != (self.successor_digest is None):
            raise ValueError("successor object and digest must agree")
        if self.phase == "ready" and self.successor_object_ref is None:
            raise ValueError("ready selection requires a protected successor")
        if self.successor_wait_ref is not None and self.sdk_receipt_ref is None:
            raise ValueError("refreshed wait requires acknowledged SDK receipt")
        if self.sdk_receipt_ref is not None and self.phase != "ready":
            raise ValueError("SDK handoff requires SQL-ready successor")
        return self


_PHASE_EDGES: dict[RecoveryPhase, frozenset[RecoveryPhase]] = {
    "reserved": frozenset({"creating"}),
    "creating": frozenset({"allocated", "unknown"}),
    "allocated": frozenset({"ready", "blocked"}),
    "ready": frozenset(),
    "unknown": frozenset(),
    "blocked": frozenset(),
}
_EVIDENCE_FIELDS = frozenset(
    {"allocation_receipt_ref", "successor_object_ref", "successor_digest", "sdk_receipt_ref", "successor_wait_ref"}
)


def advance_recovery_record(current: AgentRecoveryRecord, proposed: AgentRecoveryRecord) -> AgentRecoveryRecord:
    """Validate a pure transition; persistence/locking and lifecycle work stay external.

    Preconditions: both records validated. Postconditions: immutable arguments and
    already acknowledged evidence are unchanged; terminal ambiguity never retries.
    Invalid transitions raise ValueError without changing either input.
    """
    if current.model_dump(exclude=set(_EVIDENCE_FIELDS) | {"phase"}) != proposed.model_dump(
        exclude=set(_EVIDENCE_FIELDS) | {"phase"}
    ):
        raise ValueError("conflicting immutable recovery arguments")
    if current.phase != proposed.phase and proposed.phase not in _PHASE_EDGES[current.phase]:
        raise ValueError("invalid recovery phase transition")
    old_evidence = current.model_dump(include=set(_EVIDENCE_FIELDS))
    new_evidence = proposed.model_dump(include=set(_EVIDENCE_FIELDS))
    if any(value is not None and new_evidence[key] != value for key, value in old_evidence.items()):
        raise ValueError("conflicting acknowledged recovery evidence")
    if current.phase in {"unknown", "blocked"} and current != proposed:
        raise ValueError("terminal recovery record is immutable")
    return proposed
