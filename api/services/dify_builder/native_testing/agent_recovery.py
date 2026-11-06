"""Interaction-owned recovery admission, durable transitions and mutation fences.

The existing confirmed command owner alone may initiate replacement allocation.
SQL readiness never grants execution until SDK and refreshed wait ACKs are durable.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Self

from dify_agent.protocol import CreateExecutionBindingRequest, CreateExecutionBindingResponse
from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding, AgentRecoverySuccessor
from pydantic import Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from models.dify_builder_native_tests import NativeTestInvocation
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, Digest, canonical_digest
from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef, AgentWaitAssociation
from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal
from runtime_contracts.builder.native.contracts import (
    ID,
    CheckpointRef,
    Counter,
    EffectIntent,
    FiniteJSON,
    FrozenDTO,
    NativeTestContextRef,
    OperationKey,
    operation_digest,
)
from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY, AgentRecoveryRecord

if TYPE_CHECKING:
    from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorReceipt
    from dify_agent.protocol.native_continuation import AgentCheckpoint

    from runtime_contracts.builder.native.agent_contracts import (
        AgentNodeAssociation,
        AgentPreparedConfig,
        AgentTestWorkspaceRef,
    )
    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, ResolvedNativeTestContext
    from services.dify_builder.native_testing.state_store import ObjectReceipt


@dataclass(frozen=True)
class ConfirmedSnapshotIdentity:
    """Original executable identity captured before this worker reads events."""

    parent_node: AgentParentNodeRef
    parent_generation: int
    agent_run_id: str
    agent_generation: int
    binding: AgentRecoveryBinding
    recovery: "RecoveryPendingState | None" = None


class RecoveryAllocationReceipt(FrozenDTO):
    """Protected exact ordinary request/response; never an authorization grant."""

    attempt_id: Digest
    request: CreateExecutionBindingRequest
    response: CreateExecutionBindingResponse


class RecoveryPreparedConfigPayload(FrozenDTO):
    """Immutable executable config bytes; receipt identity is assigned by its owner.

    No self-referencing object ID is encoded. Readers wrap acknowledged receipt.id
    and canonical executable digest in the unchanged SDK prepared-config DTO.
    """

    schema_version: Literal["agent-recovery-config-v1"]
    parent_node: AgentParentNodeRef
    config: FiniteJSON


@dataclass(frozen=True)
class PreparedRecoverySelection:
    """Acknowledged immutable graph supplied by the later 3C producer."""

    expected: AgentRecoveryRecord
    relation: AgentRecoverySuccessor
    relation_receipt: "ObjectReceipt"
    config_receipt: "ObjectReceipt"
    association_receipt: "ObjectReceipt"
    checkpoint_receipt: "ObjectReceipt"
    reconstruction_receipt: "ObjectReceipt"


@dataclass(frozen=True)
class SelectedRecovery:
    """Decoded immutable graph; current SQL selection is rechecked after all I/O."""

    record: AgentRecoveryRecord
    relation: AgentRecoverySuccessor
    config: "AgentPreparedConfig"
    association: "AgentNodeAssociation"
    checkpoint: "AgentCheckpoint"
    predecessor_config: "AgentPreparedConfig"
    predecessor_association: "AgentNodeAssociation"
    predecessor_wait: "AgentWaitAssociation"
    predecessor_checkpoint: "AgentCheckpoint"
    receipts: tuple["ObjectReceipt", ...]


class RecoveryStagedPending(FrozenDTO):
    """Server-produced inert pending mapping; consumers recheck SQL ownership."""

    predecessor_pending_id: ID
    pending_id: ID
    intent: "EffectIntent"
    proposal: "NativeApprovalProposal"


class RecoveryApprovalEntry(FrozenDTO):
    """One fresh pending action and its freshly assessed disclosure."""

    predecessor_pending_id: ID
    pending_id: ID
    intent: EffectIntent
    proposal: NativeApprovalProposal


class RecoveryPendingSelection(FrozenDTO):
    """One immutable selected overlay; the parent checkpoint remains unchanged."""

    schema_version: Literal["agent-recovery-pending-v1"]
    attempt_id: Digest
    original_checkpoint: CheckpointRef
    parent_generation: Counter
    relation_ref: ID
    relation_digest: Digest
    sdk_receipt_ref: ID
    wait: AgentWaitAssociation
    approvals: tuple[RecoveryApprovalEntry, ...] = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def exact_entries(self) -> Self:
        if (
            len({e.pending_id for e in self.approvals}) != len(self.approvals)
            or len({e.predecessor_pending_id for e in self.approvals}) != len(self.approvals)
            or any(e.pending_id == e.predecessor_pending_id or e.intent.key != e.proposal.key for e in self.approvals)
        ):
            raise ValueError("invalid recovery approvals")
        return self


class RecoveryPendingProof(FrozenDTO):
    """Decoded overlay and its actual protected-object receipt identity."""

    object_ref: ID
    value_digest: Digest
    selection: RecoveryPendingSelection


@dataclass(frozen=True)
class RecoveryPendingState:
    """Per-call protected graph and receipt evidence, never a cached authority."""

    proof: RecoveryPendingProof
    graph: SelectedRecovery
    sdk_receipt: "InstallConfirmedRecoverySuccessorReceipt"
    sdk_object: "ObjectReceipt"
    wait_object: "ObjectReceipt"
    original_object: "ObjectReceipt"
    original_payload: "NativeCheckpointPayload"
    snapshot_objects: tuple["ObjectReceipt", ...]
    context: "ResolvedNativeTestContext"
    workspace: "AgentTestWorkspaceRef"
    resource_digest: str


def validate_allocation_receipt(
    *,
    expected: AgentRecoveryRecord,
    receipt: RecoveryAllocationReceipt,
    tenant_id: str,
    agent_id: str,
    home_snapshot_ref: str | None,
) -> None:
    """Require one reserved ordinary request and fresh physical refs, without I/O.

    The owning caller reconstructs tenant/Agent/Home from protected SQL state.
    A response proves refs for that request only, not server idempotence.
    """
    request, response = receipt.request, receipt.response
    if (
        (
            receipt.attempt_id,
            request.tenant_id,
            request.agent_id,
            request.binding_id,
            request.workspace_id,
            request.existing_workspace_ref,
            request.home_snapshot_ref,
            request.native_test_scope,
            request.native_scope_reconcile,
        )
        != (
            expected.attempt_id,
            tenant_id,
            agent_id,
            expected.reserved_binding_id,
            expected.reserved_workspace_id,
            None,
            home_snapshot_ref,
            None,
            False,
        )
        or response.binding_ref == expected.predecessor.binding_ref
        or response.workspace_ref == expected.predecessor.workspace_ref
    ):
        raise BuilderExecutionPolicyError("native_agent_recovery_allocation_mismatch")


def recovery_record(bindings: dict) -> AgentRecoveryRecord | None:
    """Parse the private SQL pointer, refusing corruption without external I/O.

    Absence means the invocation has never reserved recovery. A malformed present
    pointer fails closed and cannot be treated as the generation-zero case.
    """
    if RECOVERY_RECORD_KEY not in bindings:
        return None
    try:
        return AgentRecoveryRecord.model_validate(bindings[RECOVERY_RECORD_KEY])
    except ValidationError:
        raise BuilderExecutionPolicyError("native_agent_recovery_unready") from None


def require_recovery_mutation(*, bindings: dict, binding_id: str, workspace_generation: int) -> None:
    """Fence a mutation using the root writer's current binding selection.

    Preconditions: bindings were read by the existing owned root writer; the
    identity comes from the protected config/intent, never caller classification.
    Success grants no permit: existing approval and dispatch checks still apply.
    All partial handshakes and predecessor writes fail without side effects.
    """
    record = recovery_record(bindings)
    if record is None:
        return
    if record.phase != "ready" or record.sdk_receipt_ref is None or record.successor_wait_ref is None:
        raise BuilderExecutionPolicyError("native_agent_recovery_unready")
    if (binding_id, workspace_generation) != (record.reserved_binding_id, record.next_workspace_generation):
        raise BuilderExecutionPolicyError("native_agent_recovery_identity_mismatch")


def _locked_invocation(*, session: Session, tenant_id: str, ref: NativeTestContextRef) -> NativeTestInvocation:
    """Lock and refresh one exact active invocation inside the caller's root transaction.

    Missing/inactive/foreign rows refuse before mutation. The caller owns commit
    or rollback; no network, storage or permission I/O occurs here.
    """
    from services.dify_builder.native_testing.state_store import owner_query

    invocation = session.scalar(
        owner_query(NativeTestInvocation, ref, tenant_id)
        .where(NativeTestInvocation.active.is_(True))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if invocation is None:
        raise BuilderExecutionPolicyError("native_invocation_mismatch")
    return invocation


def reserve_recovery_attempt(
    *, session: Session, tenant_id: str, ref: NativeTestContextRef, proposed: AgentRecoveryRecord
) -> tuple[AgentRecoveryRecord, bool]:
    """Coalesce one exact predecessor under the existing root writer transaction.

    The caller must first prove eligibility and acknowledge protected evidence in
    this same transaction. No allocation or I/O occurs here. The row lock adds a
    final CAS guard; the existing request/root lock remains the global owner.
    Different interaction keys preserve the first reserved IDs and digest. A
    changed immutable input conflicts rather than silently selecting an attempt.
    """
    if proposed.phase != "reserved" or proposed.identity.invocation_id != ref.invocation_id:
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    invocation = _locked_invocation(session=session, tenant_id=tenant_id, ref=ref)
    current = recovery_record(invocation.bindings)
    if current is not None:
        immutable_fields = {
            "identity",
            "attempt_id",
            "predecessor",
            "predecessor_checkpoint",
            "parent_generation",
            "agent_generation",
            "next_workspace_generation",
            "input_digest",
            "definition_digest",
            "home_snapshot_id",
            "home_snapshot_digest",
        }
        if current.model_dump(include=immutable_fields) != proposed.model_dump(include=immutable_fields):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        return current, False
    invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: proposed.model_dump(mode="json")}
    return proposed, True


def claim_recovery_allocation(
    *, session: Session, tenant_id: str, ref: NativeTestContextRef, expected: AgentRecoveryRecord
) -> AgentRecoveryRecord | None:
    """Return the sole reserved->creating winner, or None without new authority.

    The caller commits before invoking backend create. Creating has no lease and
    cannot be reclaimed even after a crash before network I/O. Duplicate callers
    and unknown attempts never receive physical allocation authority.
    """
    invocation = _locked_invocation(session=session, tenant_id=tenant_id, ref=ref)
    current = recovery_record(invocation.bindings)
    if current is None or current.attempt_id != expected.attempt_id:
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    if current.phase != "reserved":
        return None
    if current != expected:
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    creating = AgentRecoveryRecord.model_validate({**current.model_dump(), "phase": "creating"})
    invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: creating.model_dump(mode="json")}
    return creating


def require_recovery_operation(*, bindings: dict, key: OperationKey) -> None:
    """Fence prepare/claim with the generation embedded by the trusted cursor owner.

    Absence of a recovery record preserves legacy keys. Recovery requires the exact fresh
    occurrence prefix and completed two-store handshake; this is an additional
    constraint on existing binding, permit and dispatch validation.
    """
    record = recovery_record(bindings)
    if record is None:
        return
    require_recovery_mutation(
        bindings=bindings, binding_id=record.reserved_binding_id, workspace_generation=record.next_workspace_generation
    )
    if key.occurrence_path[:3] != (
        record.identity.parent_execution_id,
        "recovery",
        str(record.next_workspace_generation),
    ):
        raise BuilderExecutionPolicyError("native_agent_recovery_identity_mismatch")


def settle_recovery_allocation(
    *,
    session: Session,
    tenant_id: str,
    ref: NativeTestContextRef,
    expected: AgentRecoveryRecord,
    allocation_receipt_ref: str,
) -> AgentRecoveryRecord:
    """Retain a confirmed incurred allocation even after authority is revoked.

    Caller holds the existing settlement root lock and acknowledges exact bytes
    in this transaction. This writes evidence only, never selects a successor.
    Exact replay succeeds; changed evidence or a different attempt refuses.
    """
    from services.dify_builder.native_testing.agent_recovery_state import advance_recovery_record
    from services.dify_builder.native_testing.state_store import owner_query

    invocation = session.scalar(
        owner_query(NativeTestInvocation, ref, tenant_id).with_for_update().execution_options(populate_existing=True)
    )
    if invocation is None or expected.phase != "creating":
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    current = recovery_record(invocation.bindings)
    proposed = AgentRecoveryRecord.model_validate(
        {**expected.model_dump(), "phase": "allocated", "allocation_receipt_ref": allocation_receipt_ref}
    )
    if current is not None and current == proposed:
        return current
    if current is None or current != expected:
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    proposed = advance_recovery_record(current, proposed)
    invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: proposed.model_dump(mode="json")}
    return proposed


def write_confirmed_snapshot(
    *,
    session: Session,
    tenant_id: str,
    bindings: dict,
    identity: ConfirmedSnapshotIdentity,
    current: ConfirmedSnapshotIdentity,
    serialized_snapshot: str,
) -> None:
    """Write only the original complete tuple in the caller's root transaction.

    Caller reconstructs current from protected objects and checks full SQL owner,
    pin, execution, scope and generation chain. No read/write crosses this lock.
    Recovery reservation and snapshot write therefore have one ordering owner.
    """
    from sqlalchemy import select

    from models.agent import AgentWorkingResourceStatus, AgentWorkspaceBinding

    invocation = _locked_invocation(session=session, tenant_id=tenant_id, ref=identity.parent_node.ref)
    require_recovery_mutation(
        bindings=invocation.bindings,
        binding_id=identity.binding.binding_id,
        workspace_generation=identity.binding.workspace_generation,
    )
    require_recovery_mutation(
        bindings=bindings,
        binding_id=identity.binding.binding_id,
        workspace_generation=identity.binding.workspace_generation,
    )
    if identity != current:
        raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
    binding = session.scalar(
        select(AgentWorkspaceBinding)
        .where(
            AgentWorkspaceBinding.id == identity.binding.binding_id,
            AgentWorkspaceBinding.tenant_id == tenant_id,
            AgentWorkspaceBinding.workspace_id == identity.binding.workspace_id,
            AgentWorkspaceBinding.backend_binding_ref == identity.binding.binding_ref,
            AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if binding is None:
        raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
    binding.session_snapshot = serialized_snapshot


def finalize_recovery_selection(
    *,
    session: Session,
    tenant_id: str,
    ref: NativeTestContextRef,
    selection: PreparedRecoverySelection,
    session_scope,
) -> AgentRecoveryRecord:
    """Atomically select an acknowledged graph and replace one exclusive SQL participant.

    Caller validates protected bytes/access/pause/pins before this root transaction.
    Exact receipt readback and immutable attempt CAS occur here. SQL-ready grants
    no execution; rollback retains the earlier durable allocation ACK.
    """
    from dataclasses import asdict

    from dify_agent.protocol.confirmed_recovery import recovery_successor_digest

    from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
    from models.agent import AgentWorkspace
    from models.dify_builder_native_tests import NativePayloadObject
    from models.workflow import WorkflowNodeExecutionModel
    from runtime_contracts.builder.native.agent_contracts import (
        AgentTestWorkspaceRef,
    )
    from services.agent.workspace_service import AgentWorkspaceService
    from services.dify_builder.native_testing.agent_confirmed_workspace import ALLOCATION
    from services.dify_builder.native_testing.agent_recovery_state import advance_recovery_record
    from services.dify_builder.native_testing.state_store import ObjectReceipt, owner_query

    invocation = _locked_invocation(session=session, tenant_id=tenant_id, ref=ref)
    expected, relation = selection.expected, selection.relation
    # The original immutable node-input owner binds the complete parent, including
    # its result-object ID. A matching digest alone cannot adopt another input ref.
    input_row = session.scalar(
        owner_query(NativePayloadObject, ref, tenant_id).where(
            NativePayloadObject.kind == "result",
            NativePayloadObject.logical_key == "node-input:" + expected.identity.parent_execution_id,
        )
    )
    if input_row is None or (input_row.id, input_row.value_digest) != (
        relation.parent_node.input_result_ref,
        expected.input_digest,
    ):
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    if expected.phase != "allocated" or (
        relation.attempt_id,
        relation.parent_node.ref.model_dump(mode="json"),
        relation.parent_node.execution_id,
        relation.parent_node.input_digest,
        relation.expected_parent_generation,
        relation.expected_agent_generation,
        relation.predecessor,
        relation.predecessor_checkpoint,
        relation.successor.binding_id,
        relation.successor.workspace_id,
        relation.successor.workspace_generation,
        relation.successor.config_ref,
        relation.successor.association_object_ref,
        relation.reconstruction_object_ref,
        relation.successor_checkpoint.checkpoint_id,
    ) != (
        expected.attempt_id,
        ref.model_dump(mode="json"),
        expected.identity.parent_execution_id,
        expected.input_digest,
        expected.parent_generation,
        expected.agent_generation,
        expected.predecessor,
        expected.predecessor_checkpoint,
        expected.reserved_binding_id,
        expected.reserved_workspace_id,
        expected.next_workspace_generation,
        selection.config_receipt.id,
        selection.association_receipt.id,
        selection.reconstruction_receipt.id,
        selection.checkpoint_receipt.id,
    ):
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    for role, receipt in (
        ("relation", selection.relation_receipt),
        ("config", selection.config_receipt),
        ("association", selection.association_receipt),
        ("checkpoint", selection.checkpoint_receipt),
        ("reconstruction", selection.reconstruction_receipt),
    ):
        if (receipt.tenant_id, receipt.request_id, receipt.invocation_id, receipt.kind, receipt.logical_key) != (
            tenant_id,
            ref.request_id,
            ref.invocation_id,
            "result",
            "agent-recovery:" + expected.attempt_id + ":" + role,
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        row = session.scalar(
            owner_query(NativePayloadObject, ref, tenant_id).where(NativePayloadObject.id == receipt.id)
        )
        if row is None or ObjectReceipt.from_payload_object(row) != receipt:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    digest = recovery_successor_digest(relation)
    if selection.relation_receipt.value_digest != digest or (
        selection.checkpoint_receipt.value_digest,
        selection.reconstruction_receipt.value_digest,
    ) != (relation.successor_checkpoint.payload_digest, relation.reconstruction_digest):
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    ready = advance_recovery_record(
        expected,
        AgentRecoveryRecord.model_validate(
            {
                **expected.model_dump(),
                "phase": "ready",
                "successor_object_ref": selection.relation_receipt.id,
                "successor_digest": digest,
            }
        ),
    )
    current = recovery_record(invocation.bindings)
    if current is not None and current.phase == "ready":
        try:
            advance_recovery_record(ready, current)
        except ValueError:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict") from None
        binding = AgentWorkspaceService.get_active_binding(
            session=session,
            tenant_id=tenant_id,
            binding_id=relation.successor.binding_id,
            expected_owner_scope=session_scope.workspace_owner,
        )
        workspace = session.get(AgentWorkspace, relation.successor.workspace_id)
        execution = session.get(WorkflowNodeExecutionModel, session_scope.node_execution_id)
        if (
            binding is None
            or workspace is None
            or execution is None
            or (
                binding.workspace_id,
                binding.backend_binding_ref,
                binding.agent_id,
                binding.agent_config_version_id,
                binding.base_home_snapshot_id,
                workspace.backend_workspace_ref,
                execution.agent_workspace_binding_id,
            )
            != (
                relation.successor.workspace_id,
                relation.successor.binding_ref,
                session_scope.agent_id,
                session_scope.agent_config_snapshot_id,
                expected.home_snapshot_id,
                relation.successor.workspace_ref,
                relation.successor.binding_id,
            )
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        return current
    if current != expected:
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    AgentWorkspaceService.finalize_confirmed_recovery_binding(
        session=session,
        scope=session_scope.workspace_owner,
        predecessor=relation.predecessor,
        successor=relation.successor,
        agent_id=session_scope.agent_id,
        pinned_snapshot_id=session_scope.agent_config_snapshot_id,
        home_snapshot_id=expected.home_snapshot_id,
    )
    WorkflowAgentWorkspaceStore.rebind_confirmed_node_execution(
        session=session,
        scope=session_scope,
        predecessor_binding_id=relation.predecessor.binding_id,
        successor_binding_id=relation.successor.binding_id,
    )
    workspace = AgentTestWorkspaceRef(
        binding_id=relation.successor.binding_id,
        workspace_id=relation.successor.workspace_id,
        backend_binding_ref=relation.successor.binding_ref,
        backend_workspace_ref=relation.successor.workspace_ref,
        pinned_snapshot_id=session_scope.agent_config_snapshot_id,
        home_snapshot_id=expected.home_snapshot_id,
        workspace_generation=relation.successor.workspace_generation,
    )
    invocation.bindings = {
        **invocation.bindings,
        RECOVERY_RECORD_KEY: ready.model_dump(mode="json"),
        ALLOCATION: {"scope": asdict(session_scope), "workspace": workspace.model_dump(mode="json")},
    }
    return ready


def require_never_dispatched_pending(
    *,
    session: Session,
    tenant_id: str,
    ref: NativeTestContextRef,
    pending_ids: tuple[str, ...],
    generation: int,
) -> None:
    """Prove exact pending ownership and absence of spent attempts/physical claims.

    A pending label alone is insufficient. Call under the same root lock as
    reservation/finalization so dispatch cannot race this zero-effect proof.
    Historical completed operations remain untouched.
    """
    from models.dify_builder_native_tests import (
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativePendingAction,
    )
    from services.dify_builder.native_testing.state_store import owner_query

    pending = list(
        session.scalars(
            owner_query(NativePendingAction, ref, tenant_id).where(
                NativePendingAction.id.in_(pending_ids),
                NativePendingAction.generation == generation,
                NativePendingAction.category == "approval",
            )
        )
    )
    if not pending_ids or len(set(pending_ids)) != len(pending_ids) or {row.id for row in pending} != set(pending_ids):
        raise BuilderExecutionPolicyError("native_agent_recovery_dispatched")
    operation_ids = {row.operation_id for row in pending}
    operations = list(
        session.scalars(
            owner_query(NativeEffectOperation, ref, tenant_id).where(NativeEffectOperation.id.in_(operation_ids))
        )
    )
    if len(operations) != len(pending) or any(
        row.state != "pending" or row.result_ref is not None for row in operations
    ):
        raise BuilderExecutionPolicyError("native_agent_recovery_dispatched")
    for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
        if (
            session.scalar(owner_query(model, ref, tenant_id).where(model.operation_id.in_(operation_ids)).limit(1))
            is not None
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_dispatched")


def waiting_confirmed_checkpoint(*, session, ref, request, owned, scope):
    """Existing waiting-owner proof shared by retention and inert recovery primitives.

    SQL only; current durable approval state, pins, owner and complete in-flight
    evidence are checked in the caller's transaction. No physical work occurs.
    """
    from datetime import UTC

    from sqlalchemy import select

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import (
        NativeContinuation,
        NativeDispatch,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativeEffectOutcome,
        NativeInvocationState,
        NativeTestInvocation,
    )
    from runtime_contracts.builder.native.contracts import CheckpointRef
    from services.dify_builder.native_testing.repository import utc_now
    from services.dify_builder.native_testing.state_store import invocation_state, owner_query

    state = invocation_state(session, ref, owned.tenant_id)
    invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id))
    expires_at = scope.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    current = session.scalar(
        select(DifyBuilderExecutionRequest.id)
        .where(
            DifyBuilderExecutionRequest.tenant_id == owned.tenant_id,
            DifyBuilderExecutionRequest.actor_id == owned.actor_id,
            DifyBuilderExecutionRequest.session_id == owned.session_id,
            DifyBuilderExecutionRequest.test_input_id == owned.test_input_id,
            DifyBuilderExecutionRequest.context["policy_version"].as_string() == ref.policy_version,
        )
        .order_by(DifyBuilderExecutionRequest.created_at.desc(), DifyBuilderExecutionRequest.id.desc())
        .limit(1)
    )
    if (
        current != request.id
        or owned.state != "waiting"
        or not scope.task_approved
        or scope.cancelled
        or expires_at <= utc_now()
        or state.parent_invocation_id is not None
        or state.state != "waiting"
        or state.wait_reason not in {"approval", "configuration", "interaction"}
        or not state.pending_ids
        or state.cancellation_key is not None
        or state.outcome is not None
        or invocation is None
        or not invocation.active
        or "_agent_confirmed_workspace_v1" not in invocation.bindings
    ):
        raise BuilderExecutionPolicyError("native_state_conflict")
    for model, condition in (
        (NativeEffectOperation, NativeEffectOperation.state.in_(("claimed", "unknown"))),
        (NativeEffectOutcome, NativeEffectOutcome.outcome == "unknown"),
        (NativeDispatch, NativeDispatch.state.in_(("queued", "published", "claimed", "unknown"))),
        (NativeInvocationState, NativeInvocationState.state == "unknown"),
    ):
        if (
            session.scalar(
                select(model.id)
                .where(model.tenant_id == owned.tenant_id, model.request_id == ref.request_id, condition)
                .limit(1)
            )
            is not None
        ):
            raise BuilderExecutionPolicyError("native_state_conflict")
    # A physical claim without a durable completed/failed outcome is in flight.
    settled = (
        select(NativeEffectOutcome.id)
        .where(
            NativeEffectOutcome.tenant_id == owned.tenant_id,
            NativeEffectOutcome.request_id == ref.request_id,
            NativeEffectOutcome.attempt_id == NativeEffectDispatchClaim.attempt_id,
            NativeEffectOutcome.operation_id == NativeEffectDispatchClaim.operation_id,
            NativeEffectOutcome.outcome.in_(("completed", "failed")),
        )
        .exists()
    )
    if (
        session.scalar(
            select(NativeEffectDispatchClaim.id)
            .where(
                NativeEffectDispatchClaim.tenant_id == owned.tenant_id,
                NativeEffectDispatchClaim.request_id == ref.request_id,
                ~settled,
            )
            .limit(1)
        )
        is not None
    ):
        raise BuilderExecutionPolicyError("native_state_conflict")
    continuation = session.scalar(
        owner_query(NativeContinuation, ref, owned.tenant_id).where(
            NativeContinuation.checkpoint_id == state.checkpoint_id,
            NativeContinuation.generation == state.generation,
        )
    )
    if continuation is None:
        raise BuilderExecutionPolicyError("checkpoint_unavailable")
    return CheckpointRef(
        checkpoint_id=continuation.checkpoint_id, payload_digest=continuation.payload_digest
    ), state.generation


def block_recovery_allocation_record(
    *,
    session: Session,
    tenant_id: str,
    ref: NativeTestContextRef,
    expected: AgentRecoveryRecord,
) -> AgentRecoveryRecord:
    """Settle known drift on one exact confirmed allocation without granting authority.

    Caller holds the settlement root lock after proving authority/pin/scope or
    reconstruction drift. Only allocated→blocked is admitted. Unknown/creating,
    ready and conflicting attempts refuse; transient SQL failure remains retryable.
    """
    from services.dify_builder.native_testing.agent_recovery_state import advance_recovery_record
    from services.dify_builder.native_testing.state_store import owner_query

    invocation = session.scalar(
        owner_query(NativeTestInvocation, ref, tenant_id).with_for_update().execution_options(populate_existing=True)
    )
    if invocation is None or expected.phase != "allocated" or expected.allocation_receipt_ref is None:
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    current = recovery_record(invocation.bindings)
    blocked = advance_recovery_record(
        expected, AgentRecoveryRecord.model_validate({**expected.model_dump(), "phase": "blocked"})
    )
    if current == blocked:
        return blocked
    if current != expected:
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: blocked.model_dump(mode="json")}
    return blocked


def recheck_staged_recovery_pending(*, session, owned, expected, pending) -> None:
    """SQL-only proof that fresh approval rows are inert and exactly bound.

    Caller holds the root lock and has read the actual protected snapshots.
    Current old pending selection, fresh key namespace/binding/scope, unchanged
    old ownership and zero fresh attempts/grants are mandatory. No mutation.
    """
    from sqlalchemy import select

    from models.dify_builder_native_tests import NativeEffectGrant, NativeEffectOperation, NativePendingAction
    from services.dify_builder.native_testing.authorization import _scope_digest, validate_binding
    from services.dify_builder.native_testing.repository import NativeBinding
    from services.dify_builder.native_testing.state_store import invocation_state, owner_query

    state = invocation_state(session, owned.ref, owned.tenant_id)
    if (
        recovery_record(owned.bindings) != expected
        or expected.phase not in {"allocated", "ready"}
        or expected.successor_wait_ref is not None
        or (
            set(state.pending_ids) != {entry.predecessor_pending_id for entry in pending}
            or any(entry.pending_id in state.pending_ids for entry in pending)
        )
    ):
        raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
    for entry in pending:
        if entry.proposal.key != entry.intent.key or entry.intent.key.occurrence_path[:3] != (
            expected.identity.parent_execution_id,
            "recovery",
            str(expected.next_workspace_generation),
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        raw_binding = owned.bindings.get(operation_digest(entry.intent.key))
        if raw_binding is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        binding = NativeBinding.model_validate(raw_binding)
        validate_binding(entry.intent, binding)
        row = session.scalar(
            owner_query(NativePendingAction, owned.ref, owned.tenant_id).where(
                NativePendingAction.id == entry.pending_id
            )
        )
        operation = (
            None
            if row is None
            else session.scalar(
                owner_query(NativeEffectOperation, owned.ref, owned.tenant_id).where(
                    NativeEffectOperation.id == row.operation_id
                )
            )
        )
        scoped = _scope_digest(entry.intent, binding)
        if (
            row is None
            or operation is None
            or (
                row.reference,
                row.reference_digest,
                row.owner_ref,
                row.owner_version,
                operation.operation_digest,
                operation.intent_digest,
                operation.scope_digest,
            )
            != (
                operation.id,
                canonical_digest(operation.id),
                owned.app_id,
                scoped,
                operation_digest(entry.intent.key),
                canonical_digest(entry.intent.model_dump(mode="json")),
                scoped,
            )
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_path = (expected.identity.parent_execution_id, *entry.intent.key.occurrence_path[-2:])
        if expected.predecessor.workspace_generation > 0:
            old_path = (
                expected.identity.parent_execution_id,
                "recovery",
                str(expected.predecessor.workspace_generation),
                *entry.intent.key.occurrence_path[-2:],
            )
        old_key = OperationKey.model_validate({**entry.intent.key.model_dump(mode="json"), "occurrence_path": old_path})
        old_binding_value = owned.bindings.get(operation_digest(old_key))
        if old_binding_value is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_binding = NativeBinding.model_validate(old_binding_value)
        if old_binding.model_dump(exclude={"intent_digest", "invocation_digest"}) != binding.model_dump(
            exclude={"intent_digest", "invocation_digest"}
        ):
            raise BuilderExecutionPolicyError("native_binding_drift")
        old_intent = EffectIntent.model_validate(
            {
                **entry.intent.model_dump(mode="json"),
                "key": old_key.model_dump(mode="json"),
                "capability_digest": old_binding.capability_digest,
            }
        )
        validate_binding(old_intent, old_binding)
        old_pending = session.scalar(
            owner_query(NativePendingAction, owned.ref, owned.tenant_id).where(
                NativePendingAction.id == entry.predecessor_pending_id
            )
        )
        old_operation = (
            None
            if old_pending is None
            else session.scalar(
                owner_query(NativeEffectOperation, owned.ref, owned.tenant_id).where(
                    NativeEffectOperation.id == old_pending.operation_id
                )
            )
        )
        old_scope = _scope_digest(old_intent, old_binding)
        if (
            old_pending is None
            or old_operation is None
            or (
                old_operation.operation_digest,
                old_operation.intent_digest,
                old_operation.scope_digest,
                old_pending.reference,
                old_pending.reference_digest,
                old_pending.owner_ref,
                old_pending.owner_version,
            )
            != (
                operation_digest(old_key),
                old_binding.intent_digest,
                old_scope,
                old_operation.id,
                canonical_digest(old_operation.id),
                owned.app_id,
                old_scope,
            )
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        require_never_dispatched_pending(
            session=session,
            tenant_id=owned.tenant_id,
            ref=owned.ref,
            pending_ids=(entry.pending_id,),
            generation=expected.parent_generation,
        )
        if (
            session.scalar(
                select(NativeEffectGrant.id).where(
                    NativeEffectGrant.tenant_id == owned.tenant_id,
                    NativeEffectGrant.request_id == owned.ref.request_id,
                    NativeEffectGrant.scope_digest == scoped,
                )
            )
            is not None
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_dispatched")
