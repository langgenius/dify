"""Protected native snapshots with a storage-readback + SQL acknowledgement barrier.

The native adapter owns serialization. This owner stores immutable bytes, never
runs Graphon, and never treats a caller's object reference as authorization.
All key-provider and object-storage work happens outside SQL transactions.
"""

import json
import logging
from collections.abc import Generator
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from time import perf_counter
from typing import TYPE_CHECKING, Literal
from uuid import UUID, uuid4

from pydantic import TypeAdapter
from sqlalchemy import select

from core.helper import encrypter
from extensions.ext_storage import storage
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeEffectOperation,
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from models.workflow import Workflow
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from runtime_contracts.builder.native.agent_contracts import (
    AgentCreateClaim,
    AgentCreateExisting,
    AgentCreateInserted,
    AgentDefinitionReceipt,
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentPreparedConfig,
    AgentProtectedState,
    AgentTestWorkspaceRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.contracts import (
    ID,
    CheckpointRef,
    Counter,
    FiniteJSON,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    operation_digest,
)
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.private_reads import (
    PrivateReadOwner,
    validate_invocation_workflow,
    validate_private_read,
)
from services.dify_builder.native_testing.repository import (
    OwnedNativeTestLoader,
    admitted_graph_matches,
    admitted_workflow_revision,
    native_workflow_revision,
    utc_now,
)
from services.dify_builder.native_testing.transitions import require_ancestor_authority

_JSON = TypeAdapter(FiniteJSON)
logger = logging.getLogger(__name__)
PayloadKind = Literal["context", "checkpoint", "result"]

if TYPE_CHECKING:
    from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding
    from dify_agent.protocol.snapshot import SessionSnapshot

    from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
    from services.dify_builder.native_testing.agent_recovery import (
        ConfirmedSnapshotIdentity,
        PreparedRecoverySelection,
        RecoveryAllocationReceipt,
        SelectedRecovery,
    )
    from services.dify_builder.native_testing.agent_recovery_state import AgentRecoveryRecord


def encode_payload(
    *, tenant_id: str, request_id: str, invocation_id: str, kind: str, payload: JsonValue
) -> tuple[str, str]:
    value = _JSON.validate_python(payload)
    envelope = {
        "schema": "1",
        "tenant_id": tenant_id,
        "request_id": request_id,
        "invocation_id": invocation_id,
        "kind": kind,
        "payload": value,
    }
    return json.dumps(
        envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ), canonical_digest(envelope)


def decode_payload(
    raw: str, *, tenant_id: str, request_id: str, invocation_id: str, kind: str, digest: str
) -> JsonValue:
    try:
        envelope = _JSON.validate_python(json.loads(raw))
        if not isinstance(envelope, dict) or set(envelope) != {
            "schema",
            "tenant_id",
            "request_id",
            "invocation_id",
            "kind",
            "payload",
        }:
            raise ValueError("envelope")
        expected = {
            "schema": "1",
            "tenant_id": tenant_id,
            "request_id": request_id,
            "invocation_id": invocation_id,
            "kind": kind,
        }
        if any(envelope.get(k) != v for k, v in expected.items()) or canonical_digest(envelope) != digest:
            raise ValueError("ownership or integrity")
        return envelope["payload"]
    except (ValueError, TypeError):
        raise BuilderExecutionPolicyError("native_payload_invalid") from None


def owner_query(model, ref: NativeTestContextRef, tenant_id: str):
    return select(model).where(
        model.tenant_id == tenant_id, model.request_id == ref.request_id, model.invocation_id == ref.invocation_id
    )


def invocation_state(session, ref: NativeTestContextRef, tenant_id: str) -> NativeInvocationState:
    state = session.scalar(owner_query(NativeInvocationState, ref, tenant_id))
    if state is None:
        raise BuilderExecutionPolicyError("native_state_unavailable")
    return state


@dataclass(frozen=True)
class ObjectReceipt:
    id: str
    tenant_id: str
    request_id: str
    invocation_id: str
    kind: str
    logical_key: str
    storage_key: str
    payload_digest: str
    value_digest: str

    @classmethod
    def from_payload_object(cls, row: NativePayloadObject) -> "ObjectReceipt":
        """Detach the persisted payload identity from its SQLAlchemy session."""
        return cls(
            id=row.id,
            tenant_id=row.tenant_id,
            request_id=row.request_id,
            invocation_id=row.invocation_id,
            kind=row.kind,
            logical_key=row.logical_key,
            storage_key=row.storage_key,
            payload_digest=row.payload_digest,
            value_digest=row.value_digest,
        )


_PAYLOAD_READ_MAX_ENTRIES = 64
_PAYLOAD_READ_MAX_BYTES = 8 * 1024 * 1024


@dataclass
class _PayloadReads:
    encrypted: dict[tuple[ObjectReceipt, int | None], bytes] = field(default_factory=dict)
    byte_count: int = 0
    active: bool = True


_payload_reads: ContextVar[_PayloadReads | None] = ContextVar("native_payload_reads", default=None)


@contextmanager
def native_payload_read_scope() -> Generator[None]:
    """Reuse exact encrypted objects only during one synchronous native command.

    Current owner/permission/resource checks and every decrypt/decode still run.
    Nested owner calls share the outer scope; its finally clears even inherited
    references. No plaintext, authority, expiry or cross-command reuse is stored.
    """
    inherited = _payload_reads.get()
    if inherited is not None and inherited.active:
        yield
        return
    reads = _PayloadReads()
    token = _payload_reads.set(reads)
    try:
        yield
    finally:
        reads.active = False
        reads.encrypted.clear()
        reads.byte_count = 0
        _payload_reads.reset(token)


@dataclass
class _AgentPreparation:
    parent: AgentParentNodeRef
    context: ResolvedNativeTestContext
    authority: PrivateReadOwner
    workspace: AgentTestWorkspaceRef
    resource_digest: str
    objects: list[ObjectReceipt]
    settlement: bool = False
    for_projection: bool = False
    recovery: "SelectedRecovery | None" = None


@contextmanager
def _agent_boundary():
    try:
        yield
    except BuilderExecutionPolicyError:
        raise
    except Exception:
        raise BuilderExecutionPolicyError("native_agent_state_unavailable") from None


class NativeExecutionStateStore:
    def __init__(self, loader: OwnedNativeTestLoader):
        self.loader = loader

    @staticmethod
    def recovery_config_request(*, config, parent, create_idempotency_key: str | None):
        """Rebuild the credentials-free executable request for SDK pure validation."""
        from dify_agent.protocol.schemas import CreateRunRequest

        if create_idempotency_key is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_checkpoint_unsupported")
        return CreateRunRequest.model_validate(
            {
                **config,
                "idempotency_key": create_idempotency_key,
                "execution_mode": "builder_test",
                "native_test_profile": "confirmed",
                "native_test_ref": parent.ref.model_dump(mode="json"),
                "native_test_protocol_version": 1,
                "native_parent_node": parent.model_dump(mode="json"),
            }
        )

    @staticmethod
    def recovery_home_digest(home: AgentHomeSnapshot) -> str:
        """Bind immutable SQL Home identity/ref; this is not a claim about backend bytes."""
        return canonical_digest(
            {"id": home.id, "tenant_id": home.tenant_id, "agent_id": home.agent_id, "snapshot_ref": home.snapshot_ref}
        )

    def prepare_recovery_attempt(self, *, ref, expected):
        """Reload exact retained predecessor and acknowledged evidence outside the writer.

        Parsing a supplied record grants nothing. Full owner/config/input chain
        and protected bytes are reconstructed, then rechecked by the caller.
        """
        from dify_agent.protocol import InspectExecutionBindingResponse
        from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding
        from dify_agent.protocol.native_continuation import AgentCheckpoint

        evidence = self.load_result(ref=ref, result_ref=expected.evidence_object_ref)
        if not isinstance(evidence, dict) or set(evidence) != {
            "parent_node",
            "wait",
            "parent_checkpoint",
            "pause_id",
            "pause_state_object_key",
            "native_run_id",
            "inspection",
            "agent_run_id",
            "pending_ids",
            "allocation_owner",
        }:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        parent = AgentParentNodeRef.model_validate(evidence["parent_node"])
        wait = AgentWaitAssociation.model_validate(evidence["wait"])
        inspection = InspectExecutionBindingResponse.model_validate(evidence["inspection"])
        prepared = self._agent_prepare(
            ref=ref, parent_node=parent, writing=False, expected_generation=expected.parent_generation
        )
        association = self._agent_binding(prepared, expected.predecessor.association_object_ref)
        config = self._agent_prepared_config(prepared, expected.predecessor.config_ref)
        workspace = prepared.workspace
        predecessor = AgentRecoveryBinding(
            binding_id=workspace.binding_id,
            workspace_id=workspace.workspace_id,
            binding_ref=workspace.backend_binding_ref,
            workspace_ref=workspace.backend_workspace_ref,
            workspace_generation=workspace.workspace_generation,
            association_object_ref=expected.predecessor.association_object_ref,
            config_ref=config.config_ref,
            config_digest=config.config_digest,
        )
        if (
            predecessor,
            parent.execution_id,
            parent.input_digest,
            prepared.resource_digest,
            wait.parent_node,
            wait.association_object_ref,
            wait.agent_generation,
            wait.checkpoint_object_ref,
            wait.checkpoint_digest,
            association.agent_run_id,
            inspection.binding_ref,
            inspection.workspace_ref,
            # The DTO validates the exact adapter/evidence pair before this
            # complete protected predecessor identity comparison.
            inspection.state,
        ) != (
            expected.predecessor,
            expected.identity.parent_execution_id,
            expected.input_digest,
            expected.definition_digest,
            parent,
            expected.predecessor.association_object_ref,
            expected.agent_generation,
            expected.predecessor_checkpoint.checkpoint_id,
            expected.predecessor_checkpoint.payload_digest,
            evidence["agent_run_id"],
            predecessor.binding_ref,
            predecessor.workspace_ref,
            "definitively_gone",
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        checkpoint = self._agent_wait_relation(prepared, association, wait)
        if [call.pending_operation_id for call in AgentCheckpoint.model_validate(checkpoint).pending_calls] != evidence[
            "pending_ids"
        ]:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        self._agent_object(
            prepared,
            logical_key="agent-recovery:" + expected.attempt_id + ":evidence",
            object_ref=expected.evidence_object_ref,
        )
        return prepared, evidence

    @staticmethod
    def recheck_recovery_wait(*, session, owned, prepared, evidence, expected) -> None:
        """Recheck durable pause, never-dispatched wait and exclusive old participant.

        Preconditions: root lock and refreshed protected preparation. No external
        I/O occurs; all refusals precede any reserved/creating/final selection write.
        """
        from models.workflow import WorkflowNodeExecutionModel, WorkflowPause, WorkflowRun
        from services.dify_builder.native_testing.agent_recovery import (
            require_never_dispatched_pending,
            waiting_confirmed_checkpoint,
        )

        request = session.get(DifyBuilderExecutionRequest, prepared.parent.ref.request_id)
        scope = session.scalar(
            select(NativeTestScope).where(
                NativeTestScope.request_id == prepared.parent.ref.request_id,
                NativeTestScope.tenant_id == owned.tenant_id,
            )
        )
        if request is None or scope is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        checkpoint, generation = waiting_confirmed_checkpoint(
            session=session, ref=prepared.parent.ref, request=request, owned=owned, scope=scope
        )
        state = invocation_state(session, prepared.parent.ref, owned.tenant_id)
        pause = session.get(WorkflowPause, evidence["pause_id"])
        run = session.get(WorkflowRun, evidence["native_run_id"])
        if (
            (checkpoint.model_dump(mode="json"), generation, state.wait_reason, set(state.pending_ids))
            != (
                evidence["parent_checkpoint"],
                expected.parent_generation,
                "approval",
                set(evidence["pending_ids"]),
            )
            or pause is None
            or run is None
            or (
                pause.state_object_key,
                pause.workflow_run_id,
                pause.resumed_at,
                run.status,
            )
            != (evidence["pause_state_object_key"], evidence["native_run_id"], None, "paused")
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        require_never_dispatched_pending(
            session=session,
            tenant_id=owned.tenant_id,
            ref=prepared.parent.ref,
            pending_ids=tuple(evidence["pending_ids"]),
            generation=expected.parent_generation,
        )
        participants = list(
            session.scalars(
                select(AgentWorkspaceBinding.id)
                .where(
                    AgentWorkspaceBinding.workspace_id == expected.predecessor.workspace_id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                )
                .with_for_update()
            )
        )
        executions = list(
            session.scalars(
                select(WorkflowNodeExecutionModel.id)
                .where(WorkflowNodeExecutionModel.agent_workspace_binding_id == expected.predecessor.binding_id)
                .with_for_update()
            )
        )
        if participants != [expected.predecessor.binding_id] or executions != [expected.identity.parent_execution_id]:
            raise BuilderExecutionPolicyError("native_agent_single_workspace_limit")
        home = None if expected.home_snapshot_id is None else session.get(AgentHomeSnapshot, expected.home_snapshot_id)
        binding = session.get(AgentWorkspaceBinding, expected.predecessor.binding_id)
        if binding is None or evidence["allocation_owner"] != {
            "tenant_id": owned.tenant_id,
            "agent_id": binding.agent_id,
            "home_snapshot_id": expected.home_snapshot_id,
            "home_snapshot_ref": None if home is None else home.snapshot_ref,
            "home_snapshot_digest": None if home is None else NativeExecutionStateStore.recovery_home_digest(home),
        }:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        if (
            None if home is None else NativeExecutionStateStore.recovery_home_digest(home)
        ) != expected.home_snapshot_digest:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")

    def block_recovery_allocation(
        self, *, ref: NativeTestContextRef, expected: "AgentRecoveryRecord"
    ) -> "AgentRecoveryRecord":
        """Inert settlement port for 3C's known authority/pin/scope/reconstruction drift.

        No new allocation, retry or execution authority is granted. Exact allocated
        ACK is retained; creating/unknown/ready are never rewritten. Caller must
        distinguish known drift from transient persistence failure.
        """
        from services.dify_builder.native_testing.agent_recovery import block_recovery_allocation_record

        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _scope):
            return block_recovery_allocation_record(
                session=session, tenant_id=owned.tenant_id, ref=ref, expected=expected
            )

    def _selected_recovery_graph(self, *, owned, context, parent):
        """Decode exactly the SQL-selected ready graph outside every writer lock.

        Unselected staging objects grant no authority. This reconstructs both
        retained and successor tuples, full parent/input/run/pins and canonical
        receipt values, then SDK pure validators prove the allowed substitution.
        The caller must retain this proof for the SQL-only current-row recheck.
        """
        from dify_agent.protocol.confirmed_recovery import (
            AgentRecoveryReconstruction,
            AgentRecoverySuccessor,
            recovery_successor_digest,
        )
        from dify_agent.protocol.native_continuation import AgentCheckpoint
        from dify_agent.runtime.confirmed_recovery import validate_recovery_checkpoint, validate_recovery_configs

        from services.dify_builder.native_testing.agent_recovery import (
            RecoveryAllocationReceipt,
            SelectedRecovery,
            recovery_record,
            validate_allocation_receipt,
        )

        record = recovery_record(owned.bindings)
        if record is None or record.phase != "ready":
            return None
        receipts = []

        def read(logical_key, object_ref):
            with self.loader.session_factory() as session:
                row = session.scalar(
                    owner_query(NativePayloadObject, parent.ref, owned.tenant_id).where(
                        NativePayloadObject.kind == "result",
                        NativePayloadObject.logical_key == logical_key,
                        NativePayloadObject.id == object_ref,
                    )
                )
                if row is None:
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
                receipt = ObjectReceipt.from_payload_object(row)
            receipts.append(receipt)
            return receipt, self._read_object(receipt)

        prefix = "agent-recovery:" + record.attempt_id + ":"
        relation_receipt, raw_relation = read(prefix + "relation", record.successor_object_ref)
        relation = AgentRecoverySuccessor.model_validate(raw_relation)
        if (record.identity.invocation_id, record.identity.parent_execution_id, record.input_digest) != (
            parent.ref.invocation_id,
            parent.execution_id,
            parent.input_digest,
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        if relation_receipt.value_digest != recovery_successor_digest(relation) or (
            relation.parent_node.model_dump(mode="json"),
            relation.attempt_id,
            relation.expected_parent_generation,
            relation.expected_agent_generation,
            relation.predecessor,
            relation.predecessor_checkpoint,
            relation.successor.binding_id,
            relation.successor.workspace_id,
            relation.successor.workspace_generation,
            relation_receipt.value_digest,
        ) != (
            parent.model_dump(mode="json"),
            record.attempt_id,
            record.parent_generation,
            record.agent_generation,
            record.predecessor,
            record.predecessor_checkpoint,
            record.reserved_binding_id,
            record.reserved_workspace_id,
            record.next_workspace_generation,
            record.successor_digest,
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        input_receipt, inputs = read("node-input:" + parent.execution_id, parent.input_result_ref)
        if input_receipt.value_digest != parent.input_digest or canonical_digest(inputs) != record.input_digest:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        _evidence_receipt, evidence = read(prefix + "evidence", record.evidence_object_ref)
        if not isinstance(evidence, dict) or evidence.get("parent_node") != parent.model_dump(mode="json"):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_wait = AgentWaitAssociation.model_validate(evidence["wait"])
        _old_config_receipt, old_config_value = read(
            self._agent_key("agent-config", parent), relation.predecessor.config_ref
        )
        if not isinstance(old_config_value, dict) or (
            old_config_value.get("schema"),
            old_config_value.get("parent_node"),
            old_config_value.get("workflow_native_run_id"),
            old_config_value.get("resource_digest"),
        ) != ("agent-config-v2", parent.model_dump(mode="json"), context.native_run_id, record.definition_digest):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_workspace = AgentTestWorkspaceRef.model_validate(old_config_value["workspace"])
        old_config = AgentPreparedConfig(
            parent_node=parent,
            workflow_native_run_id=context.native_run_id,
            workspace=old_workspace,
            config_ref=relation.predecessor.config_ref,
            config_digest=canonical_digest(self._agent_executable_config(old_config_value["config"], parent)),
            config=old_config_value["config"],
        )
        _old_association_receipt, old_association_value = read(
            self._agent_key("agent-bind", parent), relation.predecessor.association_object_ref
        )
        old_association = AgentNodeAssociation.model_validate(old_association_value)
        _old_checkpoint_receipt, old_checkpoint_value = read(
            self._agent_key("agent-cp", parent, record.agent_generation), record.predecessor_checkpoint.checkpoint_id
        )
        if not isinstance(old_checkpoint_value, dict) or old_checkpoint_value != {
            "schema": "agent-checkpoint-v1",
            "parent_node": parent.model_dump(mode="json"),
            "association_object_ref": relation.predecessor.association_object_ref,
            "agent_generation": record.agent_generation,
            "backend_wait_event_id": relation.predecessor_waiting_event_id,
            "checkpoint": old_checkpoint_value.get("checkpoint"),
        }:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_checkpoint = AgentCheckpoint.model_validate(old_checkpoint_value["checkpoint"])
        config_receipt, config_value = read(prefix + "config", relation.successor.config_ref)
        executable = self._recovery_prepared_config(receipt=config_receipt, value=config_value)
        _association_receipt, association_value = read(
            prefix + "association", relation.successor.association_object_ref
        )
        association = AgentNodeAssociation.model_validate(association_value)
        checkpoint_receipt, checkpoint_value = read(prefix + "checkpoint", relation.successor_checkpoint.checkpoint_id)
        checkpoint = AgentCheckpoint.model_validate(checkpoint_value)
        reconstruction_receipt, reconstruction_value = read(
            prefix + "reconstruction", relation.reconstruction_object_ref
        )
        reconstruction = AgentRecoveryReconstruction.model_validate(reconstruction_value)
        _allocation_receipt, allocation_value = read(prefix + "allocation", record.allocation_receipt_ref)
        allocation = RecoveryAllocationReceipt.model_validate(allocation_value)
        allocation_owner = evidence["allocation_owner"]
        if not isinstance(allocation_owner, dict):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        validate_allocation_receipt(
            expected=record,
            receipt=allocation,
            tenant_id=context.tenant_id,
            agent_id=allocation_owner["agent_id"],
            home_snapshot_ref=allocation_owner["home_snapshot_ref"],
        )
        predecessor = relation.predecessor
        successor = relation.successor
        if (
            (
                old_workspace.binding_id,
                old_workspace.workspace_id,
                old_workspace.backend_binding_ref,
                old_workspace.backend_workspace_ref,
                old_workspace.workspace_generation,
                old_config.config_digest,
            )
            != (
                predecessor.binding_id,
                predecessor.workspace_id,
                predecessor.binding_ref,
                predecessor.workspace_ref,
                predecessor.workspace_generation,
                predecessor.config_digest,
            )
            or (
                old_association.parent_node,
                old_association.workflow_native_run_id,
                old_association.agent_run_id,
                old_association.workspace,
                old_association.config_ref,
                old_association.config_digest,
            )
            != (
                parent,
                context.native_run_id,
                relation.agent_run_id,
                old_workspace,
                old_config.config_ref,
                old_config.config_digest,
            )
            or old_wait
            != AgentWaitAssociation(
                parent_node=parent,
                association_object_ref=predecessor.association_object_ref,
                agent_generation=record.agent_generation,
                checkpoint_object_ref=record.predecessor_checkpoint.checkpoint_id,
                checkpoint_digest=record.predecessor_checkpoint.payload_digest,
                backend_wait_event_id=relation.predecessor_waiting_event_id,
            )
            or canonical_digest(old_checkpoint.model_dump(mode="json")) != record.predecessor_checkpoint.payload_digest
            or (executable.parent_node.model_dump(mode="json"), executable.config_ref, executable.config_digest)
            != (parent.model_dump(mode="json"), successor.config_ref, successor.config_digest)
            or (
                association.parent_node,
                association.workflow_native_run_id,
                association.agent_run_id,
                association.config_ref,
                association.config_digest,
                association.pinned_snapshot_id,
                association.home_snapshot_id,
                association.workspace.binding_id,
                association.workspace.workspace_id,
                association.workspace.backend_binding_ref,
                association.workspace.backend_workspace_ref,
                association.workspace.workspace_generation,
            )
            != (
                parent,
                context.native_run_id,
                relation.agent_run_id,
                successor.config_ref,
                successor.config_digest,
                old_workspace.pinned_snapshot_id,
                record.home_snapshot_id,
                successor.binding_id,
                successor.workspace_id,
                successor.binding_ref,
                successor.workspace_ref,
                successor.workspace_generation,
            )
            or (
                checkpoint_receipt.value_digest,
                reconstruction_receipt.value_digest,
                reconstruction.home_snapshot_id,
                reconstruction.home_snapshot_digest,
                allocation.response.binding_ref,
                allocation.response.workspace_ref,
            )
            != (
                relation.successor_checkpoint.payload_digest,
                relation.reconstruction_digest,
                record.home_snapshot_id,
                record.home_snapshot_digest,
                successor.binding_ref,
                successor.workspace_ref,
            )
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        validate_recovery_checkpoint(relation, old_checkpoint, checkpoint)
        validate_recovery_configs(
            relation,
            self.recovery_config_request(
                config=old_config.config, parent=parent, create_idempotency_key=old_checkpoint.create_idempotency_key
            ),
            self.recovery_config_request(
                config=executable.config, parent=parent, create_idempotency_key=checkpoint.create_idempotency_key
            ),
            checkpoint,
        )
        config = AgentPreparedConfig(
            parent_node=parent,
            workflow_native_run_id=context.native_run_id,
            workspace=association.workspace,
            config_ref=executable.config_ref,
            config_digest=executable.config_digest,
            config=executable.config,
        )
        return SelectedRecovery(
            record,
            relation,
            config,
            association,
            checkpoint,
            old_config,
            old_association,
            old_wait,
            old_checkpoint,
            tuple(receipts),
        )

    @staticmethod
    def _recheck_selected_recovery(*, session, owned, parent, proof):
        """SQL-only exact record/receipt/input comparison after decoded graph reads."""
        from services.dify_builder.native_testing.agent_recovery import recovery_record

        if recovery_record(owned.bindings) != proof.record or proof.relation.parent_node.model_dump(
            mode="json"
        ) != parent.model_dump(mode="json"):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        from dify_agent.protocol.confirmed_recovery import AgentRecoveryReconstruction, recovery_successor_digest

        from services.dify_builder.native_testing.agent_recovery import RecoveryPreparedConfigPayload

        record, relation, config = proof.record, proof.relation, proof.config
        successor = relation.successor
        if (
            recovery_successor_digest(relation),
            config.parent_node,
            config.config_ref,
            config.config_digest,
            canonical_digest(config.config),
            config.workspace,
            proof.association.parent_node,
            proof.association.workflow_native_run_id,
            proof.association.agent_run_id,
            proof.association.config_ref,
            proof.association.config_digest,
            proof.checkpoint.config_ref,
            proof.checkpoint.config_digest,
            canonical_digest(proof.checkpoint.model_dump(mode="json")),
        ) != (
            record.successor_digest,
            parent,
            successor.config_ref,
            successor.config_digest,
            successor.config_digest,
            proof.association.workspace,
            parent,
            config.workflow_native_run_id,
            relation.agent_run_id,
            successor.config_ref,
            successor.config_digest,
            successor.config_ref,
            successor.config_digest,
            relation.successor_checkpoint.payload_digest,
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        prefix = "agent-recovery:" + record.attempt_id + ":"
        roles = {
            record.successor_object_ref: prefix + "relation",
            parent.input_result_ref: "node-input:" + parent.execution_id,
            record.evidence_object_ref: prefix + "evidence",
            record.allocation_receipt_ref: prefix + "allocation",
            relation.predecessor.config_ref: NativeExecutionStateStore._agent_key("agent-config", parent),
            relation.predecessor.association_object_ref: NativeExecutionStateStore._agent_key("agent-bind", parent),
            relation.predecessor_checkpoint.checkpoint_id: NativeExecutionStateStore._agent_key(
                "agent-cp", parent, record.agent_generation
            ),
            successor.config_ref: prefix + "config",
            successor.association_object_ref: prefix + "association",
            relation.successor_checkpoint.checkpoint_id: prefix + "checkpoint",
            relation.reconstruction_object_ref: prefix + "reconstruction",
        }
        values = {
            record.successor_object_ref: record.successor_digest,
            parent.input_result_ref: parent.input_digest,
            successor.config_ref: canonical_digest(
                RecoveryPreparedConfigPayload(
                    schema_version="agent-recovery-config-v1", parent_node=parent, config=config.config
                ).model_dump(mode="json")
            ),
            successor.association_object_ref: canonical_digest(proof.association.model_dump(mode="json")),
            relation.successor_checkpoint.checkpoint_id: relation.successor_checkpoint.payload_digest,
            relation.reconstruction_object_ref: canonical_digest(
                AgentRecoveryReconstruction(
                    kind="empty-bootstrap-v1",
                    home_snapshot_id=record.home_snapshot_id,
                    home_snapshot_digest=record.home_snapshot_digest,
                ).model_dump(mode="json")
            ),
            relation.predecessor.config_ref: canonical_digest(
                {
                    "schema": "agent-config-v2",
                    "parent_node": parent.model_dump(mode="json"),
                    "workflow_native_run_id": proof.predecessor_config.workflow_native_run_id,
                    "workspace": proof.predecessor_config.workspace.model_dump(mode="json"),
                    "resource_digest": record.definition_digest,
                    "config": proof.predecessor_config.config,
                }
            ),
            relation.predecessor.association_object_ref: canonical_digest(
                proof.predecessor_association.model_dump(mode="json")
            ),
            relation.predecessor_checkpoint.checkpoint_id: canonical_digest(
                {
                    "schema": "agent-checkpoint-v1",
                    "parent_node": parent.model_dump(mode="json"),
                    "association_object_ref": relation.predecessor.association_object_ref,
                    "agent_generation": record.agent_generation,
                    "backend_wait_event_id": relation.predecessor_waiting_event_id,
                    "checkpoint": proof.predecessor_checkpoint.model_dump(mode="json"),
                }
            ),
        }
        if len(roles) != 11 or len(proof.receipts) != 11 or {receipt.id for receipt in proof.receipts} != set(roles):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        for receipt in proof.receipts:
            if receipt.logical_key != roles[receipt.id] or (
                receipt.id in values and receipt.value_digest != values[receipt.id]
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            row = session.scalar(
                owner_query(NativePayloadObject, parent.ref, owned.tenant_id).where(
                    NativePayloadObject.id == receipt.id
                )
            )
            if row is None or ObjectReceipt.from_payload_object(row) != receipt:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")

    def load_selected_recovery(self, *, ref, parent_node):
        """Read one exact current relation; incomplete staging stays unselected.

        Existing access, scope, revision, pin, complete input and SQL resource
        checks run before returning. No SDK handoff or mutation is authorized.
        """
        prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=False)
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=False)
        return None if prepared.recovery is None else prepared.recovery.relation

    def _selected_recovery_staged_pending(self, *, prepared, graph):
        """Read exact selected staged disclosures before the root writer.

        The graph's validated checkpoints and relation supply both ends of each
        mapping; actual protected snapshots supply fresh intents and proposals.
        The caller must recheck the recorded receipts and ledger under root.
        """
        from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal
        from services.dify_builder.native_testing.agent_bridge import api_intent
        from services.dify_builder.native_testing.agent_operations import _resource_key
        from services.dify_builder.native_testing.agent_recovery import RecoveryStagedPending

        relation = graph.relation
        old_calls = {call.pending_operation_id: call for call in graph.predecessor_checkpoint.pending_calls}
        fresh_calls = {call.pending_operation_id: call for call in graph.checkpoint.pending_calls}
        substitutions = relation.pending_operation_substitutions
        if (
            len(old_calls) != len(substitutions)
            or len(fresh_calls) != len(substitutions)
            or set(old_calls) != {item.predecessor_operation_id for item in substitutions}
            or set(fresh_calls) != {item.successor_operation_id for item in substitutions}
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        pending = []
        for item in substitutions:
            intent = api_intent(fresh_calls[item.successor_operation_id].intent)
            selected = self._agent_object(prepared, logical_key=_resource_key(intent.key))
            if (
                selected is None
                or not isinstance(selected[1], dict)
                or selected[1].get("intent") != intent.model_dump(mode="json")
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            pending.append(
                RecoveryStagedPending(
                    predecessor_pending_id=item.predecessor_operation_id,
                    pending_id=item.successor_operation_id,
                    intent=intent,
                    proposal=NativeApprovalProposal.model_validate(selected[1]["proposal"]),
                )
            )
        return tuple(pending)

    def read_recovery_predecessor_result(self, *, ref, parent_node, selection, result_ref):
        """Read only the current selected graph for a verified predecessor caller.

        The caller must separately authenticate the predecessor runtime. This
        core port checks the complete selected owner and both pending ledgers;
        it confers no mutation or execution authority. Storage reads occur
        before the root lock and all selected receipts are rechecked under it.
        """
        from dify_agent.protocol.native_testing import AgentParentNodeRef as WireParent
        from dify_agent.protocol.native_testing import AgentPreparedConfigResponse

        from services.dify_builder.native_testing.agent_recovery import (
            recheck_staged_recovery_pending,
            require_never_dispatched_pending,
        )

        prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=False)
        proof = prepared.recovery
        if proof is None or proof.relation != selection or proof.record.sdk_receipt_ref is not None:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        relation = proof.relation
        pending = self._selected_recovery_staged_pending(prepared=prepared, graph=proof)
        prefix = "agent-recovery:" + proof.record.attempt_id + ":"
        roles = {
            proof.record.successor_object_ref: prefix + "relation",
            relation.reconstruction_object_ref: prefix + "reconstruction",
            relation.successor_checkpoint.checkpoint_id: prefix + "checkpoint",
        }
        if result_ref in roles:
            selected = self._agent_object(prepared, logical_key=roles[result_ref], object_ref=result_ref)
            if selected is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            value = selected[1]
        elif result_ref in (relation.predecessor.config_ref, relation.successor.config_ref):
            config = proof.predecessor_config if result_ref == relation.predecessor.config_ref else proof.config
            value = AgentPreparedConfigResponse(
                parent_node=WireParent.model_validate(parent_node.model_dump(mode="json")),
                config_ref=config.config_ref,
                config_digest=config.config_digest,
                config=self._agent_executable_config(config.config, parent_node),
            ).model_dump(mode="json")
        else:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=False)
            self._recheck_selected_recovery(session=session, owned=owned, parent=parent_node, proof=proof)
            recheck_staged_recovery_pending(session=session, owned=owned, expected=proof.record, pending=pending)
            require_never_dispatched_pending(
                session=session,
                tenant_id=owned.tenant_id,
                ref=ref,
                pending_ids=tuple(item.predecessor_pending_id for item in pending),
                generation=proof.record.parent_generation,
            )
        return value

    def acknowledge_recovery_sdk_receipt(self, *, ref, expected, receipt):
        """Persist the trusted SDK install observation without selecting a wait.

        The internal caller supplies the actual durable SDK receipt; this port
        validates its complete selected tuple and cannot itself authenticate an
        SDK transport. Identical replay returns the same protected receipt.
        All SQL authority remains closed until the separate wait ACK.
        """
        from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorReceipt

        from services.dify_builder.native_testing.agent_recovery import (
            recheck_staged_recovery_pending,
            recovery_record,
            require_never_dispatched_pending,
        )
        from services.dify_builder.native_testing.agent_recovery_state import (
            RECOVERY_RECORD_KEY,
            advance_recovery_record,
        )

        receipt = InstallConfirmedRecoverySuccessorReceipt.model_validate(receipt.model_dump(mode="json"))
        evidence = self.load_result(ref=ref, result_ref=expected.evidence_object_ref)
        if not isinstance(evidence, dict):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        parent = AgentParentNodeRef.model_validate(evidence["parent_node"])
        prepared = self._agent_prepare(ref=ref, parent_node=parent, writing=False)
        proof = prepared.recovery
        if proof is None or expected.phase != "ready" or expected.sdk_receipt_ref is not None:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        relation = proof.relation
        pending = self._selected_recovery_staged_pending(prepared=prepared, graph=proof)
        if (
            receipt.attempt_id,
            receipt.successor_digest,
            receipt.agent_run_id,
            receipt.parent_generation,
            receipt.agent_generation,
            receipt.workspace_generation,
            receipt.config_ref,
            receipt.config_digest,
            receipt.checkpoint,
        ) != (
            expected.attempt_id,
            expected.successor_digest,
            relation.agent_run_id,
            expected.parent_generation,
            expected.agent_generation,
            expected.next_workspace_generation,
            relation.successor.config_ref,
            relation.successor.config_digest,
            relation.successor_checkpoint,
        ) or receipt.waiting_event_id == relation.predecessor_waiting_event_id:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        logical_key = "agent-recovery:" + expected.attempt_id + ":sdk"
        value = receipt.model_dump(mode="json")
        existing = self._agent_object(prepared, logical_key=logical_key, required=False)
        if existing is not None and existing[1] != value:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        protected = (
            existing[0]
            if existing is not None
            else self.prepare_object(
                ref=ref, tenant_id=prepared.context.tenant_id, kind="result", logical_key=logical_key, payload=value
            )
        )
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=False)
            self._recheck_selected_recovery(session=session, owned=owned, parent=parent, proof=proof)
            current = recovery_record(owned.bindings)
            if current is None or current.model_copy(update={"sdk_receipt_ref": None}) != expected:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            recheck_staged_recovery_pending(session=session, owned=owned, expected=current, pending=pending)
            require_never_dispatched_pending(
                session=session,
                tenant_id=owned.tenant_id,
                ref=ref,
                pending_ids=tuple(item.predecessor_pending_id for item in pending),
                generation=expected.parent_generation,
            )
            acknowledged = ObjectReceipt.from_payload_object(self.acknowledge_object(session, protected))
            if current.sdk_receipt_ref is not None and current.sdk_receipt_ref != acknowledged.id:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            proposed = advance_recovery_record(current, current.model_copy(update={"sdk_receipt_ref": acknowledged.id}))
            invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id).with_for_update())
            if invocation is None:
                raise BuilderExecutionPolicyError("native_invocation_mismatch")
            invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: proposed.model_dump(mode="json")}
        if self._read_object(acknowledged) != value:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        return proposed

    def acknowledge_recovery_wait(self, *, ref, expected, receipt, checkpoint, event):
        """Atomically select the verified fresh wait and retire unattempted old operations.

        The caller supplies a real SDK checkpoint/event observation. The protected
        SDK receipt and staged disclosures are read before the root lock; all
        selected graph, pending and parent identities are rechecked under it.
        Success preserves the original continuation and old pending rows, and
        settles only proved never-dispatched predecessors as not_dispatched.
        Failure leaves the selected wait and predecessor operations unchanged.
        """
        from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorReceipt
        from dify_agent.protocol.native_continuation import SelectedNativeCheckpoint

        from models.dify_builder_native_tests import NativePendingAction
        from services.dify_builder.native_testing.agent_recovery import (
            RecoveryApprovalEntry,
            RecoveryPendingProof,
            RecoveryPendingSelection,
            recheck_staged_recovery_pending,
            recovery_record,
            require_never_dispatched_pending,
        )
        from services.dify_builder.native_testing.agent_recovery_state import (
            RECOVERY_RECORD_KEY,
            advance_recovery_record,
        )

        receipt = InstallConfirmedRecoverySuccessorReceipt.model_validate(receipt.model_dump(mode="json"))
        observed = SelectedNativeCheckpoint(checkpoint=checkpoint, waiting_event=event)
        evidence = self.load_result(ref=ref, result_ref=expected.evidence_object_ref)
        if not isinstance(evidence, dict) or expected.phase != "ready" or expected.sdk_receipt_ref is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        parent = AgentParentNodeRef.model_validate(evidence["parent_node"])
        original = CheckpointRef.model_validate(evidence["parent_checkpoint"])
        current = recovery_record(self.loader.load(ref=ref).bindings)
        if current is not None and current.successor_wait_ref is not None:
            if current.model_copy(update={"successor_wait_ref": None}) != expected:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            selected = self.load_recovery_pending_state(ref=ref, original_checkpoint=original)
            if (
                selected is None
                or selected.sdk_receipt != receipt
                or selected.graph.checkpoint != observed.checkpoint
                or selected.proof.selection.wait.backend_wait_event_id != observed.waiting_event.id
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            return selected.proof
        original_payload = self.read_checkpoint(ref=ref, checkpoint=original)
        prepared = self._agent_prepare(ref=ref, parent_node=parent, writing=False)
        graph = prepared.recovery
        if (
            graph is None
            or graph.record != expected
            or observed.checkpoint != graph.checkpoint
            or (observed.waiting_event.id, observed.waiting_event.run_id)
            != (receipt.waiting_event_id, receipt.agent_run_id)
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        if original_payload.generation != expected.parent_generation or [
            item for item in original_payload.agent_associations if item.parent_node == parent
        ] != [graph.predecessor_wait]:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        with self.loader.session_factory() as session:
            original_row = session.scalar(
                owner_query(NativePayloadObject, ref, prepared.context.tenant_id).where(
                    NativePayloadObject.id == original.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                )
            )
            if original_row is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            original_receipt = ObjectReceipt.from_payload_object(original_row)
        sdk = self._agent_object(
            prepared, logical_key="agent-recovery:" + expected.attempt_id + ":sdk", object_ref=expected.sdk_receipt_ref
        )
        if sdk is None or sdk[1] != receipt.model_dump(mode="json"):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        relation = graph.relation
        staged = self._selected_recovery_staged_pending(prepared=prepared, graph=graph)
        entries = tuple(RecoveryApprovalEntry.model_validate(entry.model_dump(mode="json")) for entry in staged)
        wait = AgentWaitAssociation(
            parent_node=parent,
            association_object_ref=relation.successor.association_object_ref,
            agent_generation=receipt.agent_generation,
            checkpoint_object_ref=receipt.checkpoint.checkpoint_id,
            checkpoint_digest=receipt.checkpoint.payload_digest,
            backend_wait_event_id=receipt.waiting_event_id,
        )
        selection = RecoveryPendingSelection(
            schema_version="agent-recovery-pending-v1",
            attempt_id=expected.attempt_id,
            original_checkpoint=original,
            parent_generation=expected.parent_generation,
            relation_ref=expected.successor_object_ref,
            relation_digest=expected.successor_digest,
            sdk_receipt_ref=expected.sdk_receipt_ref,
            wait=wait,
            approvals=entries,
        )
        value = selection.model_dump(mode="json")
        logical_key = "agent-recovery:" + expected.attempt_id + ":wait"
        existing = self._agent_object(prepared, logical_key=logical_key, required=False)
        if existing is not None and existing[1] != value:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        protected = (
            existing[0]
            if existing is not None
            else self.prepare_object(
                ref=ref, tenant_id=prepared.context.tenant_id, kind="result", logical_key=logical_key, payload=value
            )
        )
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=False)
            self._recheck_selected_recovery(session=session, owned=owned, parent=parent, proof=graph)
            if recovery_record(owned.bindings) != expected:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            recheck_staged_recovery_pending(session=session, owned=owned, expected=expected, pending=staged)
            old_ids = tuple(entry.predecessor_pending_id for entry in entries)
            require_never_dispatched_pending(
                session=session,
                tenant_id=owned.tenant_id,
                ref=ref,
                pending_ids=old_ids,
                generation=expected.parent_generation,
            )
            state = invocation_state(session, ref, owned.tenant_id)
            continuation = session.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.generation == expected.parent_generation
                )
            )
            if continuation is None or (
                state.checkpoint_id,
                continuation.checkpoint_id,
                continuation.payload_digest,
            ) != (original.checkpoint_id, original.checkpoint_id, original.payload_digest):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            original_row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == original.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                )
            )
            if (
                original_row is None
                or ObjectReceipt.from_payload_object(original_row) != original_receipt
                or continuation.payload_ref != original_receipt.storage_key
                or original_receipt.value_digest != canonical_digest(original_payload.model_dump(mode="json"))
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            acknowledged = ObjectReceipt.from_payload_object(self.acknowledge_object(session, protected))
            for old_id in old_ids:
                pending_row = session.scalar(
                    owner_query(NativePendingAction, ref, owned.tenant_id).where(NativePendingAction.id == old_id)
                )
                if pending_row is None:
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
                operation = session.scalar(
                    owner_query(NativeEffectOperation, ref, owned.tenant_id).where(
                        NativeEffectOperation.id == pending_row.operation_id
                    )
                )
                if operation is None or operation.state != "pending":
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
                operation.state = "not_dispatched"
            state.pending_ids = [entry.pending_id for entry in entries]
            proposed = advance_recovery_record(
                expected, expected.model_copy(update={"successor_wait_ref": acknowledged.id})
            )
            invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id).with_for_update())
            request = session.get(DifyBuilderExecutionRequest, ref.request_id)
            if invocation is None or request is None or len(request.observations) >= 4096:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: proposed.model_dump(mode="json")}
            request.observations = [
                *request.observations,
                {
                    "recovery_pending_replaced": True,
                    "attempt_id": expected.attempt_id,
                    "wait_digest": acknowledged.value_digest,
                },
            ]
        return RecoveryPendingProof(
            object_ref=acknowledged.id, value_digest=acknowledged.value_digest, selection=selection
        )

    def load_recovery_pending_chain(self, *, ref, original_checkpoint, for_projection=False):
        """Load the immutable selected SDK/wait/graph and retained ledger chain.

        No recovery returns None. Incomplete or inconsistent recovery fails
        closed. This preserves historical evidence as ordinary pending moves;
        the active replacement set has its separate complete predicate below.
        Current pins/access and canonical receipts are rechecked under the lock.
        """
        from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorReceipt

        from services.dify_builder.native_testing.agent_operations import _resource_key
        from services.dify_builder.native_testing.agent_recovery import (
            RecoveryPendingProof,
            RecoveryPendingSelection,
            RecoveryPendingState,
            recovery_record,
        )

        record = recovery_record(self.loader.load(ref=ref).bindings)
        if record is None:
            return None
        if record.phase != "ready" or record.sdk_receipt_ref is None or record.successor_wait_ref is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_unready")
        evidence = self.load_result(ref=ref, result_ref=record.evidence_object_ref)
        if not isinstance(evidence, dict):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        parent = AgentParentNodeRef.model_validate(evidence["parent_node"])
        original_payload = self.read_checkpoint(ref=ref, checkpoint=original_checkpoint, for_projection=for_projection)
        prepared = self._agent_prepare(ref=ref, parent_node=parent, writing=False, for_projection=for_projection)
        graph = prepared.recovery
        if graph is None or graph.record != record:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        if original_payload.generation != record.parent_generation or [
            item for item in original_payload.agent_associations if item.parent_node == parent
        ] != [graph.predecessor_wait]:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        with self.loader.session_factory() as session:
            original_row = session.scalar(
                owner_query(NativePayloadObject, ref, prepared.context.tenant_id).where(
                    NativePayloadObject.id == original_checkpoint.checkpoint_id,
                    NativePayloadObject.kind == "checkpoint",
                )
            )
            if original_row is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            original_receipt = ObjectReceipt.from_payload_object(original_row)
        prefix = "agent-recovery:" + record.attempt_id + ":"
        sdk = self._agent_object(prepared, logical_key=prefix + "sdk", object_ref=record.sdk_receipt_ref)
        wait = self._agent_object(prepared, logical_key=prefix + "wait", object_ref=record.successor_wait_ref)
        if sdk is None or wait is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        receipt = InstallConfirmedRecoverySuccessorReceipt.model_validate(sdk[1])
        selection = RecoveryPendingSelection.model_validate(wait[1])
        proof = RecoveryPendingProof(object_ref=wait[0].id, value_digest=wait[0].value_digest, selection=selection)
        snapshots = []
        for entry in selection.approvals:
            snapshot = self._agent_object(prepared, logical_key=_resource_key(entry.intent.key))
            if (
                snapshot is None
                or not isinstance(snapshot[1], dict)
                or (snapshot[1].get("intent"), snapshot[1].get("proposal"))
                != (entry.intent.model_dump(mode="json"), entry.proposal.model_dump(mode="json"))
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            snapshots.append(snapshot[0])
        state = RecoveryPendingState(
            proof,
            graph,
            receipt,
            sdk[0],
            wait[0],
            original_receipt,
            original_payload,
            tuple(snapshots),
            prepared.context,
            prepared.workspace,
            prepared.resource_digest,
        )
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=False)
            self.recheck_recovery_pending_chain(
                session=session, owned=owned, state=state, original_checkpoint=original_checkpoint
            )
        return state

    def load_recovery_pending_state(self, *, ref, original_checkpoint, for_projection=False):
        """Read the immutable chain and require the active replacement pending set."""
        state = self.load_recovery_pending_chain(
            ref=ref, original_checkpoint=original_checkpoint, for_projection=for_projection
        )
        if state is not None:
            with self.loader.locked(ref=ref) as (session, owned, _scope):
                self.recheck_recovery_pending_state(
                    session=session, owned=owned, state=state, original_checkpoint=original_checkpoint
                )
        return state

    def load_recovery_checkpoint_state(self, *, ref, checkpoint, for_projection=False):
        """Prove the recovery chain and this actual current protected checkpoint.

        The original replaced checkpoint retains the complete active-overlay
        checks. A later ordinary checkpoint uses its own payload/continuation,
        while immutable SDK/wait/graph receipts remain mandatory.
        """
        from services.dify_builder.native_testing.agent_recovery import recovery_record

        record = recovery_record(self.loader.load(ref=ref).bindings)
        if record is None:
            return None
        evidence = self.load_result(ref=ref, result_ref=record.evidence_object_ref)
        if not isinstance(evidence, dict):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        original = CheckpointRef.model_validate(evidence["parent_checkpoint"])
        state = self.load_recovery_pending_chain(ref=ref, original_checkpoint=original, for_projection=for_projection)
        if state is None:
            raise BuilderExecutionPolicyError("native_agent_recovery_unready")
        payload = self.read_checkpoint(ref=ref, checkpoint=checkpoint, for_projection=for_projection)
        if checkpoint != original and (
            payload.generation <= state.proof.selection.parent_generation
            or len(
                [
                    wait
                    for wait in payload.agent_associations
                    if wait.parent_node == state.proof.selection.wait.parent_node
                    and wait.association_object_ref == state.proof.selection.wait.association_object_ref
                    and wait.agent_generation > state.proof.selection.wait.agent_generation
                ]
            )
            != 1
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        with self.loader.locked(ref=ref) as (session, owned, _scope):
            self.recheck_recovery_checkpoint_state(session=session, owned=owned, state=state, checkpoint=checkpoint)
        return state

    @staticmethod
    def recheck_recovery_checkpoint_state(*, session, owned, state, checkpoint):
        """SQL-only exact current continuation plus immutable recovery receipt proof."""
        original = state.proof.selection.original_checkpoint
        if checkpoint == original:
            NativeExecutionStateStore.recheck_recovery_pending_state(
                session=session, owned=owned, state=state, original_checkpoint=original
            )
            return
        NativeExecutionStateStore.recheck_recovery_pending_chain(
            session=session, owned=owned, state=state, original_checkpoint=original
        )
        current = invocation_state(session, owned.ref, owned.tenant_id)
        continuation = session.scalar(
            owner_query(NativeContinuation, owned.ref, owned.tenant_id).where(
                NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                NativeContinuation.payload_digest == checkpoint.payload_digest,
                NativeContinuation.generation > state.proof.selection.parent_generation,
            )
        )
        row = session.scalar(
            owner_query(NativePayloadObject, owned.ref, owned.tenant_id).where(
                NativePayloadObject.id == checkpoint.checkpoint_id,
                NativePayloadObject.kind == "checkpoint",
                NativePayloadObject.payload_digest == checkpoint.payload_digest,
            )
        )
        if (
            continuation is None
            or row is None
            or current.checkpoint_id != checkpoint.checkpoint_id
            or continuation.payload_ref != row.storage_key
            or row.logical_key != str(continuation.generation)
            or not continuation.generation <= current.generation <= continuation.generation + 1
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")

    def load_recovery_pending_proof(self, *, ref, original_checkpoint, for_projection=False):
        """Return the selected overlay only after its full protected state checks."""
        state = self.load_recovery_pending_state(
            ref=ref, original_checkpoint=original_checkpoint, for_projection=for_projection
        )
        return None if state is None else state.proof

    @staticmethod
    def recheck_recovery_pending_chain(*, session, owned, state, original_checkpoint):
        """Recheck canonical per-call evidence and current SQL owners without I/O."""
        from models.dify_builder_native_tests import NativeEffectAttempt, NativeEffectDispatchClaim, NativePendingAction
        from services.dify_builder.native_testing.agent_bridge import api_intent
        from services.dify_builder.native_testing.agent_recovery import recovery_record
        from services.dify_builder.native_testing.authorization import _scope_digest, validate_binding
        from services.dify_builder.native_testing.repository import NativeBinding

        proof, graph, receipt = state.proof, state.graph, state.sdk_receipt
        selection, record, relation = proof.selection, graph.record, graph.relation
        NativeExecutionStateStore._recheck_selected_recovery(
            session=session, owned=owned, parent=selection.wait.parent_node, proof=graph
        )
        if (
            recovery_record(owned.bindings) != record
            or record.phase != "ready"
            or (proof.object_ref, proof.value_digest, canonical_digest(selection.model_dump(mode="json")))
            != (record.successor_wait_ref, state.wait_object.value_digest, state.wait_object.value_digest)
            or (
                selection.attempt_id,
                selection.original_checkpoint,
                selection.parent_generation,
                selection.relation_ref,
                selection.relation_digest,
                selection.sdk_receipt_ref,
            )
            != (
                record.attempt_id,
                original_checkpoint,
                record.parent_generation,
                record.successor_object_ref,
                record.successor_digest,
                record.sdk_receipt_ref,
            )
            or (state.sdk_object.id, state.sdk_object.value_digest)
            != (record.sdk_receipt_ref, canonical_digest(receipt.model_dump(mode="json")))
            or (
                receipt.attempt_id,
                receipt.successor_digest,
                receipt.agent_run_id,
                receipt.parent_generation,
                receipt.agent_generation,
                receipt.workspace_generation,
                receipt.config_ref,
                receipt.config_digest,
                receipt.checkpoint,
                receipt.waiting_event_id,
            )
            != (
                record.attempt_id,
                record.successor_digest,
                relation.agent_run_id,
                record.parent_generation,
                record.agent_generation,
                record.next_workspace_generation,
                relation.successor.config_ref,
                relation.successor.config_digest,
                relation.successor_checkpoint,
                selection.wait.backend_wait_event_id,
            )
            or (
                selection.wait.association_object_ref,
                selection.wait.agent_generation,
                selection.wait.checkpoint_object_ref,
                selection.wait.checkpoint_digest,
            )
            != (
                relation.successor.association_object_ref,
                receipt.agent_generation,
                receipt.checkpoint.checkpoint_id,
                receipt.checkpoint.payload_digest,
            )
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        prefix = "agent-recovery:" + record.attempt_id + ":"
        if (state.sdk_object.logical_key, state.wait_object.logical_key, state.wait_object.id) != (
            prefix + "sdk",
            prefix + "wait",
            proof.object_ref,
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        for saved in (state.sdk_object, state.wait_object, state.original_object, *state.snapshot_objects):
            row = session.scalar(
                owner_query(NativePayloadObject, owned.ref, owned.tenant_id).where(NativePayloadObject.id == saved.id)
            )
            if row is None or ObjectReceipt.from_payload_object(row) != saved:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        if (
            state.original_object.id != original_checkpoint.checkpoint_id
            or state.original_object.kind != "checkpoint"
            or state.original_object.payload_digest != original_checkpoint.payload_digest
            or state.original_object.value_digest != canonical_digest(state.original_payload.model_dump(mode="json"))
            or state.original_payload.generation != record.parent_generation
            or [
                item
                for item in state.original_payload.agent_associations
                if item.parent_node == selection.wait.parent_node
            ]
            != [graph.predecessor_wait]
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        original_continuation = session.scalar(
            owner_query(NativeContinuation, owned.ref, owned.tenant_id).where(
                NativeContinuation.generation == record.parent_generation,
                NativeContinuation.checkpoint_id == original_checkpoint.checkpoint_id,
                NativeContinuation.payload_digest == original_checkpoint.payload_digest,
            )
        )
        if original_continuation is None or original_continuation.payload_ref != state.original_object.storage_key:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        current_workspace, current_digest = NativeExecutionStateStore._agent_resources(
            session, owned, state.context, recovery=graph
        )
        if (current_workspace, current_digest) != (state.workspace, state.resource_digest):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")

        old_calls = {
            call.pending_operation_id: api_intent(call.intent) for call in graph.predecessor_checkpoint.pending_calls
        }
        fresh_calls = {call.pending_operation_id: api_intent(call.intent) for call in graph.checkpoint.pending_calls}
        if (
            set(old_calls) != {entry.predecessor_pending_id for entry in selection.approvals}
            or set(fresh_calls) != {entry.pending_id for entry in selection.approvals}
            or len(state.snapshot_objects) != len(selection.approvals)
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        for entry in selection.approvals:
            old = session.scalar(
                owner_query(NativePendingAction, owned.ref, owned.tenant_id).where(
                    NativePendingAction.id == entry.predecessor_pending_id
                )
            )
            fresh = session.scalar(
                owner_query(NativePendingAction, owned.ref, owned.tenant_id).where(
                    NativePendingAction.id == entry.pending_id
                )
            )
            old_op = (
                None
                if old is None
                else session.scalar(
                    owner_query(NativeEffectOperation, owned.ref, owned.tenant_id).where(
                        NativeEffectOperation.id == old.operation_id
                    )
                )
            )
            op = (
                None
                if fresh is None
                else session.scalar(
                    owner_query(NativeEffectOperation, owned.ref, owned.tenant_id).where(
                        NativeEffectOperation.id == fresh.operation_id
                    )
                )
            )
            raw = owned.bindings.get(operation_digest(entry.intent.key))
            if old is None or fresh is None or old_op is None or op is None or raw is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            binding = NativeBinding.model_validate(raw)
            validate_binding(entry.intent, binding)
            digest = _scope_digest(entry.intent, binding)
            old_intent = old_calls[entry.predecessor_pending_id]
            old_raw = owned.bindings.get(operation_digest(old_intent.key))
            if old_raw is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            old_binding = NativeBinding.model_validate(old_raw)
            validate_binding(old_intent, old_binding)
            old_digest = _scope_digest(old_intent, old_binding)
            if (
                entry.intent != fresh_calls[entry.pending_id]
                # Retain reads of legacy ACKed chains without rewriting their
                # history. Terminal projection still refuses legacy cancelled.
                or old_op.state not in {"not_dispatched", "cancelled"}
                or old_op.result_ref is not None
                or op.state not in {"pending", "claimed", "completed"}
                or old.reference != old_op.id
                or old.reference_digest != canonical_digest(old_op.id)
                or old.owner_ref != owned.app_id
                or old.owner_version != old_digest
                or old_op.scope_digest != old_digest
                or old_op.operation_digest != operation_digest(old_intent.key)
                or old_op.intent_digest != canonical_digest(old_intent.model_dump(mode="json"))
                or old.category != "approval"
                or fresh.category != "approval"
                or old.generation != record.parent_generation
                or fresh.generation != record.parent_generation
                or fresh.reference != op.id
                or fresh.reference_digest != canonical_digest(op.id)
                or fresh.owner_ref != owned.app_id
                or fresh.owner_version != digest
                or op.scope_digest != digest
                or op.operation_digest != operation_digest(entry.intent.key)
                or op.intent_digest != canonical_digest(entry.intent.model_dump(mode="json"))
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
                operation_ids = [old_op.id] + ([op.id] if op.state == "pending" else [])
                if (
                    session.scalar(
                        owner_query(model, owned.ref, owned.tenant_id)
                        .where(model.operation_id.in_(operation_ids))
                        .limit(1)
                    )
                    is not None
                ):
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")

    @staticmethod
    def recheck_recovery_pending_state(*, session, owned, state, original_checkpoint):
        """Recheck the complete active overlay; later checkpoints use their own owner."""
        NativeExecutionStateStore.recheck_recovery_pending_chain(
            session=session, owned=owned, state=state, original_checkpoint=original_checkpoint
        )
        graph, selection = state.graph, state.proof.selection
        record, relation = graph.record, graph.relation
        current = invocation_state(session, owned.ref, owned.tenant_id)
        continuation = session.scalar(
            owner_query(NativeContinuation, owned.ref, owned.tenant_id).where(
                NativeContinuation.generation == record.parent_generation
            )
        )
        if (
            continuation is None
            or current.checkpoint_id != original_checkpoint.checkpoint_id
            or (continuation.checkpoint_id, continuation.payload_digest)
            != (original_checkpoint.checkpoint_id, original_checkpoint.payload_digest)
            or continuation.payload_ref != state.original_object.storage_key
            or current.pending_ids != [entry.pending_id for entry in selection.approvals]
            or [(e.predecessor_pending_id, e.pending_id) for e in selection.approvals]
            != [
                (s.predecessor_operation_id, s.successor_operation_id) for s in relation.pending_operation_substitutions
            ]
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")

    def prepare_recovery_selection(self, *, ref, expected, pending):
        """Build a stable protected successor graph from acknowledged inert pending.

        Preconditions: current exact allocated attempt, old approved wait and
        server-produced fresh pending snapshots. Each dependency is read/ACKed
        before its ID enters the next object. SDK pure validators own the state
        whitelist. No allocation, grant, selected pointer or parent checkpoint
        change occurs; partial graphs remain inert and retries reuse role IDs.
        """
        from dify_agent.protocol.confirmed_recovery import (
            AgentRecoveryBinding,
            AgentRecoveryReconstruction,
            AgentRecoverySuccessor,
        )
        from dify_agent.protocol.native_continuation import AgentCheckpoint
        from dify_agent.runtime.confirmed_recovery import (
            recovery_snapshot,
            validate_recovery_checkpoint,
            validate_recovery_configs,
        )

        from services.dify_builder.native_testing.agent_operations import _resource_key
        from services.dify_builder.native_testing.agent_recovery import (
            PreparedRecoverySelection,
            RecoveryAllocationReceipt,
            RecoveryPreparedConfigPayload,
            RecoveryStagedPending,
            recheck_staged_recovery_pending,
            recovery_record,
        )

        pending = tuple(RecoveryStagedPending.model_validate(entry.model_dump(mode="json")) for entry in pending)
        if expected.phase != "allocated" or recovery_record(self.loader.load(ref=ref).bindings) != expected:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        prepared, evidence = self.prepare_recovery_attempt(ref=ref, expected=expected)
        old_association = self._agent_binding(prepared, expected.predecessor.association_object_ref)
        old_config = self._agent_prepared_config(prepared, expected.predecessor.config_ref)
        old_wait = AgentWaitAssociation.model_validate(evidence["wait"])
        old_checkpoint = AgentCheckpoint.model_validate(self._agent_wait_relation(prepared, old_association, old_wait))
        if tuple(entry.predecessor_pending_id for entry in pending) != tuple(
            call.pending_operation_id for call in old_checkpoint.pending_calls
        ) or len({entry.pending_id for entry in pending}) != len(pending):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        for entry in pending:
            snapshot = self._agent_object(prepared, logical_key=_resource_key(entry.intent.key))
            assert snapshot is not None
            if not isinstance(snapshot[1], dict) or (snapshot[1].get("intent"), snapshot[1].get("proposal")) != (
                entry.intent.model_dump(mode="json"),
                entry.proposal.model_dump(mode="json"),
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        allocation = self._agent_object(
            prepared,
            logical_key="agent-recovery:" + expected.attempt_id + ":allocation",
            object_ref=expected.allocation_receipt_ref,
        )
        assert allocation is not None
        allocated = RecoveryAllocationReceipt.model_validate(allocation[1])
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            if recovery_record(owned.bindings) != expected:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            self._agent_recheck(session, owned, scope, prepared, writing=False)
            self.recheck_recovery_wait(
                session=session, owned=owned, prepared=prepared, evidence=evidence, expected=expected
            )
            recheck_staged_recovery_pending(session=session, owned=owned, expected=expected, pending=pending)
        snapshot = recovery_snapshot(old_checkpoint)
        config = json.loads(json.dumps(old_config.config))
        for layer in config["composition"]["layers"]:
            if layer["name"] == "runtime":
                layer["config"]["backend_binding_ref"] = allocated.response.binding_ref
        config["session_snapshot"] = snapshot.model_dump(mode="json")
        payload = RecoveryPreparedConfigPayload(
            schema_version="agent-recovery-config-v1", parent_node=prepared.parent, config=config
        )
        config_receipt = self.stage_recovery_object(
            ref=ref, expected=expected, role="config", value=payload.model_dump(mode="json")
        )
        executable = self._recovery_prepared_config(receipt=config_receipt, value=payload.model_dump(mode="json"))
        workspace = AgentTestWorkspaceRef(
            binding_id=expected.reserved_binding_id,
            workspace_id=expected.reserved_workspace_id,
            backend_binding_ref=allocated.response.binding_ref,
            backend_workspace_ref=allocated.response.workspace_ref,
            pinned_snapshot_id=prepared.workspace.pinned_snapshot_id,
            home_snapshot_id=expected.home_snapshot_id,
            workspace_generation=expected.next_workspace_generation,
        )
        association = AgentNodeAssociation(
            parent_node=prepared.parent,
            workflow_native_run_id=old_association.workflow_native_run_id,
            agent_run_id=old_association.agent_run_id,
            config_ref=config_receipt.id,
            config_digest=executable.config_digest,
            pinned_snapshot_id=workspace.pinned_snapshot_id,
            home_snapshot_id=workspace.home_snapshot_id,
            workspace=workspace,
        )
        association_receipt = self.stage_recovery_object(
            ref=ref, expected=expected, role="association", value=association.model_dump(mode="json")
        )
        calls = [
            {
                **call.model_dump(mode="json"),
                "pending_operation_id": entry.pending_id,
                "intent": entry.intent.model_dump(mode="json"),
            }
            for call, entry in zip(old_checkpoint.pending_calls, pending, strict=True)
        ]
        checkpoint = AgentCheckpoint.model_validate(
            {
                **old_checkpoint.model_dump(mode="json"),
                "pending_calls": calls,
                "config_ref": config_receipt.id,
                "config_digest": executable.config_digest,
                "session_snapshot": snapshot.model_dump(mode="json"),
            }
        )
        checkpoint_receipt = self.stage_recovery_object(
            ref=ref, expected=expected, role="checkpoint", value=checkpoint.model_dump(mode="json")
        )
        reconstruction = AgentRecoveryReconstruction(
            kind="empty-bootstrap-v1",
            home_snapshot_id=expected.home_snapshot_id,
            home_snapshot_digest=expected.home_snapshot_digest,
        )
        reconstruction_receipt = self.stage_recovery_object(
            ref=ref, expected=expected, role="reconstruction", value=reconstruction.model_dump(mode="json")
        )
        successor = AgentRecoveryBinding(
            binding_id=workspace.binding_id,
            workspace_id=workspace.workspace_id,
            binding_ref=workspace.backend_binding_ref,
            workspace_ref=workspace.backend_workspace_ref,
            workspace_generation=workspace.workspace_generation,
            association_object_ref=association_receipt.id,
            config_ref=config_receipt.id,
            config_digest=executable.config_digest,
        )
        relation = AgentRecoverySuccessor.model_validate(
            {
                "attempt_id": expected.attempt_id,
                "parent_node": prepared.parent.model_dump(mode="json"),
                "agent_run_id": association.agent_run_id,
                "expected_parent_generation": expected.parent_generation,
                "expected_agent_generation": expected.agent_generation,
                "predecessor": expected.predecessor.model_dump(mode="json"),
                "successor": successor.model_dump(mode="json"),
                "predecessor_checkpoint": expected.predecessor_checkpoint.model_dump(mode="json"),
                "successor_checkpoint": {
                    "checkpoint_id": checkpoint_receipt.id,
                    "payload_digest": checkpoint_receipt.value_digest,
                },
                "predecessor_waiting_event_id": old_wait.backend_wait_event_id,
                "reconstruction_object_ref": reconstruction_receipt.id,
                "reconstruction_digest": reconstruction_receipt.value_digest,
                "pending_operation_substitutions": [
                    {
                        "predecessor_operation_id": entry.predecessor_pending_id,
                        "successor_operation_id": entry.pending_id,
                    }
                    for entry in pending
                ],
            }
        )
        validate_recovery_checkpoint(relation, old_checkpoint, checkpoint)
        validate_recovery_configs(
            relation,
            self.recovery_config_request(
                config=old_config.config,
                parent=prepared.parent,
                create_idempotency_key=old_checkpoint.create_idempotency_key,
            ),
            self.recovery_config_request(
                config=executable.config,
                parent=prepared.parent,
                create_idempotency_key=checkpoint.create_idempotency_key,
            ),
            checkpoint,
        )
        relation_receipt = self.stage_recovery_object(
            ref=ref, expected=expected, role="relation", value=relation.model_dump(mode="json")
        )
        return PreparedRecoverySelection(
            expected,
            relation,
            relation_receipt,
            config_receipt,
            association_receipt,
            checkpoint_receipt,
            reconstruction_receipt,
        )

    def stage_recovery_object(
        self,
        *,
        ref: NativeTestContextRef,
        expected: "AgentRecoveryRecord",
        role: Literal["config", "association", "checkpoint", "reconstruction", "relation"],
        value: JsonValue,
    ) -> ObjectReceipt:
        """Acknowledge one inert allocated-only role and return its stable stored ID.

        Preconditions: exact durable allocated record and retained original wait.
        Storage/readback/access refresh occur outside the root writer. Identical
        concurrent producers reuse the acknowledged receipt, including its ID;
        conflicts or selection changes refuse without adopting arbitrary bytes.
        """
        from services.dify_builder.native_testing.agent_recovery import recovery_record

        role = TypeAdapter(
            Literal["config", "association", "checkpoint", "reconstruction", "relation"]
        ).validate_python(role)
        owned = self.loader.load(ref=ref)
        if expected.phase != "allocated" or recovery_record(owned.bindings) != expected:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        prepared, evidence = self.prepare_recovery_attempt(ref=ref, expected=expected)
        value = _JSON.validate_python(value)
        logical_key = "agent-recovery:" + expected.attempt_id + ":" + role
        existing = self._agent_object(prepared, logical_key=logical_key, required=False)
        if existing is not None and existing[1] != value:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        receipt = (
            existing[0]
            if existing is not None
            else self.prepare_object(
                ref=ref, tenant_id=owned.tenant_id, kind="result", logical_key=logical_key, payload=value
            )
        )
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, current, scope):
            if recovery_record(current.bindings) != expected:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            self._agent_recheck(session, current, scope, prepared, writing=False)
            self.recheck_recovery_wait(
                session=session, owned=current, prepared=prepared, evidence=evidence, expected=expected
            )
            acknowledged = ObjectReceipt.from_payload_object(self.acknowledge_object(session, receipt))
        if self._read_object(acknowledged) != value:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        return acknowledged

    def _recovery_prepared_config(self, *, receipt: ObjectReceipt, value: JsonValue):
        """Decode protected recovery config and derive the unchanged wire response.

        This is data validation only. The finalizer/current owner must separately
        prove the full parent/run, exact receipt and executable owner chain.
        """
        from dify_agent.protocol.native_testing import AgentParentNodeRef as WireParent
        from dify_agent.protocol.native_testing import AgentPreparedConfigResponse

        from services.dify_builder.native_testing.agent_recovery import RecoveryPreparedConfigPayload

        payload = RecoveryPreparedConfigPayload.model_validate(value)
        config = self._agent_executable_config(payload.config, payload.parent_node)
        return AgentPreparedConfigResponse(
            parent_node=WireParent.model_validate(payload.parent_node.model_dump(mode="json")),
            config_ref=receipt.id,
            config_digest=canonical_digest(config),
            config=config,
        )

    def finalize_recovery_successor(self, *, ref, selection: "PreparedRecoverySelection") -> "AgentRecoveryRecord":
        """Validate acknowledged immutable graph, then SQL-only finalize under root lock.

        No interaction is wired to this primitive. All decrypt/SDK pure checks
        precede the writer. Failure rolls back SQL selection while allocation ACK
        remains durable. Full handshake is still separately required by 3C.
        """
        from dify_agent.protocol.confirmed_recovery import AgentRecoveryReconstruction
        from dify_agent.protocol.native_continuation import AgentCheckpoint
        from dify_agent.runtime.confirmed_recovery import validate_recovery_checkpoint, validate_recovery_configs

        from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
        from services.dify_builder.native_testing.agent_recovery import (
            RecoveryAllocationReceipt,
            finalize_recovery_selection,
            recovery_record,
        )

        owner = self.loader.load(ref=ref)
        selected_record = recovery_record(owner.bindings)
        if selected_record is not None and selected_record.phase == "ready":
            # Exact completed-attempt readback only: never reaches the generation-zero
            # resource admission path and never grants execution or adopts rows.
            with self.loader.locked(ref=ref) as (session, owned, _scope):
                invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id))
                if invocation is None:
                    raise BuilderExecutionPolicyError("native_invocation_mismatch")
                session_scope = WorkflowAgentSessionScope(
                    **invocation.bindings["_agent_confirmed_workspace_v1"]["scope"]
                )
                return finalize_recovery_selection(
                    session=session,
                    tenant_id=owned.tenant_id,
                    ref=ref,
                    selection=selection,
                    session_scope=session_scope,
                )
        prepared, evidence = self.prepare_recovery_attempt(ref=ref, expected=selection.expected)
        relation = selection.relation
        if relation.parent_node.model_dump(mode="json") != prepared.parent.model_dump(mode="json"):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        values = {}
        for role, receipt in (
            ("relation", selection.relation_receipt),
            ("config", selection.config_receipt),
            ("association", selection.association_receipt),
            ("checkpoint", selection.checkpoint_receipt),
            ("reconstruction", selection.reconstruction_receipt),
        ):
            selected = self._agent_object(
                prepared,
                logical_key="agent-recovery:" + selection.expected.attempt_id + ":" + role,
                object_ref=receipt.id,
            )
            if selected is None or selected[0] != receipt:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            values[role] = selected[1]
        allocation = self._agent_object(
            prepared,
            logical_key="agent-recovery:" + selection.expected.attempt_id + ":allocation",
            object_ref=selection.expected.allocation_receipt_ref,
        )
        assert allocation is not None
        allocated = RecoveryAllocationReceipt.model_validate(allocation[1])
        config = self._recovery_prepared_config(receipt=selection.config_receipt, value=values["config"])
        association = AgentNodeAssociation.model_validate(values["association"])
        checkpoint = AgentCheckpoint.model_validate(values["checkpoint"])
        reconstruction = AgentRecoveryReconstruction.model_validate(values["reconstruction"])
        if (
            values["relation"] != relation.model_dump(mode="json")
            or (
                allocated.attempt_id,
                allocated.response.binding_ref,
                allocated.response.workspace_ref,
                config.parent_node.model_dump(mode="json"),
                config.config_ref,
                config.config_digest,
                association.parent_node,
                association.workflow_native_run_id,
                association.agent_run_id,
                association.config_ref,
                association.config_digest,
                association.workspace.binding_id,
                association.workspace.workspace_id,
                association.workspace.backend_binding_ref,
                association.workspace.backend_workspace_ref,
                association.workspace.workspace_generation,
                association.workspace.pinned_snapshot_id,
                association.workspace.home_snapshot_id,
                reconstruction.home_snapshot_id,
                reconstruction.home_snapshot_digest,
            )
            != (
                selection.expected.attempt_id,
                relation.successor.binding_ref,
                relation.successor.workspace_ref,
                prepared.parent.model_dump(mode="json"),
                relation.successor.config_ref,
                relation.successor.config_digest,
                prepared.parent,
                prepared.context.native_run_id,
                relation.agent_run_id,
                relation.successor.config_ref,
                relation.successor.config_digest,
                relation.successor.binding_id,
                relation.successor.workspace_id,
                relation.successor.binding_ref,
                relation.successor.workspace_ref,
                relation.successor.workspace_generation,
                prepared.workspace.pinned_snapshot_id,
                selection.expected.home_snapshot_id,
                selection.expected.home_snapshot_id,
                selection.expected.home_snapshot_digest,
            )
            or canonical_digest(self._agent_executable_config(config.config, prepared.parent)) != config.config_digest
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_association = self._agent_binding(prepared, selection.expected.predecessor.association_object_ref)
        original_wait = AgentWaitAssociation.model_validate(evidence["wait"])
        if relation.predecessor_waiting_event_id != original_wait.backend_wait_event_id:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_checkpoint = AgentCheckpoint.model_validate(
            self._agent_wait_relation(prepared, old_association, original_wait)
        )
        old_config = self._agent_prepared_config(prepared, selection.expected.predecessor.config_ref)
        validate_recovery_checkpoint(relation, old_checkpoint, checkpoint)
        validate_recovery_configs(
            relation,
            self.recovery_config_request(
                config=old_config.config,
                parent=prepared.parent,
                create_idempotency_key=old_checkpoint.create_idempotency_key,
            ),
            self.recovery_config_request(
                config=config.config, parent=prepared.parent, create_idempotency_key=checkpoint.create_idempotency_key
            ),
            checkpoint,
        )
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=False)
            self.recheck_recovery_wait(
                session=session, owned=owned, prepared=prepared, evidence=evidence, expected=selection.expected
            )
            invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id))
            if invocation is None:
                raise BuilderExecutionPolicyError("native_invocation_mismatch")
            session_scope = WorkflowAgentSessionScope(**invocation.bindings["_agent_confirmed_workspace_v1"]["scope"])
            return finalize_recovery_selection(
                session=session, tenant_id=owned.tenant_id, ref=ref, selection=selection, session_scope=session_scope
            )

    def _confirmed_snapshot_preparation(self, *, identity: "ConfirmedSnapshotIdentity"):
        """Read exact immutable inputs/config/association outside the SQL writer."""
        from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding

        from services.dify_builder.native_testing.agent_recovery import ConfirmedSnapshotIdentity

        prepared = self._agent_prepare(
            ref=identity.parent_node.ref,
            parent_node=identity.parent_node,
            writing=False,
            expected_generation=identity.parent_generation,
        )
        association = self._agent_binding(prepared, identity.binding.association_object_ref)
        config = self._agent_prepared_config(prepared, identity.binding.config_ref)
        workspace = prepared.workspace
        actual = ConfirmedSnapshotIdentity(
            prepared.parent,
            prepared.context.generation,
            association.agent_run_id,
            TypeAdapter(Counter).validate_python(identity.agent_generation),
            AgentRecoveryBinding(
                binding_id=workspace.binding_id,
                workspace_id=workspace.workspace_id,
                binding_ref=workspace.backend_binding_ref,
                workspace_ref=workspace.backend_workspace_ref,
                workspace_generation=workspace.workspace_generation,
                association_object_ref=identity.binding.association_object_ref,
                config_ref=config.config_ref,
                config_digest=config.config_digest,
            ),
        )
        if actual != replace(identity, recovery=None):
            raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
        if actual.agent_generation > 0:
            graph = prepared.recovery
            if graph is not None and actual.agent_generation == graph.record.agent_generation + 1:
                evidence = self.load_result(ref=prepared.parent.ref, result_ref=graph.record.evidence_object_ref)
                if not isinstance(evidence, dict):
                    raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
                original = CheckpointRef.model_validate(evidence["parent_checkpoint"])
                recovery = identity.recovery or self.load_recovery_pending_state(
                    ref=prepared.parent.ref, original_checkpoint=original
                )
                if (
                    recovery is None
                    or recovery.graph != graph
                    or recovery.proof.selection.original_checkpoint != original
                    or actual.parent_generation != recovery.proof.selection.parent_generation + 1
                    or actual.agent_generation != recovery.proof.selection.wait.agent_generation + 1
                    or actual.binding.association_object_ref != recovery.proof.selection.wait.association_object_ref
                ):
                    raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
                actual = replace(actual, recovery=recovery)
            else:
                if identity.recovery is not None:
                    raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
                prior = self._agent_object(
                    prepared, logical_key=self._agent_key("agent-cp", prepared.parent, actual.agent_generation - 1)
                )
                assert prior is not None
                value = prior[1]
                if not isinstance(value, dict) or (
                    value.get("parent_node"),
                    value.get("association_object_ref"),
                    value.get("agent_generation"),
                ) != (
                    prepared.parent.model_dump(mode="json"),
                    actual.binding.association_object_ref,
                    actual.agent_generation - 1,
                ):
                    raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
        return prepared, actual

    @staticmethod
    def _confirmed_snapshot_execution(session, *, owned, prepared, identity, session_scope=None) -> None:
        """Recheck exact saved scope/execution and generation authority under root lock."""
        from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
        from models.dify_builder_native_tests import NativeDispatch
        from models.workflow import WorkflowNodeExecutionModel
        from services.dify_builder.native_testing.agent_confirmed_workspace import ALLOCATION

        recovery = identity.recovery
        if recovery is not None:
            # Capture proved current approval state. Save proves the immutable
            # selected chain without freezing a later ordinary pending/checkpoint.
            NativeExecutionStateStore.recheck_recovery_pending_chain(
                session=session,
                owned=owned,
                state=recovery,
                original_checkpoint=recovery.proof.selection.original_checkpoint,
            )
            selection = recovery.proof.selection
            if (
                selection.wait.association_object_ref != identity.binding.association_object_ref
                or selection.wait.parent_node != identity.parent_node
                or selection.parent_generation + 1 != identity.parent_generation
                or selection.wait.agent_generation + 1 != identity.agent_generation
            ):
                raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
        invocation = session.scalar(owner_query(NativeTestInvocation, prepared.parent.ref, prepared.context.tenant_id))
        allocation = None if invocation is None else invocation.bindings.get(ALLOCATION)
        if not isinstance(allocation, dict) or set(allocation) != {"scope", "workspace"}:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        scope = WorkflowAgentSessionScope(**allocation["scope"])
        if session_scope is not None and scope != session_scope:
            raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
        execution = session.scalar(
            select(WorkflowNodeExecutionModel)
            .where(
                WorkflowNodeExecutionModel.id == scope.node_execution_id,
                WorkflowNodeExecutionModel.tenant_id == scope.tenant_id,
                WorkflowNodeExecutionModel.app_id == scope.app_id,
                WorkflowNodeExecutionModel.workflow_id == scope.workflow_id,
                WorkflowNodeExecutionModel.workflow_run_id == scope.workflow_run_id,
                WorkflowNodeExecutionModel.node_id == scope.node_id,
                WorkflowNodeExecutionModel.agent_workspace_binding_id == identity.binding.binding_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        process = None if execution is None else execution.process_data_dict
        if (
            scope.node_execution_id != identity.parent_node.execution_id
            or not isinstance(process, dict)
            or (process.get("workflow_agent_binding_id"), process.get("workflow_tool_invocation_id"))
            != (scope.workflow_agent_binding_id, scope.workflow_tool_invocation_id)
        ):
            raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")
        if identity.agent_generation > 0:
            dispatch = session.scalar(
                owner_query(NativeDispatch, prepared.parent.ref, prepared.context.tenant_id).where(
                    NativeDispatch.generation == identity.parent_generation, NativeDispatch.state == "claimed"
                )
            )
            continuation = session.scalar(
                owner_query(NativeContinuation, prepared.parent.ref, prepared.context.tenant_id).where(
                    NativeContinuation.generation == identity.parent_generation - 1
                )
            )
            if dispatch is None or continuation is None:
                raise BuilderExecutionPolicyError("native_agent_snapshot_identity_mismatch")

    def capture_confirmed_snapshot_identity(
        self,
        *,
        parent_node: AgentParentNodeRef,
        parent_generation: int,
        agent_run_id: str,
        agent_generation: int,
        binding: "AgentRecoveryBinding",
    ) -> "ConfirmedSnapshotIdentity":
        """Capture the exact executable tuple before stream; no save-time relabeling.

        Requires original protected ownership and current generation, rechecked
        under the root writer. Commands additionally verifies actual SDK identity.
        Failure grants no snapshot authority and does not alter any state.
        """
        from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding

        from services.dify_builder.native_testing.agent_recovery import (
            ConfirmedSnapshotIdentity,
            require_recovery_mutation,
        )

        with _agent_boundary():
            identity = ConfirmedSnapshotIdentity(
                AgentParentNodeRef.model_validate(parent_node.model_dump(mode="json")),
                TypeAdapter(Counter).validate_python(parent_generation),
                TypeAdapter(ID).validate_python(agent_run_id),
                TypeAdapter(Counter).validate_python(agent_generation),
                AgentRecoveryBinding.model_validate(binding.model_dump(mode="json")),
            )
            prepared, actual = self._confirmed_snapshot_preparation(identity=identity)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=parent_node.ref) as (session, owned, scope):
                require_recovery_mutation(
                    bindings=owned.bindings,
                    binding_id=identity.binding.binding_id,
                    workspace_generation=identity.binding.workspace_generation,
                )
                self._agent_recheck(session, owned, scope, prepared, writing=True)
                if actual.recovery is not None:
                    self.recheck_recovery_pending_state(
                        session=session,
                        owned=owned,
                        state=actual.recovery,
                        original_checkpoint=actual.recovery.proof.selection.original_checkpoint,
                    )
                self._confirmed_snapshot_execution(session, owned=owned, prepared=prepared, identity=actual)
            return actual

    def save_confirmed_session_snapshot(
        self,
        *,
        identity: "ConfirmedSnapshotIdentity",
        session_scope: "WorkflowAgentSessionScope",
        snapshot: "SessionSnapshot | None",
    ) -> None:
        """Serialize/read/refresh before locking, then recheck and write in one root transaction.

        None performs no write or authority acquisition. Reservation and this
        write share the same SQL owner. Generic ordinary snapshot APIs are unused.
        """
        from services.dify_builder.native_testing.agent_recovery import write_confirmed_snapshot

        if snapshot is None:
            return
        serialized = snapshot.model_dump_json()
        with _agent_boundary():
            prepared, actual = self._confirmed_snapshot_preparation(identity=identity)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=identity.parent_node.ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=True)
                self._confirmed_snapshot_execution(
                    session, owned=owned, prepared=prepared, identity=actual, session_scope=session_scope
                )
                write_confirmed_snapshot(
                    session=session,
                    tenant_id=owned.tenant_id,
                    bindings=owned.bindings,
                    identity=identity,
                    current=actual,
                    serialized_snapshot=serialized,
                )

    def acknowledge_recovery_allocation(
        self,
        *,
        ref: NativeTestContextRef,
        expected: "AgentRecoveryRecord",
        receipt: "RecoveryAllocationReceipt",
    ) -> "AgentRecoveryRecord":
        """Protect exact confirmed allocation bytes even after revocation; grants no execution.

        Request tenant/Agent/Home are rederived from acknowledged reservation
        evidence, including after predecessor/Home lifecycle changes.
        Storage/crypto/readback precede the settlement root transaction.
        """
        from services.dify_builder.native_testing.agent_recovery import (
            RecoveryAllocationReceipt,
            settle_recovery_allocation,
            validate_allocation_receipt,
        )

        with _agent_boundary():
            receipt = RecoveryAllocationReceipt.model_validate(receipt.model_dump(mode="json"))
            with self.loader.session_factory() as session:
                owned, _ = self.loader._load(session, ref=ref, lock=False, settlement=True)
                evidence_row = session.scalar(
                    owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                        NativePayloadObject.id == expected.evidence_object_ref,
                        NativePayloadObject.kind == "result",
                        NativePayloadObject.logical_key == "agent-recovery:" + expected.attempt_id + ":evidence",
                    )
                )
                if evidence_row is None:
                    raise BuilderExecutionPolicyError("native_agent_recovery_allocation_mismatch")
                evidence_receipt = ObjectReceipt.from_payload_object(evidence_row)
            evidence = self._read_object(evidence_receipt)
            if not isinstance(evidence, dict) or not isinstance(evidence.get("allocation_owner"), dict):
                raise BuilderExecutionPolicyError("native_agent_recovery_allocation_mismatch")
            owner = evidence["allocation_owner"]
            if (owner.get("tenant_id"), owner.get("home_snapshot_id"), owner.get("home_snapshot_digest")) != (
                owned.tenant_id,
                expected.home_snapshot_id,
                expected.home_snapshot_digest,
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_allocation_mismatch")
            validate_allocation_receipt(
                expected=expected,
                receipt=receipt,
                tenant_id=owned.tenant_id,
                agent_id=TypeAdapter(ID).validate_python(owner["agent_id"]),
                home_snapshot_ref=TypeAdapter(ID | None).validate_python(owner["home_snapshot_ref"]),
            )
            protected = self.prepare_object(
                ref=ref,
                tenant_id=owned.tenant_id,
                kind="result",
                logical_key="agent-recovery:" + expected.attempt_id + ":allocation",
                payload=receipt.model_dump(mode="json"),
            )
            with self.loader.locked(ref=ref, settlement=True) as (session, current_owner, _scope):
                current_evidence = session.scalar(
                    owner_query(NativePayloadObject, ref, current_owner.tenant_id).where(
                        NativePayloadObject.id == expected.evidence_object_ref, NativePayloadObject.kind == "result"
                    )
                )
                if current_evidence is None or ObjectReceipt.from_payload_object(current_evidence) != evidence_receipt:
                    raise BuilderExecutionPolicyError("native_agent_recovery_allocation_mismatch")
                selected = self.acknowledge_object(session, protected)
                return settle_recovery_allocation(
                    session=session,
                    tenant_id=current_owner.tenant_id,
                    ref=ref,
                    expected=expected,
                    allocation_receipt_ref=selected.id,
                )

    def mark_recovery_allocation_unknown(
        self,
        *,
        ref: NativeTestContextRef,
        expected: "AgentRecoveryRecord",
    ) -> "AgentRecoveryRecord":
        """Fence unproven create outcomes permanently; retain an already committed ACK.

        This is settlement only, including after revocation. Never reserves or
        retries physical creation. A conflicting attempt refuses without changes.
        """
        from services.dify_builder.native_testing.agent_recovery import recovery_record
        from services.dify_builder.native_testing.agent_recovery_state import (
            RECOVERY_RECORD_KEY,
            AgentRecoveryRecord,
            advance_recovery_record,
        )

        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _scope):
            invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id).with_for_update())
            if invocation is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            current = recovery_record(invocation.bindings)
            if (
                current is not None
                and current.attempt_id == expected.attempt_id
                and current.allocation_receipt_ref is not None
            ):
                return current
            if current != expected or current is None or current.phase != "creating":
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            unknown = advance_recovery_record(
                current, AgentRecoveryRecord.model_validate({**current.model_dump(), "phase": "unknown"})
            )
            invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: unknown.model_dump(mode="json")}
            return unknown

    def prepare_object(
        self,
        *,
        ref: NativeTestContextRef,
        tenant_id: str,
        kind: PayloadKind,
        logical_key: str,
        payload: JsonValue,
        max_bytes: int | None = None,
    ) -> ObjectReceipt:
        """Internal producer port: caller must subsequently acknowledge under the root lock."""
        raw, digest = encode_payload(
            tenant_id=tenant_id,
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            kind=kind,
            payload=payload,
        )
        identity = str(uuid4())
        key = f"builder-native/{identity}"
        encrypted = encrypter.encrypt_token(tenant_id, raw).encode("ascii")
        if max_bytes is not None and len(encrypted) > max_bytes:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        storage.save(key, encrypted)
        readback = storage.load(key)
        if max_bytes is not None and len(readback) > max_bytes:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        roundtrip = encrypter.decrypt_token(tenant_id, readback.decode("ascii"))
        if max_bytes is not None and len(roundtrip.encode("utf-8")) > max_bytes:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        value = decode_payload(
            roundtrip,
            tenant_id=tenant_id,
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            kind=kind,
            digest=digest,
        )
        return ObjectReceipt(
            identity,
            tenant_id,
            ref.request_id,
            ref.invocation_id,
            kind,
            logical_key,
            key,
            digest,
            canonical_digest(value),
        )

    @staticmethod
    def acknowledge_object(session, receipt: ObjectReceipt) -> NativePayloadObject:
        existing = session.scalar(
            select(NativePayloadObject).where(
                NativePayloadObject.tenant_id == receipt.tenant_id,
                NativePayloadObject.request_id == receipt.request_id,
                NativePayloadObject.invocation_id == receipt.invocation_id,
                NativePayloadObject.kind == receipt.kind,
                NativePayloadObject.logical_key == receipt.logical_key,
            )
        )
        if existing is not None:
            if (existing.payload_digest, existing.value_digest) != (receipt.payload_digest, receipt.value_digest):
                raise BuilderExecutionPolicyError("native_payload_conflict")
            return existing
        row = NativePayloadObject(**vars(receipt))
        session.add(row)
        session.flush()
        return row

    @staticmethod
    def _read_object(row: NativePayloadObject | ObjectReceipt, *, max_bytes: int | None = None) -> JsonValue:
        started, error_type = perf_counter(), "none"
        try:
            receipt = row if isinstance(row, ObjectReceipt) else ObjectReceipt.from_payload_object(row)
            reads = _payload_reads.get()
            if reads is not None and not reads.active:
                reads = None
            key = receipt, max_bytes
            stored = reads.encrypted.get(key) if reads is not None else None
            if stored is None:
                stored = storage.load(row.storage_key)
            if max_bytes is not None and len(stored) > max_bytes:
                raise BuilderExecutionPolicyError("native_agent_config_unavailable")
            raw = encrypter.decrypt_token(row.tenant_id, stored.decode("ascii"))
            if max_bytes is not None and len(raw.encode("utf-8")) > max_bytes:
                raise BuilderExecutionPolicyError("native_agent_config_unavailable")
            value = decode_payload(
                raw,
                tenant_id=row.tenant_id,
                request_id=row.request_id,
                invocation_id=row.invocation_id,
                kind=row.kind,
                digest=row.payload_digest,
            )
            if canonical_digest(value) != row.value_digest:
                raise BuilderExecutionPolicyError("native_payload_invalid")
            if (
                reads is not None
                and reads.active
                and key not in reads.encrypted
                and len(reads.encrypted) < _PAYLOAD_READ_MAX_ENTRIES
                and len(stored) <= _PAYLOAD_READ_MAX_BYTES - reads.byte_count
            ):
                reads.encrypted[key] = stored
                reads.byte_count += len(stored)
            return value
        except BuilderExecutionPolicyError as error:
            error_type = type(error).__name__
            raise
        except Exception as error:
            error_type = type(error).__name__
            raise BuilderExecutionPolicyError("native_payload_unavailable") from None
        finally:
            # This leaf duration includes storage, key-provider I/O and decoding.
            # Never log the protected value, storage key or exception message.
            with suppress(Exception):  # Diagnostics cannot change protected reads.
                logger.info(
                    "Native read timing request_id=%s invocation_id=%s phase=protected_object_read "
                    "duration_seconds=%.6f error_type=%s",
                    row.request_id,
                    row.invocation_id,
                    perf_counter() - started,
                    error_type,
                )

    def initialize_context(self, *, context: ResolvedNativeTestContext) -> None:
        """Trusted admission only, after C02 request/scope creation; child creation has its own port."""
        context = ResolvedNativeTestContext.model_validate(context.model_dump(mode="json"))
        owned = self.loader.load(ref=context.ref)
        if (
            context.tenant_id,
            context.actor_id,
            context.app_id,
            context.workflow_id,
            context.parent_invocation_id,
            context.generation,
            context.call_depth,
            context.budget_ref,
            context.cancellation_ref,
        ) != (
            owned.tenant_id,
            owned.actor_id,
            owned.app_id,
            owned.workflow_id,
            None,
            owned.generation,
            0,
            owned.ref.request_id,
            owned.ref.request_id,
        ):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        with self.loader.session_factory() as session:
            workflow = session.get(Workflow, owned.workflow_id)
            test_input = session.get(DifyBuilderTestInput, owned.test_input_id)
            revision_context = owned.revision_context
            if (
                workflow is None
                or test_input is None
                or not admitted_graph_matches(workflow, context.graph, revision_context)
                or context.graph_revision
                != (
                    admitted_workflow_revision(workflow, revision_context)
                    if revision_context
                    else native_workflow_revision(workflow)
                )
                or canonical_digest(context.inputs) != canonical_digest(test_input.inputs)
                or context.input_revision != canonical_digest(context.inputs)
            ):
                raise BuilderExecutionPolicyError("native_snapshot_mismatch")
        receipt = self.prepare_object(
            ref=context.ref,
            tenant_id=owned.tenant_id,
            kind="context",
            logical_key="context",
            payload=context.model_dump(mode="json"),
        )
        with self.loader.locked(ref=context.ref) as (session, current, _):
            if current.generation != context.generation:
                raise BuilderExecutionPolicyError("native_generation_conflict")
            row = self.acknowledge_object(session, receipt)
            existing = session.scalar(owner_query(NativeInvocationState, context.ref, owned.tenant_id))
            if existing is None:
                session.add(
                    NativeInvocationState(
                        tenant_id=owned.tenant_id,
                        request_id=context.ref.request_id,
                        invocation_id=context.ref.invocation_id,
                        context_object_id=row.id,
                        app_id=context.app_id,
                        workflow_id=context.workflow_id,
                        parent_invocation_id=None,
                        parent_operation_digest=None,
                        child_identity_digest=None,
                        generation=context.generation,
                        state="running",
                        checkpoint_id=None,
                        pending_ids=[],
                        wait_reason=None,
                        outcome=None,
                        resolution=[],
                        cancellation_key=None,
                    )
                )
            elif existing.context_object_id != row.id:
                raise BuilderExecutionPolicyError("native_snapshot_mismatch")

    def load_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        return self._load_context(ref=ref, recovery=False)

    def load_projection_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        """Current owned read visibility survives expiry; this grants no execution."""
        return self._load_context(ref=ref, recovery=False, allow_expired=True)

    def load_recovery_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        """Read-only recovery material; an inactive invocation gains no authority."""
        return self._load_context(ref=ref, recovery=True)

    def _load_context(
        self, *, ref: NativeTestContextRef, recovery: bool, allow_expired: bool = False
    ) -> ResolvedNativeTestContext:
        owned = validate_private_read(self.loader, ref)
        if owned.cancelled:
            raise BuilderExecutionPolicyError("native_cancelled")
        if not recovery and (not owned.active or owned.request_state not in {"running", "waiting"}):
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        if not allow_expired and owned.expires_at <= utc_now():
            raise BuilderExecutionPolicyError("native_expired")
        with self.loader.session_factory() as session:
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == owned.context_object_id, NativePayloadObject.kind == "context"
                )
            )
        if row is None:
            raise BuilderExecutionPolicyError("native_state_unavailable")
        context = ResolvedNativeTestContext.model_validate(self._read_object(row))
        if (
            context.ref,
            context.tenant_id,
            context.actor_id,
            context.app_id,
            context.workflow_id,
            context.parent_invocation_id,
        ) != (ref, owned.tenant_id, owned.actor_id, owned.app_id, owned.workflow_id, owned.parent_invocation_id):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        if not owned.root_revision_matches or context.graph_revision != owned.graph_revision:
            raise BuilderExecutionPolicyError("native_revision_drift")
        if owned.input_revision is not None and owned.input_revision != context.input_revision:
            raise BuilderExecutionPolicyError("native_input_drift")
        return context.model_copy(update={"generation": owned.generation})

    def load_terminal_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        """Observe an already terminal owned Run after expiry, never a continuation."""
        from models.enums import CreatorUserRole
        from models.workflow import WorkflowRun

        context = self._load_context(ref=ref, recovery=False, allow_expired=True)
        with self.loader.session_factory() as session:
            run = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == context.native_run_id,
                    WorkflowRun.tenant_id == context.tenant_id,
                    WorkflowRun.app_id == context.app_id,
                    WorkflowRun.workflow_id == context.workflow_id,
                    WorkflowRun.created_by == context.actor_id,
                    WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                )
            )
            if run is None or run.status not in {"succeeded", "failed", "partial-succeeded", "stopped"}:
                raise BuilderExecutionPolicyError("native_expired")
        return context

    def commit_checkpoint(
        self, *, ref: NativeTestContextRef, generation: int, payload: NativeCheckpointPayload
    ) -> CheckpointRef:
        try:
            payload = NativeCheckpointPayload.model_validate(payload.model_dump(mode="json"))
            context = self.load_context(ref=ref)
            if type(generation) is not int or generation != context.generation or payload.generation != generation:
                raise BuilderExecutionPolicyError("native_generation_conflict")
            if context.native_run_id != payload.native_run_id:
                raise BuilderExecutionPolicyError("native_run_mismatch")
            agent_preparations = self._agent_checkpoint_preparations(ref, payload)
            # Validate every referenced private input/result and child owner before storing.
            for result_ref in (
                *payload.input_result_refs,
                *(r for j in payload.node_journals for r in (j.input_result_ref, *j.result_refs)),
            ):
                self.load_result(ref=ref, result_ref=result_ref)
            for journal in payload.node_journals:
                if journal.invocation_id != ref.invocation_id or any(
                    k.invocation_id != ref.invocation_id for k in journal.operation_keys
                ):
                    raise BuilderExecutionPolicyError("native_journal_owner_mismatch")
                if (
                    canonical_digest(self.load_result(ref=ref, result_ref=journal.input_result_ref))
                    != journal.input_digest
                ):
                    raise BuilderExecutionPolicyError("native_journal_input_mismatch")
            with self.loader.session_factory() as session:
                for child in payload.child_refs:
                    state = invocation_state(session, child, context.tenant_id)
                    if (
                        child.request_id != ref.request_id
                        or child.context_digest != ref.context_digest
                        or state.parent_invocation_id != ref.invocation_id
                    ):
                        raise BuilderExecutionPolicyError("native_child_owner_mismatch")
            receipt = self.prepare_object(
                ref=ref,
                tenant_id=context.tenant_id,
                kind="checkpoint",
                logical_key=str(generation),
                payload=payload.model_dump(
                    mode="json", exclude={"agent_associations"} if not payload.agent_associations else set()
                ),
            )
            with self.loader.locked(ref=ref) as (session, owned, scope):
                state = invocation_state(session, ref, owned.tenant_id)
                if state.generation != generation or state.state not in {"running", "waiting"}:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
                for prepared in agent_preparations:
                    self._agent_recheck(session, owned, scope, prepared, writing=False)
                obj = self.acknowledge_object(session, receipt)
                prior = session.scalar(
                    owner_query(NativeContinuation, ref, owned.tenant_id).where(
                        NativeContinuation.generation == generation
                    )
                )
                if prior is None:
                    prior = NativeContinuation(
                        tenant_id=owned.tenant_id,
                        request_id=ref.request_id,
                        invocation_id=ref.invocation_id,
                        generation=generation,
                        checkpoint_id=obj.id,
                        payload_digest=obj.payload_digest,
                        payload_ref=obj.storage_key,
                    )
                    session.add(prior)
                result = CheckpointRef(checkpoint_id=prior.checkpoint_id, payload_digest=prior.payload_digest)
            return result
        except BuilderExecutionPolicyError:
            raise
        except Exception:
            raise BuilderExecutionPolicyError("checkpoint_unavailable") from None

    def read_checkpoint_for_cancellation(
        self, *, ref: NativeTestContextRef, checkpoint: CheckpointRef
    ) -> NativeCheckpointPayload:
        """Active cancellation metadata only; expiry grants no new execution.

        Current actor, revision, invocation and private Agent resource checks
        remain mandatory. Revoked or inactive requests cannot enter this path.
        """
        self.loader.load(ref=ref)
        return self.read_checkpoint(ref=ref, checkpoint=checkpoint, for_projection=True)

    def read_checkpoint(
        self, *, ref: NativeTestContextRef, checkpoint: CheckpointRef, for_projection: bool = False
    ) -> NativeCheckpointPayload:
        """Read current protected facts; only server-selected projection ignores TTL.

        Projection retains active ownership, revision, input and Agent resource
        checks and cannot enter a writing Agent preparation or execution path.
        """
        owned = validate_private_read(self.loader, ref)
        with self.loader.session_factory() as session:
            continuation = session.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                    NativeContinuation.payload_digest == checkpoint.payload_digest,
                )
            )
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == checkpoint.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                )
            )
            if (
                continuation is None
                or row is None
                or row.payload_digest != checkpoint.payload_digest
                or row.storage_key != continuation.payload_ref
            ):
                raise BuilderExecutionPolicyError("checkpoint_unavailable")
        payload = NativeCheckpointPayload.model_validate(self._read_object(row))
        if payload.agent_associations:
            with _agent_boundary():
                if payload.generation != continuation.generation:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
                prepared = self._agent_checkpoint_preparations(ref, payload, for_projection=for_projection)
                outer = ObjectReceipt.from_payload_object(row)
                with self.loader.locked(ref=ref) as (session, current, scope):
                    selected_continuation = session.scalar(
                        owner_query(NativeContinuation, ref, current.tenant_id).where(
                            NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                            NativeContinuation.payload_digest == checkpoint.payload_digest,
                        )
                    )
                    selected_object = session.scalar(
                        owner_query(NativePayloadObject, ref, current.tenant_id).where(
                            NativePayloadObject.id == checkpoint.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                        )
                    )
                    if selected_continuation is None or selected_continuation.generation != payload.generation:
                        raise BuilderExecutionPolicyError("native_generation_conflict")
                    if (
                        selected_object is None
                        or selected_continuation.payload_ref != outer.storage_key
                        or ObjectReceipt.from_payload_object(selected_object) != outer
                    ):
                        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                    for selected in prepared:
                        self._agent_recheck(session, current, scope, selected, writing=False)
        return payload

    def store_result(self, *, ref: NativeTestContextRef, key: OperationKey, result: JsonValue) -> str:
        if key.invocation_id != ref.invocation_id:
            raise BuilderExecutionPolicyError("native_result_owner_mismatch")
        logical_key = operation_digest(key)
        # A cancelled/revoked invocation may still save the result of an already
        # spent operation, matching C02's settlement path. This creates no I/O.
        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False, settlement=True)
            spent = (
                session.scalar(
                    owner_query(NativeEffectOperation, ref, owned.tenant_id).where(
                        NativeEffectOperation.operation_digest == logical_key,
                        NativeEffectOperation.state.in_(("claimed", "completed")),
                    )
                )
                is not None
            )
        if not spent:
            self.loader.load(ref=ref)
            validate_private_read(self.loader, ref)
        receipt = self.prepare_object(
            ref=ref, tenant_id=owned.tenant_id, kind="result", logical_key=logical_key, payload=result
        )
        with self.loader.locked(ref=ref, settlement=spent) as (session, _, _):
            row = self.acknowledge_object(session, receipt)
            result_ref = row.id
        return result_ref

    def store_node_inputs(
        self, *, ref: NativeTestContextRef, generation: int, native_execution_id: str, inputs: JsonValue
    ) -> str:
        """Persist typed inputs independently of effect result slots, without issuing authority.

        The trusted producer must obtain the UUID from its attached, bound native
        node. UUID syntax alone establishes no native execution provenance.
        """
        try:
            ref = NativeTestContextRef.model_validate(ref.model_dump(warnings=False), strict=True)
            if type(native_execution_id) is not str or str(UUID(native_execution_id)) != native_execution_id:
                raise BuilderExecutionPolicyError("native_run_mismatch")
            logical_key = "node-input:" + native_execution_id
            if len(logical_key) > 128:
                raise BuilderExecutionPolicyError("native_payload_invalid")
            inputs = _JSON.validate_python(inputs)
            self.loader.load(ref=ref)
            authority = validate_private_read(self.loader, ref)
            context = self.load_context(ref=ref)
            if type(generation) is not int or generation != context.generation:
                raise BuilderExecutionPolicyError("native_generation_conflict")
            with self.loader.session_factory() as session:
                owned, scope = self.loader._load(session, ref=ref, lock=False)
                self._validate_node_inputs_owner(session, owned, scope, context, authority, generation)
            receipt = self.prepare_object(
                ref=ref, tenant_id=context.tenant_id, kind="result", logical_key=logical_key, payload=inputs
            )
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._validate_node_inputs_owner(session, owned, scope, context, authority, generation)
                result_ref = self.acknowledge_object(session, receipt).id
            return result_ref
        except BuilderExecutionPolicyError:
            raise
        except Exception:
            raise BuilderExecutionPolicyError("native_payload_unavailable") from None

    @staticmethod
    def _validate_node_inputs_owner(
        session,
        owned,
        scope,
        context: ResolvedNativeTestContext,
        authority: PrivateReadOwner,
        generation: int,
        *,
        allowed_states: tuple[str, ...] = ("running",),
        allow_expired: bool = False,
    ) -> None:
        """SQL-only preflight/recheck; caller owns the transaction and any root lock."""
        state = invocation_state(session, context.ref, owned.tenant_id)
        # The scope counter advances on resume; unrelated running branches keep
        # their own invocation generation and remain eligible to persist inputs.
        if (context.generation, state.generation, authority.generation) != (generation,) * 3:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        if not allow_expired and scope.expires_at <= utc_now():
            raise BuilderExecutionPolicyError("native_expired")
        if state.state not in allowed_states:
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        if (
            context.ref,
            context.tenant_id,
            context.actor_id,
            context.app_id,
            context.workflow_id,
            context.parent_invocation_id,
            authority.context_object_id,
        ) != (
            owned.ref,
            owned.tenant_id,
            owned.actor_id,
            state.app_id,
            state.workflow_id,
            state.parent_invocation_id,
            state.context_object_id,
        ):
            raise BuilderExecutionPolicyError("native_context_mismatch")
        require_ancestor_authority(session, context.ref, owned.tenant_id)
        request = session.get(DifyBuilderExecutionRequest, context.ref.request_id)
        if (
            context.execution_mode != "native"
            or not context.native_run_id
            or not context.root_native_run_id
            or request is None
            or request.context.get("mode") != "native"
            or request.context.get("native_run_id") != context.root_native_run_id
            or (context.parent_invocation_id is None and context.native_run_id != context.root_native_run_id)
        ):
            raise BuilderExecutionPolicyError("native_run_mismatch")
        workflow = validate_invocation_workflow(
            session, tenant_id=owned.tenant_id, app_id=context.app_id, workflow_id=context.workflow_id
        )
        revision_context = owned.revision_context
        revision = (
            admitted_workflow_revision(workflow, revision_context)
            if revision_context
            else native_workflow_revision(workflow)
        )
        if revision != context.graph_revision or not admitted_graph_matches(workflow, context.graph, revision_context):
            raise BuilderExecutionPolicyError("native_revision_drift")

    def load_result(self, *, ref: NativeTestContextRef, result_ref: str) -> JsonValue:
        owned = validate_private_read(self.loader, ref)
        with self.loader.session_factory() as session:
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == result_ref, NativePayloadObject.kind == "result"
                )
            )
        if row is None:
            raise BuilderExecutionPolicyError("native_result_owner_mismatch")
        return self._read_object(row)

    @staticmethod
    def _agent_key(namespace: str, parent: AgentParentNodeRef, generation: int | None = None) -> str:
        key = namespace + ":" + canonical_digest(parent.model_dump(mode="json"))
        if generation is not None:
            key += ":" + str(TypeAdapter(Counter).validate_python(generation))
        if len(key) > 128:
            raise BuilderExecutionPolicyError("native_agent_state_unavailable")
        return key

    @staticmethod
    def _agent_resources(
        session,
        owned,
        context: ResolvedNativeTestContext,
        *,
        definition_receipt: AgentDefinitionReceipt | None = None,
        recovery: "SelectedRecovery | None" = None,
    ) -> tuple[AgentTestWorkspaceRef, str]:
        """Current SQL allocation/pin/workspace chain only; no physical/backend IO."""
        invocation = session.scalar(owner_query(NativeTestInvocation, context.ref, owned.tenant_id))
        if (
            invocation is None
            or not invocation.active
            or (invocation.tenant_id, invocation.request_id, invocation.invocation_id)
            != (context.tenant_id, context.ref.request_id, context.ref.invocation_id)
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        confirmed = invocation.bindings.get("_agent_confirmed_workspace_v1")
        if confirmed is not None:
            from services.dify_builder.native_testing.agent_confirmed_workspace import current_confirmed_workspace

            return current_confirmed_workspace(
                session=session,
                owned=owned,
                context=context,
                allocation=confirmed,
                definition_receipt=definition_receipt,
                recovery=recovery,
            )
        allocation = invocation.bindings.get("_agent_workspace_v1")
        if not isinstance(allocation, dict):
            raise BuilderExecutionPolicyError("native_workspace_unavailable")
        # Local import avoids the existing workspace service -> state owner dependency.
        # This is its pure parser/ref conversion, not workspace/backend IO.
        from services.dify_builder.native_testing.agent_workspace import (
            AgentWorkspaceAllocation,
            _ref,
        )

        parsed_allocation = AgentWorkspaceAllocation.model_validate(allocation)
        if any(
            allocation.get(key) != value
            for key, value in {
                "tenant_id": context.tenant_id,
                "app_id": context.app_id,
                "request_id": context.ref.request_id,
                "invocation_id": context.ref.invocation_id,
                "owner_run_id": context.native_run_id,
                "phase": "ready",
            }.items()
        ):
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        scope = allocation.get("native_scope")
        if not isinstance(scope, dict):
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        binding_id = TypeAdapter(ID).validate_python(allocation.get("binding_id"))
        TypeAdapter(Counter).validate_python(scope.get("generation"))
        if scope.get("scope_id") != binding_id or scope.get("binding_ref") != binding_id:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        if parsed_allocation.native_scope.deadline <= utc_now():
            raise BuilderExecutionPolicyError("native_workspace_unavailable")
        workspace_ref = _ref(parsed_allocation)
        snapshot = session.get(AgentConfigSnapshot, workspace_ref.pinned_snapshot_id)
        home = session.get(AgentHomeSnapshot, workspace_ref.home_snapshot_id)
        workspace = session.get(AgentWorkspace, workspace_ref.workspace_id)
        binding = session.get(AgentWorkspaceBinding, workspace_ref.binding_id)
        if snapshot is None or home is None or workspace is None or binding is None:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        agent_id = TypeAdapter(ID).validate_python(allocation.get("agent_id"))
        from services.agent import access_service

        access_service.require_builder_agent_access(
            session=session,
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            app_id=context.app_id,
        )
        agent = session.get(Agent, agent_id)
        if agent is None or agent.tenant_id != context.tenant_id or agent.active_config_snapshot_id != snapshot.id:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")

        if (
            (snapshot.tenant_id, snapshot.agent_id, snapshot.home_snapshot_id) != (context.tenant_id, agent_id, home.id)
            or (home.tenant_id, home.agent_id, home.status, home.snapshot_ref)
            != (
                context.tenant_id,
                agent_id,
                AgentWorkingResourceStatus.ACTIVE,
                scope.get("base_snapshot_ref"),
            )
            or (
                workspace.tenant_id,
                workspace.app_id,
                workspace.owner_type,
                workspace.owner_id,
                workspace.owner_scope_key,
                workspace.status,
                workspace.backend_workspace_ref,
            )
            != (
                context.tenant_id,
                context.app_id,
                AgentWorkspaceOwnerType.WORKFLOW_RUN,
                context.native_run_id,
                "native:" + context.ref.invocation_id,
                AgentWorkingResourceStatus.ACTIVE,
                workspace_ref.backend_workspace_ref,
            )
            or (
                binding.tenant_id,
                binding.app_id,
                binding.workspace_id,
                binding.agent_id,
                binding.base_home_snapshot_id,
                binding.agent_config_version_id,
                binding.agent_config_version_kind,
                binding.backend_binding_ref,
                binding.status,
            )
            != (
                context.tenant_id,
                context.app_id,
                workspace.id,
                agent_id,
                home.id,
                snapshot.id,
                AgentConfigVersionKind.SNAPSHOT,
                workspace_ref.backend_binding_ref,
                AgentWorkingResourceStatus.ACTIVE,
            )
        ):
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        nodes = context.graph.get("nodes", [])
        if not isinstance(nodes, list) or not any(
            isinstance(node, dict)
            and isinstance(node.get("data"), dict)
            and isinstance(node["data"].get("agent_binding"), dict)
            and node["data"]["agent_binding"].get("current_snapshot_id") == snapshot.id
            and node["data"]["agent_binding"].get("agent_id") == agent_id
            for node in nodes
        ):
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        from core.agent.publish_visibility import (
            workflow_callable_active_snapshot_filter,
        )
        from services.agent.roster_service import AgentRosterService

        eligible = session.scalar(
            AgentRosterService._build_roster_agents_stmt(tenant_id=context.tenant_id, keyword=None).where(
                Agent.id == agent_id,
                Agent.active_config_has_model.is_(True),
                workflow_callable_active_snapshot_filter(),
            )
        )
        if eligible is None:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        workflow = validate_invocation_workflow(
            session,
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            workflow_id=context.workflow_id,
        )
        definitions = []
        matched_definition = False
        for node in nodes:
            if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
                continue
            selected = node["data"].get("agent_binding")
            if not isinstance(selected, dict) or (
                selected.get("agent_id"),
                selected.get("current_snapshot_id"),
            ) != (
                agent_id,
                snapshot.id,
            ):
                continue
            published_binding = session.scalar(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == context.tenant_id,
                    WorkflowAgentNodeBinding.app_id == context.app_id,
                    WorkflowAgentNodeBinding.workflow_id == context.workflow_id,
                    WorkflowAgentNodeBinding.workflow_version == workflow.version,
                    WorkflowAgentNodeBinding.node_id == node.get("id"),
                    WorkflowAgentNodeBinding.agent_id == agent_id,
                    WorkflowAgentNodeBinding.current_snapshot_id == snapshot.id,
                    WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT,
                )
            )
            if published_binding is None:
                raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
            definitions.append({"node": node, "node_job": published_binding.node_job_config_dict})
            if definition_receipt is not None and node.get("id") == definition_receipt.node_id:
                # Compare the producing definition, not a fresh stamp assigned to
                # already-composed bytes after the claim's initial async reads.
                stamp = canonical_digest(
                    {
                        "node": node,
                        "soul": AgentSoulConfig.model_validate(snapshot.config_snapshot_dict).model_dump(mode="json"),
                        "job": WorkflowNodeJobConfig.model_validate(published_binding.node_job_config_dict).model_dump(
                            mode="json"
                        ),
                    }
                )
                if stamp != definition_receipt.stamp:
                    raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                matched_definition = True
        if definition_receipt is not None and not matched_definition:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        if not definitions:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        return workspace_ref, canonical_digest(
            {
                "allocation": allocation,
                "workspace": workspace_ref.model_dump(mode="json"),
                "snapshot": snapshot.config_snapshot_dict,
                "definitions": definitions,
            }
        )

    def _agent_object(
        self,
        preparation: _AgentPreparation,
        *,
        logical_key: str,
        object_ref: str | None = None,
        required: bool = True,
    ) -> tuple[ObjectReceipt, JsonValue] | None:
        with self.loader.session_factory() as session:
            query = owner_query(
                NativePayloadObject,
                preparation.parent.ref,
                preparation.context.tenant_id,
            ).where(
                NativePayloadObject.kind == "result",
                NativePayloadObject.logical_key == logical_key,
            )
            if object_ref is not None:
                query = query.where(NativePayloadObject.id == TypeAdapter(ID).validate_python(object_ref))
            row = session.scalar(query)
            if row is None:
                if required:
                    raise BuilderExecutionPolicyError("native_agent_object_unavailable")
                return None
            receipt = ObjectReceipt.from_payload_object(row)
        if (
            receipt.tenant_id,
            receipt.request_id,
            receipt.invocation_id,
            receipt.kind,
            receipt.logical_key,
        ) != (
            preparation.context.tenant_id,
            preparation.parent.ref.request_id,
            preparation.parent.ref.invocation_id,
            "result",
            logical_key,
        ) or (object_ref is not None and receipt.id != object_ref):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        value = self._read_object(
            receipt,
            max_bytes=1024 * 1024 if logical_key.startswith("agent-config:") else None,
        )
        preparation.objects.append(receipt)
        return receipt, value

    def _agent_prepare(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        writing: bool,
        expected_generation: int | None = None,
        settlement: bool = False,
        for_projection: bool = False,
    ) -> _AgentPreparation:
        if for_projection and writing:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        parent = AgentParentNodeRef.model_validate(parent_node.model_dump(mode="json"))
        if ref != parent.ref:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        self.loader.load(ref=ref)
        authority = validate_private_read(self.loader, ref)
        context = (
            self.load_projection_context(ref=ref)
            if for_projection
            else self._load_context(ref=ref, recovery=False, allow_expired=True)
            if settlement
            else self.load_context(ref=ref)
        )
        if (
            expected_generation is not None
            and TypeAdapter(Counter).validate_python(expected_generation) != context.generation
        ):
            raise BuilderExecutionPolicyError("native_generation_conflict")
        with self.loader.session_factory() as session:
            selected_owner, _selected_scope = self.loader._load(session, ref=ref, lock=False)
        selected_recovery = self._selected_recovery_graph(owned=selected_owner, context=context, parent=parent)
        with self.loader.session_factory() as session:
            owned, scope = self.loader._load(session, ref=ref, lock=False)
            self._validate_node_inputs_owner(
                session,
                owned,
                scope,
                context,
                authority,
                context.generation,
                allowed_states=("running",) if writing else ("running", "waiting", "queued"),
                allow_expired=settlement or for_projection,
            )
            self._agent_single_parent(session, context, parent)
            workspace, stamp = self._agent_resources(session, owned, context, recovery=selected_recovery)
        prepared = _AgentPreparation(
            parent,
            context,
            authority,
            workspace,
            stamp,
            [],
            settlement=settlement,
            for_projection=for_projection,
            recovery=selected_recovery,
        )
        selected = self._agent_object(
            prepared, logical_key="node-input:" + parent.execution_id, object_ref=parent.input_result_ref
        )
        assert selected is not None
        if canonical_digest(selected[1]) != parent.input_digest:
            raise BuilderExecutionPolicyError("native_journal_input_mismatch")
        return prepared

    def _agent_recheck(
        self,
        session,
        owned,
        scope,
        prepared: _AgentPreparation,
        *,
        writing: bool,
        definition_receipt: AgentDefinitionReceipt | None = None,
    ) -> None:
        if (prepared.settlement or prepared.for_projection) and writing:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        if writing and "_agent_confirmed_recovery_v1" in owned.bindings:
            from services.dify_builder.native_testing.agent_recovery import require_recovery_mutation

            require_recovery_mutation(
                bindings=owned.bindings,
                binding_id=prepared.workspace.binding_id,
                workspace_generation=prepared.workspace.workspace_generation,
            )
        self._validate_node_inputs_owner(
            session,
            owned,
            scope,
            prepared.context,
            prepared.authority,
            prepared.context.generation,
            allowed_states=("running",) if writing else ("running", "waiting", "queued"),
            allow_expired=prepared.settlement or prepared.for_projection,
        )
        self._agent_single_parent(session, prepared.context, prepared.parent)
        workspace, stamp = self._agent_resources(
            session, owned, prepared.context, definition_receipt=definition_receipt, recovery=prepared.recovery
        )
        if workspace != prepared.workspace or stamp != prepared.resource_digest:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        for receipt in prepared.objects:
            row = session.scalar(
                owner_query(NativePayloadObject, prepared.parent.ref, owned.tenant_id).where(
                    NativePayloadObject.id == receipt.id,
                    NativePayloadObject.kind == "result",
                )
            )
            if row is None or ObjectReceipt.from_payload_object(row) != receipt:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")

    def _agent_ack(self, prepared: _AgentPreparation, *, logical_key: str, value: JsonValue) -> str:
        existing = self._agent_object(prepared, logical_key=logical_key, required=False)
        receipt = None
        if existing is not None:
            if canonical_digest(existing[1]) != canonical_digest(value):
                raise BuilderExecutionPolicyError("native_payload_conflict")
        else:
            receipt = self.prepare_object(
                ref=prepared.parent.ref,
                tenant_id=prepared.context.tenant_id,
                kind="result",
                logical_key=logical_key,
                payload=value,
            )
        self._agent_refresh_access(prepared)
        with self.loader.locked(ref=prepared.parent.ref) as (session, owned, scope):
            self._agent_recheck(session, owned, scope, prepared, writing=True)
            if receipt is not None:
                return self.acknowledge_object(session, receipt).id
            assert existing is not None
            return existing[0].id

    def _agent_refresh_access(self, prepared: _AgentPreparation) -> None:
        """Current RBAC outside SQL writer, followed by complete local recheck under lock."""
        from services.dify_builder.native_testing.agent_binding import (
            AgentBindingService,
        )

        if validate_private_read(self.loader, prepared.parent.ref) != prepared.authority:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        with self.loader.session_factory() as session:
            snapshot = session.get(AgentConfigSnapshot, prepared.workspace.pinned_snapshot_id)
            if snapshot is None or snapshot.tenant_id != prepared.context.tenant_id:
                raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
            agent_id = snapshot.agent_id
        AgentBindingService.authorize(
            actor=self.loader.actor,
            app_id=prepared.context.app_id,
            agent_ids=frozenset({agent_id}),
        )

    @staticmethod
    def _agent_executable_config(config: JsonValue, parent: AgentParentNodeRef) -> JsonValue:
        """No metadata, secrets, assigned config ref, or caller ownership fields persist."""
        from dify_agent.protocol.schemas import CreateRunRequest

        if not isinstance(config, dict) or set(config) != {
            "composition",
            "session_snapshot",
        }:
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        request = CreateRunRequest.model_validate(
            {
                **config,
                "execution_mode": "builder_test",
                "native_test_ref": parent.ref.model_dump(mode="json"),
                "native_test_protocol_version": 1,
                "native_parent_node": parent.model_dump(mode="json"),
            }
        )

        # Layer transport fields can contain only opaque references. Empty credential
        # maps are required by existing DTOs; populated maps are never durable config.
        def credential_free(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if (
                        key
                        in {
                            "credentials",
                            "api_key",
                            "access_token",
                            "refresh_token",
                            "inner_api_key",
                            "authorization",
                        }
                        and item
                    ):
                        raise BuilderExecutionPolicyError("native_agent_config_credentials")
                    credential_free(item)
            elif isinstance(value, list):
                for item in value:
                    credential_free(item)

        normalized = request.model_dump(mode="json", include={"composition", "session_snapshot"})
        credential_free(normalized)
        if len(json.dumps(normalized, ensure_ascii=False).encode()) > 1024 * 1024 - 4096:
            raise BuilderExecutionPolicyError("native_agent_config_unavailable")
        return _JSON.validate_python(normalized)

    def claim_agent_create(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        expected_invocation_generation: int,
        config: JsonValue,
        definition_receipt: AgentDefinitionReceipt,
    ) -> AgentCreateClaim:
        """First local SQL insertion only; lost ACK and identical rows own no POST branch."""
        with _agent_boundary():
            prepared = self._agent_prepare(
                ref=ref,
                parent_node=parent_node,
                writing=True,
                expected_generation=expected_invocation_generation,
            )
            config = self._agent_executable_config(config, prepared.parent)
            value = {
                "schema": "agent-config-v2",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "resource_digest": prepared.resource_digest,
                "config": config,
            }
            key = self._agent_key("agent-config", prepared.parent)
            # Object crypto/readback is deliberately outside the writer, even if another
            # caller wins while it is in progress. That caller's ACK cannot grant us POST.
            receipt = self.prepare_object(
                ref=ref,
                tenant_id=prepared.context.tenant_id,
                kind="result",
                logical_key=key,
                payload=value,
                max_bytes=1024 * 1024,
            )
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(
                    session,
                    owned,
                    scope,
                    prepared,
                    writing=True,
                    definition_receipt=definition_receipt,
                )
                existing = session.scalar(
                    owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                        NativePayloadObject.kind == "result",
                        NativePayloadObject.logical_key == key,
                    )
                )
                if existing is not None:
                    if (existing.payload_digest, existing.value_digest) != (
                        receipt.payload_digest,
                        receipt.value_digest,
                    ):
                        raise BuilderExecutionPolicyError("native_payload_conflict")
                    return AgentCreateExisting(existing.id, canonical_digest(config))
                selected = self.acknowledge_object(session, receipt)
                return AgentCreateInserted(selected.id, canonical_digest(config))

    def _agent_prepared_config(self, prepared: _AgentPreparation, config_ref: str | None) -> AgentPreparedConfig:
        if prepared.recovery is not None:
            config = prepared.recovery.config
            if config_ref is not None and config_ref != config.config_ref:
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            return config
        selected = self._agent_object(
            prepared,
            logical_key=self._agent_key("agent-config", prepared.parent),
            object_ref=config_ref,
        )
        assert selected is not None
        return self._agent_validate_prepared_config(prepared, *selected)

    def _agent_validate_prepared_config(
        self, prepared: _AgentPreparation, receipt: ObjectReceipt, value: JsonValue
    ) -> AgentPreparedConfig:
        """Validate the already selected immutable object; its receipt stays in the SQL recheck."""
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "schema",
                "parent_node",
                "workflow_native_run_id",
                "workspace",
                "resource_digest",
                "config",
            }
            or value
            != {
                "schema": "agent-config-v2",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "resource_digest": prepared.resource_digest,
                "config": value.get("config"),
            }
        ):
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        config = self._agent_executable_config(value["config"], prepared.parent)
        if prepared.context.native_run_id is None:
            raise BuilderExecutionPolicyError("native_run_mismatch")
        return AgentPreparedConfig(
            parent_node=prepared.parent,
            workflow_native_run_id=prepared.context.native_run_id,
            workspace=prepared.workspace,
            config_ref=receipt.id,
            config_digest=canonical_digest(config),
            config=config,
        )

    def load_agent_settlement_identity(self, *, ref, parent_node):
        """Read original identity for result/outcome ACK only; grants no execution.

        Static runtime Resources select this mode. Every current owner, config,
        association and resource check remains; only expiry of new-call authority
        does not discard evidence from an operation already dispatched.
        """
        with _agent_boundary():
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=False, settlement=True)
            config = self._agent_prepared_config(prepared, None)
            selected = self._selected_agent_association_object(prepared)
            assert selected is not None
            association = AgentNodeAssociation.model_validate(selected[1])
            self._agent_config_relation(prepared, association)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=False)
            return prepared.context, config, association

    def load_prepared_config(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        config_ref: str | None,
        for_projection: bool = False,
    ) -> AgentPreparedConfig:
        """Private current-config read with owner/resource recheck after decryption."""
        with _agent_boundary():
            prepared = self._agent_prepare(
                ref=ref, parent_node=parent_node, writing=False, for_projection=for_projection
            )
            result = self._agent_prepared_config(prepared, config_ref)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=False)
            return result

    def load_prepared_config_selection(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        config_ref: str | None,
        for_projection: bool = False,
    ) -> tuple[AgentPreparedConfig, "SelectedRecovery | None"]:
        """Read immutable config and its actual selected proof before a SQL writer.

        The existing config owner remains unchanged without recovery. With a
        record, return the same decoded proof used to select/recheck this config;
        all storage, access refresh and decryption finish before return. Callers
        must pass the proof to their root resource recheck. Neither the tuple
        nor a missing proof grants mutation or handoff authority.
        """
        from services.dify_builder.native_testing.agent_recovery import recovery_record

        owned = self.loader.load(ref=ref)
        if recovery_record(owned.bindings) is None:
            return self.load_prepared_config(
                ref=ref, parent_node=parent_node, config_ref=config_ref, for_projection=for_projection
            ), None
        with _agent_boundary():
            prepared = self._agent_prepare(
                ref=ref, parent_node=parent_node, writing=False, for_projection=for_projection
            )
            result = self._agent_prepared_config(prepared, config_ref)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, current, scope):
                self._agent_recheck(session, current, scope, prepared, writing=False)
            return result, prepared.recovery

    def discover_agent_run(
        self, *, ref: NativeTestContextRef, parent_node: AgentParentNodeRef
    ) -> AgentNodeAssociation | None:
        """Observed unbound namespace is unknown, never authority to create/retry."""
        with _agent_boundary():
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=False)
            # A binding discovery always proves its config, including an unbound reservation.
            self._agent_prepared_config(prepared, None)
            selected = self._selected_agent_association_object(prepared, required=False)
            association = None if selected is None else AgentNodeAssociation.model_validate(selected[1])
            if association is not None:
                self._agent_config_relation(prepared, association)
            self._agent_refresh_access(prepared)
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=False)
                if (
                    selected is None
                    and session.scalar(
                        owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                            NativePayloadObject.kind == "result",
                            NativePayloadObject.logical_key == self._agent_key("agent-bind", prepared.parent),
                        )
                    )
                    is not None
                ):
                    raise BuilderExecutionPolicyError("native_agent_discovery_unknown")
            return association

    def store_agent_config(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        expected_invocation_generation: int,
        config: JsonValue,
    ) -> str:
        """Internal immutable config bytes, not backend authorization or preparation proof."""
        with _agent_boundary():
            prepared = self._agent_prepare(
                ref=ref, parent_node=parent_node, writing=True, expected_generation=expected_invocation_generation
            )
            value = {
                "schema": "agent-config-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "config": _JSON.validate_python(config),
            }
            return self._agent_ack(prepared, logical_key=self._agent_key("agent-config", prepared.parent), value=value)

    def _selected_agent_association_object(self, prepared, *, required: bool = True):
        """Return the current association object; historical access is separate."""
        recovery = prepared.recovery
        return self._agent_object(
            prepared,
            logical_key=self._agent_key("agent-bind", prepared.parent)
            if recovery is None
            else "agent-recovery:" + recovery.record.attempt_id + ":association",
            object_ref=None if recovery is None else recovery.relation.successor.association_object_ref,
            required=required,
        )

    def _agent_binding(self, prepared: _AgentPreparation, association_object_ref: str) -> AgentNodeAssociation:
        if prepared.recovery is not None:
            if association_object_ref != prepared.recovery.relation.successor.association_object_ref:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            self._agent_config_relation(prepared, prepared.recovery.association)
            return prepared.recovery.association
        selected = self._agent_object(
            prepared, logical_key=self._agent_key("agent-bind", prepared.parent), object_ref=association_object_ref
        )
        assert selected is not None
        association = AgentNodeAssociation.model_validate(selected[1])
        self._agent_config_relation(prepared, association)
        return association

    def _agent_config_relation(self, prepared: _AgentPreparation, association: AgentNodeAssociation) -> None:
        if (
            association.parent_node,
            association.workflow_native_run_id,
            association.workspace,
        ) != (
            prepared.parent,
            prepared.context.native_run_id,
            prepared.workspace,
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        if prepared.recovery is not None:
            config = self._agent_prepared_config(prepared, association.config_ref)
            if association != prepared.recovery.association or config.config_digest != association.config_digest:
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            return
        selected = self._agent_object(
            prepared,
            logical_key=self._agent_key("agent-config", prepared.parent),
            object_ref=association.config_ref,
        )
        assert selected is not None
        value = selected[1]
        if isinstance(value, dict) and value.get("schema") == "agent-config-v2":
            selected_config = self._agent_validate_prepared_config(prepared, *selected)
            if selected_config.config_digest != association.config_digest:
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            return
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "schema",
                "parent_node",
                "workflow_native_run_id",
                "workspace",
                "config",
            }
            or value
            != {
                "schema": "agent-config-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "workflow_native_run_id": prepared.context.native_run_id,
                "workspace": prepared.workspace.model_dump(mode="json"),
                "config": value.get("config"),
            }
            or canonical_digest(value["config"]) != association.config_digest
        ):
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")

    def bind_agent_run(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        expected_invocation_generation: int,
        association: AgentNodeAssociation,
    ) -> str:
        """Internal protected binding; only the actual later backend producer may supply its Run."""
        with _agent_boundary():
            association = AgentNodeAssociation.model_validate(association.model_dump(mode="json"))
            prepared = self._agent_prepare(
                ref=ref, parent_node=parent_node, writing=True, expected_generation=expected_invocation_generation
            )
            self._agent_config_relation(prepared, association)
            return self._agent_ack(
                prepared,
                logical_key=self._agent_key("agent-bind", prepared.parent),
                value=association.model_dump(mode="json"),
            )

    @staticmethod
    def _agent_checkpoint_metadata(checkpoint: JsonValue, association: AgentNodeAssociation, generation: int) -> None:
        # The actual backend adapter still owns full AgentCheckpoint/event validation.
        if (
            not isinstance(checkpoint, dict)
            or (
                checkpoint.get("run_id"),
                checkpoint.get("ref"),
                checkpoint.get("config_ref"),
                checkpoint.get("config_digest"),
            )
            != (
                association.agent_run_id,
                association.parent_node.ref.model_dump(mode="json"),
                association.config_ref,
                association.config_digest,
            )
            or TypeAdapter(Counter).validate_python(checkpoint.get("generation")) != generation
        ):
            raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")

    def store_agent_wait(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        association_object_ref: str,
        agent_generation: int,
        checkpoint: JsonValue,
        backend_wait_event_id: str,
    ) -> AgentWaitAssociation:
        """Store selected bytes/event reference, NEVER certify an actual Redis ACK.

        The uninstalled later trusted backend producer must first read/validate
        the actual checkpoint and event. No caller proof flag can replace it.
        """
        with _agent_boundary():
            generation = TypeAdapter(Counter).validate_python(agent_generation)
            event_id = TypeAdapter(ID).validate_python(backend_wait_event_id)
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=True)
            association = self._agent_binding(prepared, association_object_ref)
            checkpoint = _JSON.validate_python(checkpoint)
            self._agent_checkpoint_metadata(checkpoint, association, generation)
            value = {
                "schema": "agent-checkpoint-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "association_object_ref": association_object_ref,
                "agent_generation": generation,
                "backend_wait_event_id": event_id,
                "checkpoint": checkpoint,
            }
            object_ref = self._agent_ack(
                prepared, logical_key=self._agent_key("agent-cp", prepared.parent, generation), value=value
            )
            return AgentWaitAssociation(
                parent_node=prepared.parent,
                association_object_ref=association_object_ref,
                agent_generation=generation,
                checkpoint_object_ref=object_ref,
                checkpoint_digest=canonical_digest(checkpoint),
                backend_wait_event_id=event_id,
            )

    def _agent_wait_relation(
        self, prepared: _AgentPreparation, association: AgentNodeAssociation, wait: AgentWaitAssociation
    ) -> JsonValue:
        if wait.parent_node != prepared.parent:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        selected = self._agent_object(
            prepared,
            logical_key=self._agent_key("agent-cp", prepared.parent, wait.agent_generation),
            object_ref=wait.checkpoint_object_ref,
        )
        assert selected is not None
        value = selected[1]
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "schema",
                "parent_node",
                "association_object_ref",
                "agent_generation",
                "backend_wait_event_id",
                "checkpoint",
            }
            or value
            != {
                "schema": "agent-checkpoint-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "association_object_ref": wait.association_object_ref,
                "agent_generation": wait.agent_generation,
                "backend_wait_event_id": wait.backend_wait_event_id,
                "checkpoint": value.get("checkpoint"),
            }
            or canonical_digest(value["checkpoint"]) != wait.checkpoint_digest
        ):
            raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")
        self._agent_checkpoint_metadata(value["checkpoint"], association, wait.agent_generation)
        return value["checkpoint"]

    def load_agent_association(
        self, *, ref: NativeTestContextRef, parent_node: AgentParentNodeRef, wait: AgentWaitAssociation | None = None
    ) -> AgentProtectedState:
        """Read owned material only; absence refuses and never implies resume/terminal proof."""
        return self._read_agent_association(ref=ref, parent_node=parent_node, wait=wait, for_projection=False)

    def read_agent_association_for_cancellation(
        self, *, ref: NativeTestContextRef, parent_node: AgentParentNodeRef, wait: AgentWaitAssociation | None = None
    ) -> AgentProtectedState:
        """Locate the original child for active cancellation, never resume it."""
        return self._read_agent_association(ref=ref, parent_node=parent_node, wait=wait, for_projection=True)

    def _read_agent_association(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        wait: AgentWaitAssociation | None,
        for_projection: bool,
    ) -> AgentProtectedState:
        with _agent_boundary():
            prepared = self._agent_prepare(
                ref=ref, parent_node=parent_node, writing=False, for_projection=for_projection
            )
            if wait is None:
                selected = self._selected_agent_association_object(prepared)
                assert selected is not None
                association_ref = selected[0].id
            else:
                wait = AgentWaitAssociation.model_validate(wait.model_dump(mode="json"))
                association_ref = wait.association_object_ref
            association = self._agent_binding(prepared, association_ref)
            recovery_state = None
            if (
                wait is not None
                and prepared.recovery is not None
                and wait.checkpoint_object_ref == prepared.recovery.relation.successor_checkpoint.checkpoint_id
            ):
                evidence = self.load_result(ref=ref, result_ref=prepared.recovery.record.evidence_object_ref)
                if not isinstance(evidence, dict):
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
                recovery_state = self.load_recovery_pending_chain(
                    ref=ref,
                    original_checkpoint=CheckpointRef.model_validate(evidence["parent_checkpoint"]),
                    for_projection=for_projection,
                )
                if (
                    recovery_state is None
                    or recovery_state.graph != prepared.recovery
                    or recovery_state.proof.selection.wait != wait
                ):
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
                checkpoint = recovery_state.graph.checkpoint.model_dump(mode="json")
            else:
                checkpoint = None if wait is None else self._agent_wait_relation(prepared, association, wait)
            final = self._agent_object(
                prepared, logical_key=self._agent_key("agent-final", prepared.parent), required=False
            )
            terminal_ref, terminal = None, None
            if final is not None:
                final_value = final[1]
                if (
                    not isinstance(final_value, dict)
                    or set(final_value)
                    != {
                        "schema",
                        "parent_node",
                        "association_object_ref",
                        "agent_generation",
                        "backend_terminal_event_id",
                        "terminal_result",
                    }
                    or final_value.get("schema") != "agent-final-v1"
                    or final_value.get("parent_node") != prepared.parent.model_dump(mode="json")
                    or final_value.get("association_object_ref") != association_ref
                ):
                    raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                TypeAdapter(Counter).validate_python(final_value["agent_generation"])
                TypeAdapter(ID).validate_python(final_value["backend_terminal_event_id"])
                terminal_ref, terminal = final[0].id, final_value["terminal_result"]
            with self.loader.locked(ref=ref) as (session, owned, scope):
                self._agent_recheck(session, owned, scope, prepared, writing=False)
                if recovery_state is not None:
                    self.recheck_recovery_pending_chain(
                        session=session,
                        owned=owned,
                        state=recovery_state,
                        original_checkpoint=recovery_state.proof.selection.original_checkpoint,
                    )
            return AgentProtectedState(
                association_object_ref=association_ref,
                association=association,
                wait=wait,
                checkpoint=checkpoint,
                terminal_result_ref=terminal_ref,
                terminal_result=terminal,
            )

    def store_agent_final(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        association_object_ref: str,
        agent_generation: int,
        terminal_result: JsonValue,
        backend_terminal_event_id: str,
    ) -> str:
        """Private terminal bytes reference, not verified terminal/physical cleanup proof.

        The later actual backend producer must verify terminal state first. This
        record never settles C02 or releases capacity and has no installed caller.
        """
        with _agent_boundary():
            generation = TypeAdapter(Counter).validate_python(agent_generation)
            event_id = TypeAdapter(ID).validate_python(backend_terminal_event_id)
            prepared = self._agent_prepare(ref=ref, parent_node=parent_node, writing=True)
            self._agent_binding(prepared, association_object_ref)
            value = {
                "schema": "agent-final-v1",
                "parent_node": prepared.parent.model_dump(mode="json"),
                "association_object_ref": association_object_ref,
                "agent_generation": generation,
                "backend_terminal_event_id": event_id,
                "terminal_result": _JSON.validate_python(terminal_result),
            }
            return self._agent_ack(prepared, logical_key=self._agent_key("agent-final", prepared.parent), value=value)

    def _agent_checkpoint_preparations(
        self, ref: NativeTestContextRef, payload: NativeCheckpointPayload, *, for_projection: bool = False
    ) -> list[_AgentPreparation]:
        """Resolve all selected private references outside the later SQL-only recheck.

        This cannot certify backend ACK or authorize generic restoration. The
        existing claimed-C03/current-run handoff remains the actual resume gate.
        """
        preparations = []
        for wait in payload.agent_associations:
            prepared = self._agent_prepare(
                ref=ref, parent_node=wait.parent_node, writing=False, for_projection=for_projection
            )
            if (
                payload.native_run_id != prepared.context.native_run_id
                or payload.generation > prepared.context.generation
            ):
                raise BuilderExecutionPolicyError("native_generation_conflict")
            if prepared.recovery is not None and wait == prepared.recovery.predecessor_wait:
                if payload.generation != prepared.recovery.record.parent_generation:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
            else:
                association = self._agent_binding(prepared, wait.association_object_ref)
                self._agent_wait_relation(prepared, association, wait)
            preparations.append(prepared)
        return preparations

    def _agent_single_parent(self, session, context: ResolvedNativeTestContext, parent: AgentParentNodeRef) -> None:
        """Temporary one-workspace limitation: never share it with a distinct occurrence."""
        expected = self._agent_key("agent-config", parent)
        keys = session.scalars(
            owner_query(NativePayloadObject, context.ref, context.tenant_id)
            .with_only_columns(NativePayloadObject.logical_key)
            .where(
                NativePayloadObject.kind == "result",
                NativePayloadObject.logical_key.like("agent-config:%"),
                NativePayloadObject.logical_key != expected,
            )
            .limit(1)
        )
        for key in keys:
            if type(key) is not str:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            if key.startswith("agent-config:") and key != expected:
                raise BuilderExecutionPolicyError("native_agent_single_workspace_limit")
