"""Ordinary Workflow pause ownership for the confirmed Agent profile.

Backend SSE is only a locator. The selected backend checkpoint and the ordinary
WorkflowPause are read back before C03 can publish a resumable waiting receipt.
This adapter never starts a Workflow or creates an Agent Run.
"""

from dataclasses import dataclass

from dify_agent.protocol.native_continuation import (
    AgentCheckpoint,
    ReadNativeCheckpointRequest,
    SelectedNativeCheckpoint,
)
from dify_agent.protocol.native_testing import AgentNativeTestRef
from sqlalchemy import select

from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from extensions.ext_storage import storage
from graphon.runtime import RuntimeState
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeEffectOperation, NativePayloadObject, NativePendingAction
from models.enums import CreatorUserRole
from models.workflow import WorkflowPause, WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef, AgentWaitAssociation
from runtime_contracts.builder.native.contracts import NativeTestContextRef, operation_digest
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NodeJournalState
from services.dify_builder.native_testing.agent_bridge import api_intent
from services.dify_builder.native_testing.state_store import ObjectReceipt, owner_query

PROFILE = "builder-agent-confirmed-v1"


def validate_parent_snapshot(*, state, ref: NativeTestContextRef, native_run_id: str) -> RuntimeState:
    context = state.get_generate_entity().builder_agent_execution
    if context is None or (context.ref, context.native_run_id) != (ref, native_run_id):
        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
    runtime = RuntimeState.from_snapshot(state.serialized_graph_runtime_state)
    graph = runtime.graph_execution
    if not graph.paused or graph.completed or graph.aborted:
        raise BuilderExecutionPolicyError("native_parent_pause_uncommitted")
    return runtime


def validate_pending_call(*, call, intent, execution_id: str):
    if api_intent(call.intent) != intent or intent.key.occurrence_path[:1] != (execution_id,):
        raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")
    return intent


@dataclass(frozen=True)
class OwnedParentPause:
    pause_id: str
    state_object_key: str
    native_run_id: str
    state: WorkflowResumptionContext
    runtime: RuntimeState


