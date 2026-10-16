"""Types-only native workflow adapter boundary, persisted by the coordination owner.

DTO validation establishes structure, never tenant ownership or authorization.
Frozen models prevent field replacement; stored graph/input JSON and references
must still be resolved and verified by the trusted state owner before execution.
"""

import json
from typing import Annotated, Literal, Protocol, Self

from pydantic import Field, TypeAdapter, field_validator, model_validator

from services.dify_builder.native_testing.agent_contracts import AgentWaitAssociation
from services.dify_builder.native_testing.approval_contracts import NativeApprovalProposal
from services.dify_builder.native_testing.contracts import (
    CheckpointRef,
    EffectIntent,
    FiniteJSON,
    FrozenDTO,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    WaitReason,
    operation_digest,
)

_FINITE_JSON = TypeAdapter(FiniteJSON)
NonNegativeInt = Annotated[int, Field(ge=0)]


class ResolvedNativeTestContext(FrozenDTO):
    """Server-resolved execution data; only the state owner can establish trust."""

    ref: NativeTestContextRef
    tenant_id: str
    actor_id: str
    app_id: str
    workflow_id: str
    graph: dict[str, JsonValue]
    inputs: dict[str, JsonValue]
    graph_revision: str
    input_revision: str
    resource_manifest: tuple[dict[str, JsonValue], ...]
    generation: NonNegativeInt
    root_native_run_id: str | None
    native_run_id: str | None
    parent_invocation_id: str | None
    call_depth: NonNegativeInt
    budget_ref: str
    cancellation_ref: str
    execution_mode: Literal["native", "mock"]

    @field_validator("graph", "inputs", mode="before")
    @classmethod
    def validate_json_object(cls, value: object) -> JsonValue:
        return _FINITE_JSON.validate_python(value)

    @field_validator("resource_manifest", mode="before")
    @classmethod
    def validate_resource_json(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)):
            raise ValueError("resource_manifest must be a list or tuple")
        for resource in value:
            _FINITE_JSON.validate_python(resource)
        return value


class NodeJournalState(FrozenDTO):
    """Durable node occurrence and its already claimed child operations."""

    invocation_id: str
    occurrence_path: tuple[str, ...]
    input_result_ref: str
    input_digest: str
    cursor: NonNegativeInt
    operation_keys: tuple[OperationKey, ...]
    result_refs: tuple[str, ...]
    # Private execution material; never use an immutable result slot for inputs.
    # Empty keeps old checkpoints readable, but cannot authorize a decision.
    intents: tuple[EffectIntent, ...] = ()

    @model_validator(mode="after")
    def validate_intent_owners(self) -> Self:
        keys = {operation_digest(key) for key in self.operation_keys}
        if len(keys) != len(self.operation_keys):
            raise ValueError("duplicate journal operation identity")
        for key in self.operation_keys:
            if key.invocation_id != self.invocation_id or key.occurrence_path != self.occurrence_path:
                raise ValueError("journal operation owner mismatch")
        seen: set[str] = set()
        for intent in self.intents:
            identity = operation_digest(intent.key)
            if identity not in keys or identity in seen:
                raise ValueError("journal intent identity mismatch")
            seen.add(identity)
        return self


class NativeCheckpointPayload(FrozenDTO):
    """Private recovery data; binary files belong in referenced storage objects."""

    schema_version: Literal["1"]
    native_run_id: str
    generation: NonNegativeInt
    generate_entity_json: str
    graph_runtime_state_json: str
    response_stream_filter_json: str
    node_journals: tuple[NodeJournalState, ...]
    child_refs: tuple[NativeTestContextRef, ...]
    input_result_refs: tuple[str, ...]
    approval_proposals: tuple[NativeApprovalProposal, ...] = ()
    agent_associations: Annotated[tuple[AgentWaitAssociation, ...], Field(max_length=4096)] = ()

    @model_validator(mode="after")
    def validate_unique_operation_identities(self) -> Self:
        seen: set[str] = set()
        for journal in self.node_journals:
            for key in journal.operation_keys:
                identity = operation_digest(key)
                if identity in seen:
                    raise ValueError("duplicate checkpoint operation identity")
                seen.add(identity)
        intent_keys = {operation_digest(intent.key) for journal in self.node_journals for intent in journal.intents}
        proposals: set[str] = set()
        for proposal in self.approval_proposals:
            identity = operation_digest(proposal.key)
            if identity not in intent_keys or identity in proposals:
                raise ValueError("approval proposal intent identity mismatch")
            proposals.add(identity)
        parent_nodes: set[tuple[str, str, str, str]] = set()
        for association in self.agent_associations:
            parent = association.parent_node
            identity = (parent.ref.request_id, parent.ref.invocation_id, parent.ref.context_digest, parent.execution_id)
            if identity in parent_nodes:
                raise ValueError("duplicate checkpoint Agent parent locator")
            parent_nodes.add(identity)
            matches = [
                journal
                for journal in self.node_journals
                if journal.invocation_id == parent.ref.invocation_id
                and journal.occurrence_path == (parent.execution_id,)
                and journal.input_result_ref == parent.input_result_ref
                and journal.input_digest == parent.input_digest
            ]
            if len(matches) != 1:
                raise ValueError("checkpoint Agent journal/input mismatch")
        return self

    @field_validator("generate_entity_json", "graph_runtime_state_json", "response_stream_filter_json")
    @classmethod
    def validate_serialized_json(cls, value: str) -> str:
        _FINITE_JSON.validate_python(json.loads(value))
        return value


