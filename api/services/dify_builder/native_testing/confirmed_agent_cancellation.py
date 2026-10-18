"""Logical stop of the original confirmed Agent pause, independent of cleanup.

Only opaque SQL object receipts and snapshot hashes survive revocation. They
retain evidence selected by the ordinary owners, never execution authority.
Backend and storage reads happen before the bounded SQL settlement transaction.
"""

from dataclasses import asdict
from operator import itemgetter

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
)
from models.enums import CreatorUserRole
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from services.dify_builder.execution_contracts import canonical_digest
from services.dify_builder.native_testing.agent_contracts import AgentNodeAssociation
from services.dify_builder.native_testing.confirmed_agent_completion import _native_run_id, _request, _terminal_proof
from services.dify_builder.native_testing.confirmed_agent_continuation import validate_parent_snapshot
from services.dify_builder.native_testing.contracts import CheckpointRef
from services.dify_builder.native_testing.private_reads import validate_private_read
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload, NativeWorkflowOutcome
from services.dify_builder.native_testing.state_store import (
    NativeExecutionStateStore,
    ObjectReceipt,
    invocation_state,
    owner_query,
)

PREPARATION = "confirmed_agent_cancel_v1"


class ConfirmedAgentCancellation:
    def __init__(self, commands):
        self.commands = commands
        self.loader = commands.loader

    def _objects(self, sql, ref, tenant_id):
        return sorted(
            (
                asdict(ObjectReceipt(**{name: getattr(row, name) for name in ObjectReceipt.__dataclass_fields__}))
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

    def prepare(self, *, ref):
        """Capture through existing active readers; failure grants no stop proof."""
        paused = self.commands.continuation.read_parent_pause(ref=ref)
        with self.loader.session_factory() as sql:
            owned, _ = self.loader._load(sql, ref=ref, lock=False)
            state = invocation_state(sql, ref, owned.tenant_id)
            continuation = sql.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == state.checkpoint_id,
                    NativeContinuation.generation == state.generation,
                )
            )
            if state.state != "waiting" or continuation is None:
                return
            checkpoint = CheckpointRef(
                checkpoint_id=continuation.checkpoint_id, payload_digest=continuation.payload_digest
            )
            generation = state.generation
            objects = self._objects(sql, ref, owned.tenant_id)
            sources = self._sources(sql, ref)
        payload = self.commands.api.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
        executions = {item.execution_id for item in paused.runtime.graph_execution.node_executions.values()}
        if (
            payload.native_run_id != paused.native_run_id
            or payload.generation != generation
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
            protected = self.commands.api.store.load_agent_association(ref=ref, parent_node=wait.parent_node, wait=wait)
            children.append(protected.association.agent_run_id)
        proof = {
            "generation": generation,
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
        with self.loader.locked(ref=ref) as (sql, owned, _):
            # Neither this snapshot nor its client-independent child IDs may
            # survive a changed checkpoint/ordinary pause during preparation.
            if not self._matches(sql, ref, owned, proof):
                return
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return
            if (
                _native_run_id(request) != paused.native_run_id
                or invocation_state(sql, ref, owned.tenant_id).state != "waiting"
            ):
                return
            if not any(PREPARATION in record for record in request.observations):
                request.observations = [*request.observations, {PREPARATION: proof}]

    def _matches(self, sql, ref, owned, proof):
        state = invocation_state(sql, ref, owned.tenant_id)
        run, pause = self._rows(sql, owned, proof["native_run_id"], lock=True)
        continuations = sql.scalars(
            owner_query(NativeContinuation, ref, owned.tenant_id).where(
                NativeContinuation.checkpoint_id == proof["checkpoint"]["checkpoint_id"],
                NativeContinuation.payload_digest == proof["checkpoint"]["payload_digest"],
                NativeContinuation.generation == proof["generation"],
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
            and bool(sources)
            and any(source.generation == state.generation for source in sources)
            and all(
                source.tenant_id == owned.tenant_id
                and source.invocation_id == ref.invocation_id
                and source.state == "completed"
                and source.generation <= state.generation
                for source in sources
            )
            and all(
                operation.tenant_id == owned.tenant_id
                and operation.invocation_id == ref.invocation_id
                and operation.state in {"completed", "failed", "not_dispatched", "denied", "pending"}
                for operation in operations
            )
            and self._objects(sql, ref, owned.tenant_id) == proof["objects"]
            and [list(source) for source in self._sources(sql, ref)] == proof["sources"]
        )

    def retry_children(self, *, ref):
        """Targets for an explicit cancel only; revoked scopes gain no read/run grant.

        Resolve the original encrypted checkpoint and binding again rather than
        trusting a child ID copied into observations. The final SQL proof check
        ends before the caller can issue a cancellation RPC. GET never calls this.
        """
        validate_private_read(self.loader, ref)
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
            if objects != proof["objects"]:
                return ()
        receipts = {value["id"]: ObjectReceipt(**value) for value in objects}
        checkpoint = receipts[proof["checkpoint"]["checkpoint_id"]]
        if checkpoint.kind != "checkpoint" or checkpoint.payload_digest != proof["checkpoint"]["payload_digest"]:
            return ()
        payload = NativeCheckpointPayload.model_validate(self.commands.api.store._read_object(checkpoint))
        if (
            payload.native_run_id != proof["native_run_id"]
            or payload.generation != proof["generation"]
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
                or not self._matches(sql, ref, owned, proof)
            ):
                return ()
        return targets

    def settle(self, *, ref):
        with self.loader.session_factory() as sql:
            owned, scope = self.loader._load(sql, ref=ref, lock=False, settlement=True)
            request = _request(sql, actor=self.commands.actor, ref=ref)
            if request is None:
                return False
            state = invocation_state(sql, ref, owned.tenant_id)
            if not scope.cancelled:
                return False
            saved = state.outcome or {}
            if saved.get("reason_code") == "effect_denied" and saved.get("status") == "stopped":
                return _terminal_proof(sql, request=request, ref=ref) is not None
            proofs = [record[PREPARATION] for record in request.observations if PREPARATION in record]
            if len(proofs) != 1:
                return False
            proof = proofs[0]
            if _native_run_id(request) != proof["native_run_id"]:
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
                or not self._matches(sql, ref, owned, proof)
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