class ConfirmedAgentContinuation:
    def __init__(self, *, loader, store, operations, backend, lifecycle):
        self.loader, self.store, self.operations, self.backend, self.lifecycle = (
            loader,
            store,
            operations,
            backend,
            lifecycle,
        )

    def _parent_rows(self, session, *, ref):
        owned, _ = self.loader._load(session, ref=ref, lock=False)
        request = session.get(DifyBuilderExecutionRequest, ref.request_id)
        if request is None or request.context.get("profile", {}).get("profile_id") != PROFILE:
            raise BuilderExecutionPolicyError("native_profile_unavailable")
        native_run_id = request.native_run_id or request.context.get("native_run_id")
        run = session.scalar(
            select(WorkflowRun).where(
                WorkflowRun.id == native_run_id,
                WorkflowRun.tenant_id == owned.tenant_id,
                WorkflowRun.app_id == owned.app_id,
                WorkflowRun.workflow_id == owned.workflow_id,
                WorkflowRun.created_by == owned.actor_id,
                WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
            )
        )
        pause = session.scalar(
            select(WorkflowPause).where(
                WorkflowPause.workflow_run_id == native_run_id,
                WorkflowPause.workflow_id == owned.workflow_id,
                WorkflowPause.resumed_at.is_(None),
            )
        )
        if run is None or run.status != "paused" or pause is None:
            raise BuilderExecutionPolicyError("native_parent_pause_uncommitted")
        return run, pause

    def read_parent_pause(self, *, ref: NativeTestContextRef) -> OwnedParentPause:
        self.loader.load(ref=ref)
        with self.loader.session_factory() as session:
            run, pause = self._parent_rows(session, ref=ref)
            run_id, pause_id, key = run.id, pause.id, pause.state_object_key
        # The ordinary owner stores this exact resumption envelope; no second
        # runtime serializer or synthetic Graphon state is introduced here.
        try:
            state = WorkflowResumptionContext.loads(storage.load(key).decode())
            runtime = validate_parent_snapshot(state=state, ref=ref, native_run_id=run_id)
        except BuilderExecutionPolicyError:
            raise
        except Exception:
            raise BuilderExecutionPolicyError("native_parent_pause_uncommitted") from None
        with self.loader.locked(ref=ref) as (session, _, _):
            _, current = self._parent_rows(session, ref=ref)
            if (current.id, current.state_object_key) != (pause_id, key):
                raise BuilderExecutionPolicyError("native_parent_pause_uncommitted")
        return OwnedParentPause(pause_id, key, run_id, state, runtime)

    def _selected(self, *, ref, association, generation, event_id):
        selection = ReadNativeCheckpointRequest(
            ref=AgentNativeTestRef.model_validate(ref.model_dump(mode="json")),
            expected_generation=generation,
            waiting_event_id=event_id,
            config_ref=association.config_ref,
            config_digest=association.config_digest,
        )
        try:
            result = self.backend.read_native_checkpoint(association.agent_run_id, selection)
            result = SelectedNativeCheckpoint.model_validate(result.model_dump(mode="json"))
            result.validate_selection(run_id=association.agent_run_id, request=selection)
            if result.checkpoint.native_test_profile != "confirmed":
                raise ValueError("profile")
        except Exception:
            raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable") from None
        return result

    def _pending(self, *, ref, parent_node, checkpoint):
        snapshots = []
        owned = self.loader.load(ref=ref)
        for call in checkpoint.pending_calls:
            intent, proposal, assessment = self.operations.snapshot(ref=ref, key=call.intent.key)
            validate_pending_call(call=call, intent=intent, execution_id=parent_node.execution_id)
            if proposal.key != intent.key:
                raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")
            self.operations.revalidate(ref=ref, intent=intent)
            with self.loader.session_factory() as session:
                pending = session.scalar(
                    owner_query(NativePendingAction, ref, owned.tenant_id).where(
                        NativePendingAction.id == call.pending_operation_id,
                        NativePendingAction.category == call.wait_reason,
                        NativePendingAction.generation == owned.generation,
                    )
                )
                operation = session.scalar(
                    owner_query(NativeEffectOperation, ref, owned.tenant_id).where(
                        NativeEffectOperation.operation_digest == operation_digest(intent.key),
                        NativeEffectOperation.intent_digest == canonical_digest(intent.model_dump(mode="json")),
                    )
                )
                if (
                    pending is None
                    or operation is None
                    or operation.state != "pending"
                    or pending.operation_id != operation.id
                    or pending.owner_ref != owned.app_id
                    or pending.owner_version != operation.scope_digest
                ):
                    raise BuilderExecutionPolicyError("native_pending_mismatch")
            snapshots.append((intent, proposal, assessment))
        return snapshots

    def prepare_wait(
        self,
        *,
        ref: NativeTestContextRef,
        parent_node: AgentParentNodeRef,
        agent_generation: int,
        backend_wait_event_id: str,
    ) -> AgentWaitAssociation:
        """Called before Graphon's pause event; public waiting is still forbidden."""
        protected = self.store.load_agent_association(ref=ref, parent_node=parent_node)
        selected = self._selected(
            ref=ref, association=protected.association, generation=agent_generation, event_id=backend_wait_event_id
        )
        self._pending(ref=ref, parent_node=parent_node, checkpoint=selected.checkpoint)
        return self.store.store_agent_wait(
            ref=ref,
            parent_node=parent_node,
            association_object_ref=protected.association_object_ref,
            agent_generation=agent_generation,
            checkpoint=selected.checkpoint.model_dump(mode="json"),
            backend_wait_event_id=backend_wait_event_id,
        )

    def _stored_waits(self, *, ref):
        owned = self.loader.load(ref=ref)
        with self.loader.session_factory() as session:
            rows = session.scalars(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.kind == "result", NativePayloadObject.logical_key.like("agent-cp:%")
                )
            ).all()
            receipts = [
                ObjectReceipt(**{name: getattr(row, name) for name in ObjectReceipt.__dataclass_fields__})
                for row in rows
            ]
        latest = {}
        for receipt in receipts:
            value = self.store._read_object(receipt)
            parent = AgentParentNodeRef.model_validate(value["parent_node"])
            checkpoint = AgentCheckpoint.model_validate(value["checkpoint"])
            wait = AgentWaitAssociation(
                parent_node=parent,
                association_object_ref=value["association_object_ref"],
                agent_generation=value["agent_generation"],
                checkpoint_object_ref=receipt.id,
                checkpoint_digest=canonical_digest(value["checkpoint"]),
                backend_wait_event_id=value["backend_wait_event_id"],
            )
            if parent.ref != ref or checkpoint.generation != wait.agent_generation:
                raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")
            previous = latest.get(parent.execution_id)
            if previous is None or previous.agent_generation < wait.agent_generation:
                latest[parent.execution_id] = wait
        return tuple(latest.values())

    def persist_parent_wait(self, *, ref: NativeTestContextRef, allow_ack_recovery: bool = False):
        """Call after consuming the actual ordinary paused stream, before disclosure."""
        context = self.store.load_context(ref=ref)
        paused = self.read_parent_pause(ref=ref)
        reasons = {getattr(reason, "message", None) for reason in paused.runtime.graph_execution.pause_reasons}
        allowed = {"agent_tool_approval"}
        if allow_ack_recovery:
            allowed |= {
                "agent_create_ack_unknown",
                "native_agent_continuation_unknown",
                "native_agent_wait_unverified",
                "agent_stream_ack_unknown",
            }
        if not reasons or not reasons <= allowed:
            raise BuilderExecutionPolicyError("native_parent_pause_unverified")
        waits = self._stored_waits(ref=ref)
        if not waits:
            raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
        executions = {node.execution_id for node in paused.runtime.graph_execution.node_executions.values()}
        journals, proposals, pending_ids, inputs, selected_waits = [], [], [], [], []
        for wait in waits:
            parent = wait.parent_node
            protected = self.store.load_agent_association(ref=ref, parent_node=parent, wait=wait)
            if protected.terminal_result_ref is not None:
                continue
            if parent.execution_id not in executions:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            selected = self._selected(
                ref=ref,
                association=protected.association,
                generation=wait.agent_generation,
                event_id=wait.backend_wait_event_id,
            )
            if canonical_digest(selected.checkpoint.model_dump(mode="json")) != wait.checkpoint_digest:
                raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")
            snapshots = self._pending(ref=ref, parent_node=parent, checkpoint=selected.checkpoint)
            groups = {(parent.execution_id,): []}
            for intent, proposal, _assessment in snapshots:
                groups.setdefault(intent.key.occurrence_path, []).append(intent)
                proposals.append(proposal)
            for path, intents in groups.items():
                journals.append(
                    NodeJournalState(
                        invocation_id=ref.invocation_id,
                        occurrence_path=path,
                        input_result_ref=parent.input_result_ref,
                        input_digest=parent.input_digest,
                        cursor=max((intent.key.cursor + 1 for intent in intents), default=0),
                        operation_keys=tuple(intent.key for intent in intents),
                        result_refs=(),
                        intents=tuple(intents),
                    )
                )
            pending_ids.extend(call.pending_operation_id for call in selected.checkpoint.pending_calls)
            inputs.append(parent.input_result_ref)
            selected_waits.append(wait)
        if not pending_ids:
            raise BuilderExecutionPolicyError("native_pending_mismatch")
        payload = NativeCheckpointPayload(
            schema_version="1",
            native_run_id=paused.native_run_id,
            generation=context.generation,
            generate_entity_json=paused.state.get_generate_entity().model_dump_json(),
            graph_runtime_state_json=paused.state.serialized_graph_runtime_state,
            response_stream_filter_json=paused.state.get_response_stream_filter().dumps(),
            node_journals=tuple(journals),
            child_refs=(),
            input_result_refs=tuple(inputs),
            approval_proposals=tuple(proposals),
            agent_associations=tuple(selected_waits),
        )
        checkpoint = self.store.commit_checkpoint(ref=ref, generation=context.generation, payload=payload)
        current = self.read_parent_pause(ref=ref)
        if (current.pause_id, current.state_object_key) != (paused.pause_id, paused.state_object_key):
            raise BuilderExecutionPolicyError("native_parent_pause_uncommitted")
        return self.lifecycle.pause(
            ref=ref,
            checkpoint=checkpoint,
            pending_operation_ids=tuple(pending_ids),
            expected_generation=context.generation,
        )