class NativeWorkflowOutcome(FrozenDTO):
    """Adapter result discriminated by status; native business failures complete.

    A waiting checkpoint reference is a structural requirement. Only a successful
    state-owner commit and the lifecycle receipt establish that it is durable.
    """

    status: Literal["completed", "waiting", "stopped", "unknown"]
    ref: NativeTestContextRef
    native_run_id: str | None
    checkpoint_ref: CheckpointRef | None
    pending_operation_ids: tuple[str, ...]
    reason_code: str | None
    wait_reason: WaitReason | None
    native_status: Literal["succeeded", "failed", "partial-succeeded", "stopped"] | None
    output_result_ref: str | None

    @model_validator(mode="after")
    def validate_status(self) -> Self:
        if self.status == "waiting":
            if self.checkpoint_ref is None:
                raise ValueError("waiting requires a committed checkpoint_ref")
            if not self.native_run_id:
                raise ValueError("waiting requires native_run_id")
            if not self.pending_operation_ids:
                raise ValueError("waiting requires pending_operation_ids")
            if self.wait_reason is None:
                raise ValueError("waiting requires wait_reason")
        elif self.wait_reason is not None:
            raise ValueError("wait_reason is only allowed for waiting")
        if self.status == "completed":
            if not self.native_run_id:
                raise ValueError("completed requires native_run_id")
            if self.native_status is None:
                raise ValueError("completed requires native_status")
        elif self.output_result_ref is not None:
            raise ValueError("output_result_ref is only allowed for completed")
        return self


class NativeBuilderProjection(FrozenDTO):
    """Public Builder route, preserving the lifecycle's actual wait category."""

    route: Literal["waiting", "review", "diagnose", "stopped", "unknown"]
    native_run_id: str | None
    public_receipt_ref: str | None
    wait_reason: WaitReason | None
    can_diagnose: bool
    can_start_new_run: bool

    @model_validator(mode="after")
    def validate_route(self) -> Self:
        if self.route == "waiting":
            if self.wait_reason is None:
                raise ValueError("waiting requires wait_reason")
        elif self.wait_reason is not None:
            raise ValueError("wait_reason is only allowed for waiting")
        if self.route in ("waiting", "unknown", "stopped"):
            if self.can_diagnose:
                raise ValueError("can_diagnose must be False for control routes")
            if self.can_start_new_run:
                raise ValueError("can_start_new_run must be False for control routes")
        return self


class NativeNodeCoverage(FrozenDTO):
    """A native node implementation's declared coverage and known limitation."""

    mode: str
    node_type: str
    node_version: str
    implementation: str
    schema_fixture: str
    effect_owners: tuple[str, ...]
    test_ids: tuple[str, ...]
    limitation_reason: str | None


class NativeStatePort(Protocol):
    """C03 owns scope validation and persistence of private execution state."""

    def load_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext: ...

    def commit_checkpoint(
        self, *, ref: NativeTestContextRef, generation: int, payload: NativeCheckpointPayload
    ) -> CheckpointRef:
        """Return only after payload and metadata have both committed."""
        ...

    def read_checkpoint(self, *, ref: NativeTestContextRef, checkpoint: CheckpointRef) -> NativeCheckpointPayload: ...

    def store_result(self, *, ref: NativeTestContextRef, key: OperationKey, result: JsonValue) -> str: ...

    def load_result(self, *, ref: NativeTestContextRef, result_ref: str) -> JsonValue: ...


class ChildInvocationPort(Protocol):
    """C03 owns atomic child identity, scope, budgets, and parent resume outbox."""

    def get_or_create(
        self,
        *,
        parent_ref: NativeTestContextRef,
        key: OperationKey,
        child_app_id: str,
        child_workflow_revision: str,
        input_digest: str,
        input_result_ref: str,
    ) -> NativeTestContextRef:
        """Validate input owner and digest, then atomically return the unique child."""
        ...

    def complete(self, *, child_ref: NativeTestContextRef, outcome: NativeWorkflowOutcome) -> None:
        """Atomically record terminal state and the unique parent resume event."""
        ...
