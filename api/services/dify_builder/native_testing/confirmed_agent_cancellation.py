"""Logical stop of the original confirmed Agent pause, independent of cleanup.

Only opaque SQL object receipts and snapshot hashes survive revocation. They
retain evidence selected by the ordinary owners, never execution authority.
Backend and storage reads happen before the bounded SQL settlement transaction.
"""

from contextlib import ExitStack
from dataclasses import asdict, dataclass
from operator import itemgetter

from dify_agent.protocol.native_continuation import AgentCheckpoint, AgentPendingCall
from dify_agent.protocol.schemas import RunStatusResponse
from sqlalchemy import delete, select

from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from extensions.ext_storage import storage
from libs.datetime_utils import utc_now
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectOperation,
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
)
from models.enums import CreatorUserRole
from models.model import App, AppMode
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentTestWorkspaceRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.contracts import CheckpointRef, operation_digest
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.agent_recovery import (
    RecoveryAllocationReceipt,
    RecoveryPendingSelection,
    SelectedRecovery,
    recovery_record,
    validate_allocation_receipt,
)
from services.dify_builder.native_testing.agent_recovery_state import AgentRecoveryRecord, advance_recovery_record
from services.dify_builder.native_testing.confirmed_agent_completion import (
    CANCELLED_CHILD_OBSERVATION,
    STOP_CONTROL,
    _native_run_id,
    _request,
    _terminal_proof,
    cancelled_parent_proof,
    settled_physical_facts,
    stop_control_facts,
    stop_observation_matches,
)
from services.dify_builder.native_testing.confirmed_agent_continuation import validate_parent_snapshot
from services.dify_builder.native_testing.private_reads import validate_private_read
from services.dify_builder.native_testing.state_store import (
    NativeExecutionStateStore,
    ObjectReceipt,
    invocation_state,
    owner_query,
)

PREPARATION = "confirmed_agent_cancel_v1"


@dataclass(frozen=True)
class RecoveryCancellationHistory:
    """Per-call historical receipts, never execute or resource authority."""

    record: AgentRecoveryRecord
    graph: SelectedRecovery | None
    parent: AgentParentNodeRef
    original_checkpoint: CheckpointRef
    checkpoint: CheckpointRef
    payload: NativeCheckpointPayload
    children: tuple[str, ...]
    calls: tuple[AgentPendingCall, ...]
    current_calls: tuple[AgentPendingCall, ...]
    overlay: RecoveryPendingSelection | None
    objects: tuple[ObjectReceipt, ...]


class ConfirmedAgentCancellation:
    def __init__(self, commands):
        self.commands = commands
        self.loader = commands.loader

    def _objects(self, sql, ref, tenant_id):
        return sorted(
            (
                asdict(ObjectReceipt.from_payload_object(row))
                for row in sql.scalars(owner_query(NativePayloadObject, ref, tenant_id))
            ),
            key=itemgetter("id"),
        )

    def _sources(self, sql, ref):
        return sorted(
            [
                (
                    row.id,
                    row.tenant_id,
                    row.invocation_id,
                    row.generation,
                    row.state,
                    row.checkpoint_id,
                    row.idempotency_digest,
                )
                for row in sql.scalars(select(NativeDispatch).where(NativeDispatch.request_id == ref.request_id))
            ],
            key=itemgetter(0),
        )

    @staticmethod
    def _unclaimed_resume(source, proof):
        checkpoint_generation = proof.get("checkpoint_generation", proof["generation"])
        return (
            type(checkpoint_generation) is int
            and checkpoint_generation + 1 == proof["generation"]
            and source.generation == proof["generation"]
            and source.checkpoint_id == proof["checkpoint"]["checkpoint_id"]
            and source.state in {"queued", "published", "cancelled"}
            and source.claim_expires_at is None
        )

    def _sources_match(self, sql, ref, proof):
        current = [list(source) for source in self._sources(sql, ref)]
        original = proof["sources"]
        if len(current) != len(original):
            return False
        for selected, saved in zip(current, original, strict=True):
            # Broker publication and durable revocation do not claim the
            # original paused continuation. All other receipt facts stay exact.
            if (
                selected[3] == saved[3] == proof["generation"]
                and saved[4] in {"queued", "published"}
                and selected[4] in {"queued", "published", "cancelled"}
            ):
                selected[4] = saved[4]
        return current == original

    def _rows(self, sql, owned, run_id, *, lock):
        query = select(WorkflowRun).where(
            WorkflowRun.id == run_id,
            WorkflowRun.tenant_id == owned.tenant_id,
            WorkflowRun.app_id == owned.app_id,
            WorkflowRun.workflow_id == owned.workflow_id,
            WorkflowRun.created_by == owned.actor_id,
            WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
        )
        pause_query = select(WorkflowPause).where(
            WorkflowPause.workflow_run_id == run_id,
            WorkflowPause.workflow_id == owned.workflow_id,
            WorkflowPause.resumed_at.is_(None),
        )
        if lock:
            query, pause_query = query.with_for_update(), pause_query.with_for_update()
        return sql.scalar(query), sql.scalar(pause_query)

    def _recovery_history(self, *, ref, checkpoint):
        """Read retained exact parent/child/graph receipts for control settlement.

        The original authenticated SQL owner is mandatory, including after expiry,
        revocation and ordinary resource GC. No active Workspace, SDK ACK or wait
        ACK is required. Present graph/overlay evidence must validate completely;
        this read grants no execution, allocation or cleanup acknowledgement.
        """
        from dify_agent.protocol.confirmed_recovery import InstallConfirmedRecoverySuccessorReceipt

        with self.loader.session_factory() as sql:
            owned, _ = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            record = recovery_record(owned.bindings)
            if record is None:
                return None
            state = invocation_state(sql, ref, owned.tenant_id)
            objects = tuple(
                ObjectReceipt.from_payload_object(row)
                for row in sql.scalars(owner_query(NativePayloadObject, ref, owned.tenant_id))
            )
        receipts = {receipt.id: receipt for receipt in objects}
        consumed: dict[str, ObjectReceipt] = {}

        def read(object_ref, kind, logical_key=None):
            receipt = receipts.get(object_ref)
            if (
                receipt is None
                or receipt.kind != kind
                or (logical_key is not None and receipt.logical_key != logical_key)
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            consumed[receipt.id] = receipt
            return self.commands.api.store._read_object(receipt)

        context = ResolvedNativeTestContext.model_validate(read(state.context_object_id, "context"))
        if (context.ref, context.tenant_id, context.actor_id, context.app_id, context.workflow_id) != (
            ref,
            owned.tenant_id,
            owned.actor_id,
            owned.app_id,
            owned.workflow_id,
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        prefix = "agent-recovery:" + record.attempt_id + ":"
        evidence = read(record.evidence_object_ref, "result", prefix + "evidence")
        if not isinstance(evidence, dict):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        parent = AgentParentNodeRef.model_validate(evidence["parent_node"])
        original = CheckpointRef.model_validate(evidence["parent_checkpoint"])
        original_payload = NativeCheckpointPayload.model_validate(read(original.checkpoint_id, "checkpoint"))
        payload = NativeCheckpointPayload.model_validate(read(checkpoint.checkpoint_id, "checkpoint"))
        wait = AgentWaitAssociation.model_validate(evidence["wait"])
        binding = AgentNodeAssociation.model_validate(
            read(
                record.predecessor.association_object_ref,
                "result",
                NativeExecutionStateStore._agent_key("agent-bind", parent),
            )
        )
        old_config = read(
            record.predecessor.config_ref, "result", NativeExecutionStateStore._agent_key("agent-config", parent)
        )
        if not isinstance(old_config, dict):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_workspace = AgentTestWorkspaceRef.model_validate(old_config["workspace"])
        old_value = read(
            record.predecessor_checkpoint.checkpoint_id,
            "result",
            NativeExecutionStateStore._agent_key("agent-cp", parent, record.agent_generation),
        )
        if not isinstance(old_value, dict):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        old_checkpoint = AgentCheckpoint.model_validate(old_value["checkpoint"])
        if record.allocation_receipt_ref is not None:
            allocation_owner = evidence.get("allocation_owner")
            if not isinstance(allocation_owner, dict) or (
                allocation_owner.get("tenant_id"),
                allocation_owner.get("home_snapshot_id"),
                allocation_owner.get("home_snapshot_digest"),
            ) != (owned.tenant_id, record.home_snapshot_id, record.home_snapshot_digest):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            validate_allocation_receipt(
                expected=record,
                receipt=RecoveryAllocationReceipt.model_validate(
                    read(record.allocation_receipt_ref, "result", prefix + "allocation")
                ),
                tenant_id=owned.tenant_id,
                agent_id=allocation_owner["agent_id"],
                home_snapshot_ref=allocation_owner["home_snapshot_ref"],
            )
        if (
            parent.ref != ref
            or (parent.execution_id, parent.input_digest) != (record.identity.parent_execution_id, record.input_digest)
            or canonical_digest(read(parent.input_result_ref, "result", "node-input:" + parent.execution_id))
            != parent.input_digest
            or receipts[original.checkpoint_id].payload_digest != original.payload_digest
            or receipts[checkpoint.checkpoint_id].payload_digest != checkpoint.payload_digest
            or original_payload.generation != record.parent_generation
            or original_payload.native_run_id != context.native_run_id
            or payload.native_run_id != context.native_run_id
            or evidence["native_run_id"] != context.native_run_id
            or (
                old_config.get("schema"),
                old_config.get("parent_node"),
                old_config.get("workflow_native_run_id"),
                old_config.get("resource_digest"),
            )
            != ("agent-config-v2", parent.model_dump(mode="json"), context.native_run_id, record.definition_digest)
            or canonical_digest(self.commands.api.store._agent_executable_config(old_config["config"], parent))
            != record.predecessor.config_digest
            or binding.workspace != old_workspace
            or (
                old_workspace.binding_id,
                old_workspace.workspace_id,
                old_workspace.backend_binding_ref,
                old_workspace.backend_workspace_ref,
                old_workspace.workspace_generation,
                old_workspace.home_snapshot_id,
            )
            != (
                record.predecessor.binding_id,
                record.predecessor.workspace_id,
                record.predecessor.binding_ref,
                record.predecessor.workspace_ref,
                record.predecessor.workspace_generation,
                record.home_snapshot_id,
            )
            or [item for item in original_payload.agent_associations if item.parent_node == parent] != [wait]
            or wait.association_object_ref != record.predecessor.association_object_ref
            or wait.checkpoint_object_ref != record.predecessor_checkpoint.checkpoint_id
            or wait.checkpoint_digest != record.predecessor_checkpoint.payload_digest
            or wait.agent_generation != record.agent_generation
            or (
                binding.parent_node,
                binding.workflow_native_run_id,
                binding.agent_run_id,
                binding.config_ref,
                binding.config_digest,
            )
            != (
                parent,
                context.native_run_id,
                evidence["agent_run_id"],
                record.predecessor.config_ref,
                record.predecessor.config_digest,
            )
            or old_value
            != {
                "schema": "agent-checkpoint-v1",
                "parent_node": parent.model_dump(mode="json"),
                "association_object_ref": wait.association_object_ref,
                "agent_generation": wait.agent_generation,
                "backend_wait_event_id": wait.backend_wait_event_id,
                "checkpoint": old_checkpoint.model_dump(mode="json"),
            }
            or canonical_digest(old_checkpoint.model_dump(mode="json")) != wait.checkpoint_digest
            or (
                old_checkpoint.run_id,
                old_checkpoint.ref.model_dump(mode="json"),
                old_checkpoint.generation,
                old_checkpoint.config_ref,
                old_checkpoint.config_digest,
            )
            != (
                binding.agent_run_id,
                ref.model_dump(mode="json"),
                record.agent_generation,
                binding.config_ref,
                binding.config_digest,
            )
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        graph = self.commands.api.store._selected_recovery_graph(owned=owned, context=context, parent=parent)
        if graph is not None:
            consumed.update((receipt.id, receipt) for receipt in graph.receipts)
        overlay = None
        if record.sdk_receipt_ref is not None:
            if graph is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            sdk = InstallConfirmedRecoverySuccessorReceipt.model_validate(
                read(record.sdk_receipt_ref, "result", prefix + "sdk")
            )
            relation = graph.relation
            if (
                sdk.attempt_id,
                sdk.successor_digest,
                sdk.agent_run_id,
                sdk.parent_generation,
                sdk.agent_generation,
                sdk.workspace_generation,
                sdk.config_ref,
                sdk.config_digest,
                sdk.checkpoint,
            ) != (
                record.attempt_id,
                record.successor_digest,
                binding.agent_run_id,
                record.parent_generation,
                record.agent_generation,
                record.next_workspace_generation,
                relation.successor.config_ref,
                relation.successor.config_digest,
                relation.successor_checkpoint,
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            if record.successor_wait_ref is not None:
                overlay = RecoveryPendingSelection.model_validate(
                    read(record.successor_wait_ref, "result", prefix + "wait")
                )
                if (
                    overlay.attempt_id,
                    overlay.original_checkpoint,
                    overlay.parent_generation,
                    overlay.relation_ref,
                    overlay.relation_digest,
                    overlay.sdk_receipt_ref,
                    overlay.wait,
                ) != (
                    record.attempt_id,
                    original,
                    record.parent_generation,
                    record.successor_object_ref,
                    record.successor_digest,
                    record.sdk_receipt_ref,
                    AgentWaitAssociation(
                        parent_node=parent,
                        association_object_ref=relation.successor.association_object_ref,
                        agent_generation=sdk.agent_generation,
                        checkpoint_object_ref=sdk.checkpoint.checkpoint_id,
                        checkpoint_digest=sdk.checkpoint.payload_digest,
                        backend_wait_event_id=sdk.waiting_event_id,
                    ),
                ):
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        selected_waits = [item for item in payload.agent_associations if item.parent_node == parent]
        allowed_refs = {record.predecessor.association_object_ref}
        if graph is not None:
            allowed_refs.add(graph.relation.successor.association_object_ref)
        if (
            len(payload.agent_associations) != 1
            or len(selected_waits) != 1
            or selected_waits[0].association_object_ref not in allowed_refs
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        current_calls = ()
        if payload.generation != record.parent_generation:
            from services.dify_builder.native_testing.agent_bridge import api_intent

            current_wait = selected_waits[0]
            if (
                graph is None
                or overlay is None
                or payload.generation <= record.parent_generation
                or current_wait.association_object_ref != graph.relation.successor.association_object_ref
                or current_wait.agent_generation
                != record.agent_generation + payload.generation - record.parent_generation
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            current_value = read(
                current_wait.checkpoint_object_ref,
                "result",
                NativeExecutionStateStore._agent_key("agent-cp", parent, current_wait.agent_generation),
            )
            if not isinstance(current_value, dict):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            current_checkpoint = AgentCheckpoint.model_validate(current_value["checkpoint"])
            if (
                current_value
                != {
                    "schema": "agent-checkpoint-v1",
                    "parent_node": parent.model_dump(mode="json"),
                    "association_object_ref": current_wait.association_object_ref,
                    "agent_generation": current_wait.agent_generation,
                    "backend_wait_event_id": current_wait.backend_wait_event_id,
                    "checkpoint": current_checkpoint.model_dump(mode="json"),
                }
                or canonical_digest(current_checkpoint.model_dump(mode="json")) != current_wait.checkpoint_digest
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            self.commands.api.store._agent_checkpoint_metadata(
                current_checkpoint.model_dump(mode="json"), graph.association, current_wait.agent_generation
            )
            current_calls = tuple(current_checkpoint.pending_calls)
            for call in current_calls:
                intent = api_intent(call.intent)
                intents = [
                    item for journal in payload.node_journals for item in journal.intents if item.key == intent.key
                ]
                proposals = [item for item in payload.approval_proposals if item.key == intent.key]
                if intents != [intent] or len(proposals) != 1:
                    raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        history = RecoveryCancellationHistory(
            record,
            graph,
            parent,
            original,
            checkpoint,
            payload,
            (binding.agent_run_id,),
            tuple(old_checkpoint.pending_calls),
            current_calls,
            overlay,
            tuple(sorted(consumed.values(), key=lambda receipt: receipt.id)),
        )
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, _):
            self._recheck_recovery(sql, owned, history)
        return history

    @staticmethod
    def _recovery_preparation_matches(proof, history):
        """Preserve a revoked preparation across only incurred allocation settlement.

        The original proof stays immutable. Only creating->allocated/unknown,
        allocated->blocked and creating->allocated->blocked may finish after
        revocation. All original receipts, attempt, parent and child stay exact.
        Allocation adds only its separately validated protected receipt; blocking
        adds no objects or evidence. No graph/SDK/wait progress is admitted.
        """
        if history is None or (
            list(history.children) != proof["children"]
            or history.payload.native_run_id != proof["native_run_id"]
            or history.payload.generation != proof.get("checkpoint_generation", proof["generation"])
            or canonical_digest(history.payload.graph_runtime_state_json) != proof["runtime_digest"]
        ):
            return False
        saved = AgentRecoveryRecord.model_validate(proof["recovery"])
        current = history.record
        objects = sorted((asdict(receipt) for receipt in history.objects), key=itemgetter("id"))
        if saved == current:
            return objects == proof["objects"]
        if saved.phase == "allocated" and current.phase == "blocked":
            blocked = AgentRecoveryRecord.model_validate({**saved.model_dump(), "phase": "blocked"})
            return advance_recovery_record(saved, blocked) == current and objects == proof["objects"]
        if saved.phase != "creating" or current.phase not in {"allocated", "unknown", "blocked"}:
            return False
        if any(
            value is not None
            for value in (
                current.successor_object_ref,
                current.successor_digest,
                current.sdk_receipt_ref,
                current.successor_wait_ref,
            )
        ):
            return False
        try:
            if current.phase == "blocked":
                # Pure intermediate from the actual validated allocation receipt;
                # it is not persisted and invents no SDK or allocation evidence.
                allocated = AgentRecoveryRecord.model_validate({**current.model_dump(), "phase": "allocated"})
                advance_recovery_record(saved, allocated)
                advance_recovery_record(allocated, current)
            else:
                advance_recovery_record(saved, current)
        except ValueError:
            return False
        if current.phase == "unknown":
            return objects == proof["objects"]
        allocation = [value for value in objects if value["id"] == current.allocation_receipt_ref]
        retained = [value for value in objects if value["id"] != current.allocation_receipt_ref]
        return (
            retained == proof["objects"]
            and len(allocation) == 1
            and allocation[0]["kind"] == "result"
            and allocation[0]["logical_key"] == "agent-recovery:" + current.attempt_id + ":allocation"
        )

    def _recheck_recovery(self, sql, owned, history):
        """Recheck immutable receipts and exact old/fresh ledger joins under root.

        Cancelled predecessor operations are admitted only by the actual selected
        overlay bijection, with no attempt/claim/result. Revocation may convert
        pending/cancelled rows to not_dispatched; it transfers no permission.
        """
        from models.dify_builder_native_tests import NativeEffectAttempt, NativeEffectDispatchClaim, NativePendingAction
        from services.dify_builder.native_testing.agent_bridge import api_intent
        from services.dify_builder.native_testing.authorization import _scope_digest, validate_binding
        from services.dify_builder.native_testing.repository import NativeBinding

        record = history.record
        if recovery_record(owned.bindings) != record:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        for receipt in history.objects:
            row = sql.scalar(
                owner_query(NativePayloadObject, owned.ref, owned.tenant_id).where(NativePayloadObject.id == receipt.id)
            )
            if row is None or ObjectReceipt.from_payload_object(row) != receipt:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        original = history.original_checkpoint
        continuation = sql.scalar(
            owner_query(NativeContinuation, owned.ref, owned.tenant_id).where(
                NativeContinuation.checkpoint_id == original.checkpoint_id,
                NativeContinuation.payload_digest == original.payload_digest,
                NativeContinuation.generation == record.parent_generation,
            )
        )
        original_object = next(item for item in history.objects if item.id == original.checkpoint_id)
        if continuation is None or continuation.payload_ref != original_object.storage_key:
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        current = history.checkpoint
        state = invocation_state(sql, owned.ref, owned.tenant_id)
        current_continuation = sql.scalar(
            owner_query(NativeContinuation, owned.ref, owned.tenant_id).where(
                NativeContinuation.checkpoint_id == current.checkpoint_id,
                NativeContinuation.payload_digest == current.payload_digest,
                NativeContinuation.generation == history.payload.generation,
            )
        )
        current_object = next(item for item in history.objects if item.id == current.checkpoint_id)
        if (
            state.checkpoint_id != current.checkpoint_id
            or current_continuation is None
            or current_continuation.payload_ref != current_object.storage_key
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        if history.graph is not None:
            self.commands.api.store._recheck_selected_recovery(
                session=sql, owned=owned, parent=history.parent, proof=history.graph
            )
        old_calls = {call.pending_operation_id: call for call in history.calls}
        fresh_calls = (
            {}
            if history.graph is None
            else {call.pending_operation_id: call for call in history.graph.checkpoint.pending_calls}
        )
        if history.overlay is not None and (
            set(old_calls) != {entry.predecessor_pending_id for entry in history.overlay.approvals}
            or set(fresh_calls) != {entry.pending_id for entry in history.overlay.approvals}
            or any(
                api_intent(fresh_calls[entry.pending_id].intent) != entry.intent for entry in history.overlay.approvals
            )
            or history.graph is None
            or {
                (item.predecessor_operation_id, item.successor_operation_id)
                for item in history.graph.relation.pending_operation_substitutions
            }
            != {(entry.predecessor_pending_id, entry.pending_id) for entry in history.overlay.approvals}
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        current_calls = {call.pending_operation_id: call for call in history.current_calls}
        for pending_id, call in {**old_calls, **fresh_calls, **current_calls}.items():
            intent = api_intent(call.intent)
            raw = owned.bindings.get(operation_digest(intent.key))
            pending = sql.scalar(
                owner_query(NativePendingAction, owned.ref, owned.tenant_id).where(NativePendingAction.id == pending_id)
            )
            operation = (
                None
                if pending is None
                else sql.scalar(
                    owner_query(NativeEffectOperation, owned.ref, owned.tenant_id).where(
                        NativeEffectOperation.id == pending.operation_id
                    )
                )
            )
            if raw is None or pending is None or operation is None:
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            binding = NativeBinding.model_validate(raw)
            validate_binding(intent, binding)
            digest = _scope_digest(intent, binding)
            if (
                pending.category,
                pending.generation,
                pending.reference,
                pending.reference_digest,
                pending.owner_ref,
                pending.owner_version,
                operation.operation_digest,
                operation.intent_digest,
                operation.scope_digest,
            ) != (
                "approval",
                history.payload.generation if pending_id in current_calls else record.parent_generation,
                operation.id,
                canonical_digest(operation.id),
                owned.app_id,
                digest,
                operation_digest(intent.key),
                canonical_digest(intent.model_dump(mode="json")),
                digest,
            ) or (operation.state == "cancelled" and (history.overlay is None or pending_id not in old_calls)):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            if pending_id in old_calls and operation.state not in (
                {"cancelled", "not_dispatched"}
                if history.overlay is not None
                else {"pending", "denied", "not_dispatched"}
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
            if operation.state in {"pending", "cancelled", "not_dispatched"} and (
                operation.result_ref is not None
                or any(
                    sql.scalar(
                        owner_query(model, owned.ref, owned.tenant_id)
                        .where(model.operation_id == operation.id)
                        .limit(1)
                    )
                    is not None
                    for model in (NativeEffectAttempt, NativeEffectDispatchClaim)
                )
            ):
                raise BuilderExecutionPolicyError("native_agent_recovery_conflict")

    def _prepare_recovery(self, *, ref, checkpoint):
        """Freeze recovery evidence only after SQL revocation fences handshake ACKs.

        An active recovery returns without saving a preparation: installation or
        its SQL ACK can still win before cancellation takes the root lock. Once
        revoked, SDK/wait progress is fenced. Incurred allocation settlement may
        still finish and is compared by its exact existing transition owner.
        """
        with self.loader.session_factory() as sql:
            owned, scope = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            if recovery_record(owned.bindings) is None:
                return False
            if not scope.cancelled:
                return True
        history = self._recovery_history(ref=ref, checkpoint=checkpoint)
        if history is None:
            return False
        with self.loader.session_factory() as sql:
            owned, _ = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            state = invocation_state(sql, ref, owned.tenant_id)
            run, pause = self._rows(sql, owned, history.payload.native_run_id, lock=False)
            if (
                run is None
                or pause is None
                or run.status != "paused"
                or state.state not in {"waiting", "queued", "cancelled"}
            ):
                return True
            pause_id, pause_key = pause.id, pause.state_object_key
            generation, context_id = state.generation, state.context_object_id
            sources = self._sources(sql, ref)
        paused = WorkflowResumptionContext.loads(storage.load(pause_key).decode())
        runtime = validate_parent_snapshot(state=paused, ref=ref, native_run_id=history.payload.native_run_id)
        if (
            history.payload.graph_runtime_state_json != paused.serialized_graph_runtime_state
            or history.parent.execution_id
            not in {item.execution_id for item in runtime.graph_execution.node_executions.values()}
        ):
            raise BuilderExecutionPolicyError("native_agent_recovery_conflict")
        proof = {
            "generation": generation,
            "checkpoint_generation": history.payload.generation,
            "checkpoint": checkpoint.model_dump(mode="json"),
            "pause_id": pause_id,
            "state_object_key": pause_key,
            "runtime_digest": canonical_digest(paused.serialized_graph_runtime_state),
            "native_run_id": history.payload.native_run_id,
            "children": list(history.children),
            "objects": sorted((asdict(item) for item in history.objects), key=itemgetter("id")),
            "sources": [list(source) for source in sources],
            "context_object_id": context_id,
            "recovery": history.record.model_dump(mode="json"),
        }
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, _):
            self._recheck_recovery(sql, owned, history)
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is not None and self._matches(sql, ref, owned, proof, history=history):
                if not any(PREPARATION in record for record in request.observations):
                    request.observations = [*request.observations, {PREPARATION: proof}]
        return True

    def deny_recovery(self, *, ref, pending_operation_id, scope_digest, expected_version, idempotency_key):
        """Atomically audit authenticated terminal denial and revoke recovery.

        Exact retained pending ownership/version/scope is required; unlike a
        confirmation this control decision needs no live execute authority or
        completed SDK/wait handshake. It creates no grant. Ordinary requests
        return False for their existing decision owner. Replays preserve the
        original audit and conflicting bodies fail before any new mutation.
        """
        from models.dify_builder_native_tests import NativePendingAction
        from services.dify_builder.native_testing.lifecycle import revoke_request_authority

        with self.loader.session_factory() as sql:
            owned, _ = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            if recovery_record(owned.bindings) is None:
                return False
            state = invocation_state(sql, ref, owned.tenant_id)
            continuation = sql.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == state.checkpoint_id
                )
            )
            if continuation is None:
                raise BuilderExecutionPolicyError("native_pending_conflict")
            checkpoint = CheckpointRef(
                checkpoint_id=continuation.checkpoint_id, payload_digest=continuation.payload_digest
            )
        history = self._recovery_history(ref=ref, checkpoint=checkpoint)
        if history is None:
            raise BuilderExecutionPolicyError("native_pending_conflict")
        pending_ids = {call.pending_operation_id for call in history.calls}
        if history.graph is not None:
            pending_ids.update(call.pending_operation_id for call in history.graph.checkpoint.pending_calls)
        pending_ids.update(call.pending_operation_id for call in history.current_calls)
        key, body = self.commands.api._command(
            "decision",
            {
                "pending_operation_id": pending_operation_id,
                "decision": "deny",
                "scope_digest": scope_digest,
                "expected_version": expected_version,
            },
            idempotency_key,
        )
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, _):
            self._recheck_recovery(sql, owned, history)
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                raise BuilderExecutionPolicyError("native_pending_conflict")
            if any(
                record.get("native_command_key") == key and record.get("body_digest") != body
                for record in request.observations
            ):
                raise BuilderExecutionPolicyError("native_idempotency_conflict")
            prior = [
                record["native_terminal_denial"]
                for record in request.observations
                if "native_terminal_denial" in record
                and record["native_terminal_denial"].get("idempotency_digest") == key
            ]
            if prior and any(record.get("body_digest") != body for record in prior):
                raise BuilderExecutionPolicyError("native_idempotency_conflict")
            pending = sql.scalar(
                owner_query(NativePendingAction, ref, owned.tenant_id).where(
                    NativePendingAction.id == pending_operation_id
                )
            )
            if (
                pending is None
                or pending_operation_id not in pending_ids
                or (pending.owner_version, pending.generation + 1) != (scope_digest, expected_version)
            ):
                raise BuilderExecutionPolicyError("native_pending_conflict")
            if not prior:
                if len(request.observations) >= 4096:
                    raise BuilderExecutionPolicyError("native_command_limit")
                request.observations = [
                    *request.observations,
                    {
                        "native_terminal_denial": {
                            "pending_operation_id": pending_operation_id,
                            "decision": "deny",
                            "scope_digest": scope_digest,
                            "expected_version": expected_version,
                            "idempotency_digest": key,
                            "body_digest": body,
                        },
                        "public_decision_saved": True,
                    },
                ]
            revoke_request_authority(
                sql,
                request_id=ref.request_id,
                tenant_id=owned.tenant_id,
                cancellation_key=self.commands.api.lifecycle._idempotency(
                    "cancel", canonical_digest({"deny": idempotency_key})
                ),
            )
        return True

    def prepare_recovery(self, *, ref):
        """Select the current retained recovery checkpoint; no recovery returns False.

        Before revocation this saves nothing. After revocation it freezes the
        stable SDK/wait boundary for same-child cancellation and settlement.
        Ordinary preparations remain with the active reader below.
        """
        with self.loader.session_factory() as sql:
            owned, _ = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            state = invocation_state(sql, ref, owned.tenant_id)
            continuation = sql.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == state.checkpoint_id
                )
            )
            checkpoint = (
                None
                if continuation is None
                else CheckpointRef(checkpoint_id=continuation.checkpoint_id, payload_digest=continuation.payload_digest)
            )
        return checkpoint is not None and self._prepare_recovery(ref=ref, checkpoint=checkpoint)

    def prepare(self, *, ref):
        """Capture ordinary active proof or an already revoked recovery chain."""
        if self.prepare_recovery(ref=ref):
            return
        paused = self.commands.continuation.read_parent_pause(ref=ref)
        with self.loader.session_factory() as sql:
            owned, _ = self.loader._load(sql, ref=ref, lock=False)
            state = invocation_state(sql, ref, owned.tenant_id)
            prior_state = state.state
            checkpoint_generation = state.generation - (1 if prior_state == "queued" else 0)
            continuation = sql.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == state.checkpoint_id,
                    NativeContinuation.generation == checkpoint_generation,
                )
            )
            if prior_state not in {"waiting", "queued"} or continuation is None:
                return
            checkpoint = CheckpointRef(
                checkpoint_id=continuation.checkpoint_id, payload_digest=continuation.payload_digest
            )
            generation = state.generation
            objects = self._objects(sql, ref, owned.tenant_id)
            sources = self._sources(sql, ref)
        payload = self.commands.api.store.read_checkpoint_for_cancellation(ref=ref, checkpoint=checkpoint)
        executions = {item.execution_id for item in paused.runtime.graph_execution.node_executions.values()}
        if (
            payload.native_run_id != paused.native_run_id
            or payload.generation != checkpoint_generation
            or payload.graph_runtime_state_json != paused.state.serialized_graph_runtime_state
            or not payload.agent_associations
            or any(
                wait.parent_node.ref != ref or wait.parent_node.execution_id not in executions
                for wait in payload.agent_associations
            )
        ):
            return
        children = []
        for wait in payload.agent_associations:
            protected = self.commands.api.store.read_agent_association_for_cancellation(
                ref=ref, parent_node=wait.parent_node, wait=wait
            )
            children.append(protected.association.agent_run_id)
        proof = {
            "generation": generation,
            "checkpoint_generation": checkpoint_generation,
            "checkpoint": checkpoint.model_dump(mode="json"),
            "pause_id": paused.pause_id,
            "state_object_key": paused.state_object_key,
            "runtime_digest": canonical_digest(paused.state.serialized_graph_runtime_state),
            "native_run_id": paused.native_run_id,
            "children": sorted(set(children)),
            "objects": objects,
            "sources": [list(source) for source in sources],
            "context_object_id": state.context_object_id,
        }
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, _):
            # Neither this snapshot nor its client-independent child IDs may
            # survive a changed checkpoint/ordinary pause during preparation.
            if not self._matches(sql, ref, owned, proof):
                return
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return
            if (
                _native_run_id(request) != paused.native_run_id
                or invocation_state(sql, ref, owned.tenant_id).state != prior_state
            ):
                return
            if not any(PREPARATION in record for record in request.observations):
                request.observations = [*request.observations, {PREPARATION: proof}]

    def _matches(self, sql, ref, owned, proof, *, history=None):
        """Compare retained pause, sources, receipts and ledger under the root lock.

        Recovery requires the outside-lock decoded history and its exact selected
        receipt subset; ordinary callers retain the original complete snapshot.
        Mismatch returns False, corrupt required evidence raises, and neither
        path performs I/O or grants mutation/cleanup authority.
        """
        if "recovery" in proof:
            if not self._recovery_preparation_matches(proof, history):
                return False
            self._recheck_recovery(sql, owned, history)
        state = invocation_state(sql, ref, owned.tenant_id)
        run, pause = self._rows(sql, owned, proof["native_run_id"], lock=True)
        continuations = sql.scalars(
            owner_query(NativeContinuation, ref, owned.tenant_id).where(
                NativeContinuation.checkpoint_id == proof["checkpoint"]["checkpoint_id"],
                NativeContinuation.payload_digest == proof["checkpoint"]["payload_digest"],
                NativeContinuation.generation == proof.get("checkpoint_generation", proof["generation"]),
            )
        ).all()
        states = sql.scalars(
            select(NativeInvocationState).where(NativeInvocationState.request_id == ref.request_id)
        ).all()
        sources = sql.scalars(select(NativeDispatch).where(NativeDispatch.request_id == ref.request_id)).all()
        operations = sql.scalars(
            select(NativeEffectOperation).where(NativeEffectOperation.request_id == ref.request_id)
        ).all()
        return (
            run is not None
            and run.status == "paused"
            and pause is not None
            and (pause.id, pause.state_object_key) == (proof["pause_id"], proof["state_object_key"])
            and state.checkpoint_id == proof["checkpoint"]["checkpoint_id"]
            and state.context_object_id == proof["context_object_id"]
            and (state.app_id, state.workflow_id) == (owned.app_id, owned.workflow_id)
            and state.generation == proof["generation"]
            and len(continuations) == 1
            and len(states) == 1
            and states[0].invocation_id == ref.invocation_id
            # Initial confirmed runs use the ordinary generator directly;
            # only later native resumes require a durable dispatch source.
            and (
                (state.generation == 0 and not sources)
                or (bool(sources) and any(source.generation == state.generation for source in sources))
            )
            and all(
                source.tenant_id == owned.tenant_id
                and source.invocation_id == ref.invocation_id
                and (source.state == "completed" or self._unclaimed_resume(source, proof))
                and source.generation <= state.generation
                for source in sources
            )
            and all(
                operation.tenant_id == owned.tenant_id
                and operation.invocation_id == ref.invocation_id
                and (
                    operation.state in {"completed", "failed", "not_dispatched", "denied", "pending"}
                    or (
                        operation.state == "cancelled"
                        and history is not None
                        and history.overlay is not None
                        and operation.operation_digest
                        in {operation_digest(entry.intent.key) for entry in history.calls}
                    )
                )
                for operation in operations
            )
            and settled_physical_facts(sql, ref=ref, tenant_id=owned.tenant_id, operations=operations) is not None
            and (
                self._recovery_preparation_matches(proof, history)
                if "recovery" in proof
                else self._objects(sql, ref, owned.tenant_id) == proof["objects"]
            )
            and self._sources_match(sql, ref, proof)
        )

    def stop_is_saved(self, *, ref):
        """Read an exact sealed logical stop, never physical cleanup.

        Initial runs have no dispatch. Resumed runs additionally retain the
        original cancellation preparation's complete source/object snapshot.
        Recovery rereads its exact protected chain for both generations, after
        resource GC as well; a copied terminal outcome alone is insufficient.

        Precondition: ref identifies the authenticated root invocation. Protected
        history is decoded before the final SQL-only settlement root lock.
        Postcondition: recovery receipts, ledger and sources are rechecked in
        that same transaction; no execution or physical-cleanup claim is made.
        """
        history, recovery_proof = None, None
        with self.loader.session_factory() as sql:
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None or request.state != "sealed":
                return False
            preparations = [record[PREPARATION] for record in request.observations if PREPARATION in record]
            if len(preparations) == 1 and "recovery" in preparations[0]:
                recovery_proof = preparations[0]
        if recovery_proof is not None:
            history = self._recovery_history(
                ref=ref, checkpoint=CheckpointRef.model_validate(recovery_proof["checkpoint"])
            )
            if not self._recovery_preparation_matches(recovery_proof, history):
                return False
        owned = None
        with ExitStack() as stack:
            if recovery_proof is not None:
                sql, owned, _ = stack.enter_context(self.loader.locked(ref=ref, settlement=True))
            else:
                sql = stack.enter_context(self.loader.session_factory())
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None or request.state != "sealed":
                return False
            outcome = _terminal_proof(sql, request=request, ref=ref)
            if outcome is not None and outcome.reason_code == "native_cancelled":
                return True
            states = sql.scalars(
                select(NativeInvocationState).where(NativeInvocationState.request_id == ref.request_id)
            ).all()
            invocations = sql.scalars(
                select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
            ).all()
            if len(states) != 1 or len(invocations) != 1:
                return False
            state, invocation = states[0], invocations[0]
            if recovery_proof is not None:
                self._recheck_recovery(sql, owned, history)
                if (
                    [record[PREPARATION] for record in request.observations if PREPARATION in record]
                    != [recovery_proof]
                    or state.generation != recovery_proof["generation"]
                    or state.context_object_id != recovery_proof["context_object_id"]
                    or state.checkpoint_id != recovery_proof["checkpoint"]["checkpoint_id"]
                    or not self._sources_match(sql, ref, recovery_proof)
                ):
                    return False
            if (
                (state.tenant_id, state.invocation_id, state.parent_invocation_id)
                != (self.commands.actor.tenant_id, ref.invocation_id, None)
                or type(state.generation) is not int
                or state.generation < 0
                or (invocation.tenant_id, invocation.invocation_id)
                != (self.commands.actor.tenant_id, ref.invocation_id)
                or invocation.active
                or (state.app_id, state.workflow_id) != (request.app_id, request.workflow_id)
                or sql.scalar(
                    owner_query(NativePayloadObject, ref, request.tenant_id).where(
                        NativePayloadObject.id == state.context_object_id, NativePayloadObject.kind == "context"
                    )
                )
                is None
            ):
                return False
            sources = sql.scalars(select(NativeDispatch).where(NativeDispatch.request_id == ref.request_id)).all()
            if state.generation == 0:
                if sources:
                    return False
            else:
                proofs = [record[PREPARATION] for record in request.observations if PREPARATION in record]
                if len(proofs) != 1 or not isinstance(proofs[0], dict):
                    return False
                proof = proofs[0]
                try:
                    checkpoint = CheckpointRef.model_validate(proof.get("checkpoint"))
                except (TypeError, ValueError):
                    return False
                continuations = sql.scalars(
                    owner_query(NativeContinuation, ref, request.tenant_id).where(
                        NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                        NativeContinuation.payload_digest == checkpoint.payload_digest,
                        NativeContinuation.generation == proof.get("checkpoint_generation", state.generation),
                    )
                ).all()
                if (
                    state.checkpoint_id != checkpoint.checkpoint_id
                    or len(continuations) != 1
                    or type(proof.get("generation")) is not int
                    or not sources
                    or proof.get("generation") != state.generation
                    or proof.get("context_object_id") != state.context_object_id
                    or proof.get("native_run_id") != _native_run_id(request)
                    or not proof.get("children")
                    or not self._sources_match(sql, ref, proof)
                    or (
                        not self._recovery_preparation_matches(proof, history)
                        if "recovery" in proof
                        else proof.get("objects") != self._objects(sql, ref, request.tenant_id)
                    )
                    or not any(source.generation == state.generation for source in sources)
                    or any(
                        (source.tenant_id, source.invocation_id) != (request.tenant_id, ref.invocation_id)
                        or not (source.state == "completed" or self._unclaimed_resume(source, proof))
                        or not 0 <= source.generation <= state.generation
                        for source in sources
                    )
                ):
                    return False
            operations = sql.scalars(
                select(NativeEffectOperation).where(NativeEffectOperation.request_id == ref.request_id)
            ).all()
            if any(
                (operation.tenant_id, operation.invocation_id) != (request.tenant_id, ref.invocation_id)
                or operation.state not in {"completed", "failed", "not_dispatched"}
                for operation in operations
            ):
                return False
            if settled_physical_facts(sql, ref=ref, tenant_id=request.tenant_id, operations=operations) is None:
                return False
            outcome = _terminal_proof(sql, request=request, ref=ref)
            return outcome is not None and outcome.status == "stopped" and outcome.reason_code == "effect_denied"

    def retry_children(self, *, ref):
        """Targets for an explicit cancel only; revoked scopes gain no read/run grant.

        Resolve the retained encrypted checkpoint/binding or recovery chain again
        rather than trusting a child ID copied into observations. The final SQL
        proof check ends before cancellation RPC. GET never calls this.
        """
        history = None
        with self.loader.session_factory() as sql:
            owned, scope = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            request = _request(sql, actor=self.commands.actor, ref=ref)
            state = invocation_state(sql, ref, owned.tenant_id)
            if request is None or not scope.cancelled or state.state != "cancelled" or state.outcome is not None:
                return ()
            proofs = [record[PREPARATION] for record in request.observations if PREPARATION in record]
            if len(proofs) != 1 or _native_run_id(request) != proofs[0]["native_run_id"]:
                return ()
            proof = proofs[0]
            objects = self._objects(sql, ref, owned.tenant_id)
            if "recovery" not in proof and objects != proof["objects"]:
                return ()
        if "recovery" in proof:
            history = self._recovery_history(ref=ref, checkpoint=CheckpointRef.model_validate(proof["checkpoint"]))
            with self.loader.locked(ref=ref, settlement=True) as (sql, owned, scope):
                if not scope.cancelled or not self._matches(sql, ref, owned, proof, history=history):
                    return ()
            return history.children if history is not None else ()
        validate_private_read(self.loader, ref)
        receipts = {value["id"]: ObjectReceipt(**value) for value in objects}
        checkpoint = receipts[proof["checkpoint"]["checkpoint_id"]]
        if checkpoint.kind != "checkpoint" or checkpoint.payload_digest != proof["checkpoint"]["payload_digest"]:
            return ()
        payload = NativeCheckpointPayload.model_validate(self.commands.api.store._read_object(checkpoint))
        if (
            payload.native_run_id != proof["native_run_id"]
            or payload.generation != proof.get("checkpoint_generation", proof["generation"])
            or canonical_digest(payload.graph_runtime_state_json) != proof["runtime_digest"]
            or not payload.agent_associations
        ):
            return ()
        children = []
        for wait in payload.agent_associations:
            binding = receipts[wait.association_object_ref]
            if (
                wait.parent_node.ref != ref
                or binding.kind != "result"
                or binding.logical_key != NativeExecutionStateStore._agent_key("agent-bind", wait.parent_node)
            ):
                return ()
            association = AgentNodeAssociation.model_validate(self.commands.api.store._read_object(binding))
            if (
                association.parent_node != wait.parent_node
                or association.workflow_native_run_id != payload.native_run_id
            ):
                return ()
            children.append(association.agent_run_id)
        targets = tuple(sorted(set(children)))
        if list(targets) != proof["children"]:
            return ()
        paused = WorkflowResumptionContext.loads(storage.load(proof["state_object_key"]).decode())
        validate_parent_snapshot(state=paused, ref=ref, native_run_id=proof["native_run_id"])
        if canonical_digest(paused.serialized_graph_runtime_state) != proof["runtime_digest"]:
            return ()
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, scope):
            request = _request(sql, actor=self.commands.actor, ref=ref)
            state = invocation_state(sql, ref, owned.tenant_id)
            if (
                request is None
                or _native_run_id(request) != proof["native_run_id"]
                or not scope.cancelled
                or scope.generation != proof["generation"]
                or state.state != "cancelled"
                or state.outcome is not None
                or [record[PREPARATION] for record in request.observations if PREPARATION in record] != [proof]
                or not self._matches(sql, ref, owned, proof, history=history)
            ):
                return ()
        return targets

    def settle(self, *, ref):
        if self.settle_terminal(ref=ref):
            return True
        if self.settle_control_pause(ref=ref):
            return True
        with self.loader.session_factory() as sql:
            owned, scope = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return False
            state = invocation_state(sql, ref, owned.tenant_id)
            if not scope.cancelled:
                return False
            saved = state.outcome or {}
            saved_recovery_stop = (
                saved.get("reason_code") == "effect_denied"
                and saved.get("status") == "stopped"
                and recovery_record(owned.bindings) is not None
            )
            if (
                saved.get("reason_code") == "effect_denied"
                and saved.get("status") == "stopped"
                and not saved_recovery_stop
            ):
                return _terminal_proof(sql, request=request, ref=ref) is not None
            proofs = [record[PREPARATION] for record in request.observations if PREPARATION in record]
            if len(proofs) != 1:
                return False
            proof = proofs[0]
            if _native_run_id(request) != proof["native_run_id"]:
                return False
        if saved_recovery_stop:
            return self.stop_is_saved(ref=ref)
        history = None
        if "recovery" in proof:
            history = self._recovery_history(ref=ref, checkpoint=CheckpointRef.model_validate(proof["checkpoint"]))
            if not self._recovery_preparation_matches(proof, history):
                return False
        # Retained preparation never suffices: read the actual original child,
        # then recheck all local facts under the scope lock before recording stop.
        for child in proof["children"]:
            status = self.commands.backend.client.get_run_sync(child)
            status = RunStatusResponse.model_validate(status.model_dump(mode="json"))
            if status.run_id != child or status.status != "cancelled":
                return False
        if not proof["children"]:
            return False
        state = WorkflowResumptionContext.loads(storage.load(proof["state_object_key"]).decode())
        validate_parent_snapshot(state=state, ref=ref, native_run_id=proof["native_run_id"])
        if canonical_digest(state.serialized_graph_runtime_state) != proof["runtime_digest"]:
            return False
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, scope):
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return False
            if (
                _native_run_id(request) != proof["native_run_id"]
                or invocation_state(sql, ref, owned.tenant_id).state != "cancelled"
            ):
                return False
            if (
                not scope.cancelled
                or scope.generation != proof["generation"]
                or not self._matches(sql, ref, owned, proof, history=history)
            ):
                return False
            run, pause = self._rows(sql, owned, proof["native_run_id"], lock=True)
            run.status, run.error, run.finished_at = "stopped", "effect_denied", utc_now()
            # Paused elapsed time is already accumulated by the native owner;
            # wall time spent waiting for consent is not execution time.
            sql.execute(delete(WorkflowPauseReason).where(WorkflowPauseReason.pause_id == pause.id))
            sql.delete(pause)
            request.state = "sealed"
            state = invocation_state(sql, ref, owned.tenant_id)
            state.pending_ids, state.wait_reason = [], None
            state.outcome = NativeWorkflowOutcome(
                status="stopped",
                ref=ref,
                native_run_id=run.id,
                checkpoint_ref=None,
                pending_operation_ids=(),
                reason_code="effect_denied",
                wait_reason=None,
                native_status="stopped",
                output_result_ref=None,
            ).model_dump(mode="json")
            # cancellation/cleanup state and capacity remain with C02.
            return True

    def settle_control_pause(self, *, ref):
        """Acknowledge user stop separately from the child's actual terminal status.

        Read SDK/storage with no SQL writer. Commit its original pause/child
        receipt before ordinary stop can retire resources. Release the C04 lock
        before calling that owner; then lock C04 before rereading its durable
        Run stop fence. A stopped Run cannot be resumed or revived by late saves.
        """
        with self.loader.session_factory() as sql:
            owned, _ = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return False
            facts = stop_control_facts(sql, request=request, ref=ref)
            if facts is None:
                return False
            native, node, _, binding = facts
            records = [record[STOP_CONTROL] for record in request.observations if STOP_CONTROL in record]
            if len(records) > 1 or (records and not isinstance(records[0], dict)):
                return False
            observation = records[0] if records else None
            if observation is not None and not stop_observation_matches(observation, binding):
                return False
            _, pause = self._rows(sql, owned, native.id, lock=False)
            pause_ref = (pause.id, pause.state_object_key) if pause is not None else None
            native_status = native.status
            if (
                observation is not None
                and native_status == "paused"
                and (
                    pause_ref is None
                    or observation["pause_id"] != pause_ref[0]
                    or observation["pause_key_digest"] != canonical_digest(pause_ref[1])
                )
            ):
                return False
            app = sql.scalar(select(App).where(App.id == request.app_id, App.tenant_id == owned.tenant_id))
            if app is None:
                return False
            mode = AppMode.value_of(app.mode)
        if observation is None:
            if native_status != "paused" or pause_ref is None:
                return False
            paused = WorkflowResumptionContext.loads(storage.load(pause_ref[1]).decode())
            runtime = validate_parent_snapshot(state=paused, ref=ref, native_run_id=binding["native_run_id"])
            if binding["node_execution_id"] not in {
                entry.execution_id for entry in runtime.graph_execution.node_executions.values()
            }:
                return False
            status = self.commands.backend.client.get_run_sync(binding["child_run_id"])
            status = RunStatusResponse.model_validate(status.model_dump(mode="json"))
            if status.run_id != binding["child_run_id"] or status.status not in {"succeeded", "failed", "cancelled"}:
                return False
            observation = {
                **binding,
                "pause_id": pause_ref[0],
                "pause_key_digest": canonical_digest(pause_ref[1]),
                "runtime_digest": canonical_digest(paused.serialized_graph_runtime_state),
                "source_original_state": "claimed",
                "child_status": status.status,
                "child_error_digest": canonical_digest(status.error) if status.error is not None else None,
                "backend_updated_at": status.updated_at.isoformat(),
            }
            with self.loader.locked(ref=ref, settlement=True) as (sql, owned, _):
                request = _request(sql, actor=self.commands.actor, ref=ref)
                if request is None:
                    return False
                fresh = stop_control_facts(sql, request=request, ref=ref)
                if fresh is None or fresh[3] != binding:
                    return False
                _, current_pause = self._rows(sql, owned, binding["native_run_id"], lock=True)
                if current_pause is None or (current_pause.id, current_pause.state_object_key) != pause_ref:
                    return False
                current = [record[STOP_CONTROL] for record in request.observations if STOP_CONTROL in record]
                if current and current != [observation]:
                    return False
                if not current:
                    request.observations = [*request.observations, {STOP_CONTROL: observation}]
        if observation.get("child_status") not in {"succeeded", "failed", "cancelled"}:
            return False
        if native_status == "paused":
            # This owner commits the Run lock/fence, forms and pause invalidation,
            # then publishes history and retires resources outside its writer.
            from extensions.ext_redis import redis_client
            from services.app_task_service import AppTaskService

            AppTaskService.stop_workflow_run(
                tenant_id=self.commands.actor.tenant_id,
                app_id=owned.app_id,
                run_id=binding["native_run_id"],
                app_mode=mode,
                owner=(CreatorUserRole.ACCOUNT, self.commands.actor.account_id),
                redis=redis_client,
            )
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, _):
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return False
            facts = stop_control_facts(sql, request=request, ref=ref)
            if facts is None:
                return False
            native, _, source, current = facts
            if native.status != "stopped" or current != binding:
                return False
            if sql.scalar(select(WorkflowPause.id).where(WorkflowPause.workflow_run_id == native.id)) is not None:
                return False
            saved = [record[STOP_CONTROL] for record in request.observations if STOP_CONTROL in record]
            if saved != [observation]:
                return False
            source.state = "cancelled"  # Preserve its original lease and delivery audit.
            state = invocation_state(sql, ref, owned.tenant_id)
            state.pending_ids, state.wait_reason = [], None
            state.outcome = NativeWorkflowOutcome(
                status="stopped",
                ref=ref,
                native_run_id=native.id,
                checkpoint_ref=None,
                pending_operation_ids=(),
                reason_code="native_cancelled",
                wait_reason=None,
                native_status="stopped",
                output_result_ref=None,
            ).model_dump(mode="json")
            request.state = "sealed"
            return True

    def settle_terminal(self, *, ref):
        """Seal consumed cancellation or observe a revoked restore guard's child.

        A consumed native event needs SQL only. If revocation prevented event
        consumption, read only the original child outside the writer, then bind
        its actual cancelled status to the rechecked SQL snapshot. No Graphon
        producer metadata or physical cleanup acknowledgement is manufactured.
        """
        with self.loader.session_factory() as sql:
            self.loader._load(sql, ref=ref, lock=False, settlement=True)
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return False
            state = invocation_state(sql, ref, request.tenant_id)
            if state.outcome is not None:
                outcome = _terminal_proof(sql, request=request, ref=ref)
                return outcome is not None and outcome.reason_code == "native_cancelled"
            proof = cancelled_parent_proof(
                sql, request=request, ref=ref, allow_claimed=True, allow_unobserved_guard=True
            )
            if proof is None:
                return False
            _, child, _ = proof
        observation = None
        if child.get("needs_observation"):
            binding = child.get("observation_binding")
            if not isinstance(binding, dict):
                return False
            status = self.commands.backend.client.get_run_sync(child["run_id"])
            status = RunStatusResponse.model_validate(status.model_dump(mode="json"))
            if status.run_id != child["run_id"] or status.status != "cancelled":
                return False
            observation = {
                **binding,
                "status": "cancelled",
                "backend_updated_at": status.updated_at.isoformat(),
            }
        with self.loader.locked(ref=ref, settlement=True) as (sql, owned, _):
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return False
            state = invocation_state(sql, ref, owned.tenant_id)
            if state.outcome is not None:
                outcome = _terminal_proof(sql, request=request, ref=ref)
                return outcome is not None and outcome.reason_code == "native_cancelled"
            proof = cancelled_parent_proof(
                sql, request=request, ref=ref, allow_claimed=True, allow_unobserved_guard=True
            )
            if proof is None:
                return False
            native, child, source = proof
            if child.get("needs_observation"):
                binding = child.get("observation_binding")
                if (
                    not isinstance(binding, dict)
                    or observation is None
                    or any(observation.get(key) != value for key, value in binding.items())
                ):
                    return False
                request.observations = [*request.observations, {CANCELLED_CHILD_OBSERVATION: observation}]
            if source is not None:
                source.state = "completed"
            state.pending_ids, state.wait_reason = [], None
            state.outcome = NativeWorkflowOutcome(
                status="stopped",
                ref=ref,
                native_run_id=native.id,
                checkpoint_ref=None,
                pending_operation_ids=(),
                reason_code="native_cancelled",
                wait_reason=None,
                native_status="failed",
                output_result_ref=None,
            ).model_dump(mode="json")
            request.state = "sealed"
            return True
