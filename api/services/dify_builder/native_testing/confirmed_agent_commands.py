"""Authenticated C04 commands composed with the ordinary Workflow resume task.

The existing lifecycle owns decisions, generations and dispatch claims. This
owner publishes only committed outbox rows and restores the ordinary pause; it
never admits another parent or child execution.
"""

import logging
from types import SimpleNamespace
from typing import Literal, cast

from dify_agent.protocol.native_continuation import RedisStreamID
from dify_agent.protocol.native_testing import AgentNativeTestRef, ContinuationClaim, ContinueRunRequest
from flask import current_app
from pydantic import Field, TypeAdapter
from sqlalchemy import select

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectOperation,
    NativeTestInvocation,
)
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.confirmed_agent_continuation import PROFILE, ConfirmedAgentContinuation
from services.dify_builder.native_testing.contracts import ID, CheckpointRef, Counter, FrozenDTO, NativeTestContextRef
from services.dify_builder.native_testing.private_reads import validate_private_read
from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome
from services.dify_builder.native_testing.state_store import invocation_state, owner_query
from services.dify_builder.native_testing.transitions import quarantine_unknown

logger = logging.getLogger(__name__)


def _validate_event_page(*, page, run_id, after):
    previous = tuple(int(part) for part in after.split("-"))
    if page.run_id != run_id:
        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
    for event in page.events:
        event_id = TypeAdapter(RedisStreamID).validate_python(event.id)
        current = tuple(int(part) for part in event_id.split("-"))
        if event.run_id != run_id or current <= previous:
            raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
        previous = current
    if page.next_cursor is not None and page.next_cursor != (page.events[-1].id if page.events else after):
        raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")


def confirmed_parent_outcome(*, ref, native_run_id, native_status, operation_states):
    if native_status not in {"succeeded", "failed", "partial-succeeded", "stopped"}:
        raise BuilderExecutionPolicyError("native_parent_not_terminal")
    unknown = bool({"claimed", "unknown"} & set(operation_states))
    return NativeWorkflowOutcome(
        status="unknown" if unknown else "completed",
        ref=ref,
        native_run_id=native_run_id,
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code="native_effect_unknown" if unknown else None,
        wait_reason=None,
        native_status=None if unknown else native_status,
        output_result_ref=None,
    )


class _ActorHint(FrozenDTO):
    account_id: ID
    tenant_id: ID


class _ResumeDispatch(FrozenDTO):
    ref: NativeTestContextRef
    generation: Counter = Field(ge=1)
    dispatch_id: ID
    actor: _ActorHint


def _publish_resume(*, workflow_run_id: str, dispatch: dict) -> None:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    resume_app_execution.delay({"workflow_run_id": workflow_run_id, "builder_agent_dispatch": dispatch})


class ConfirmedAgentCommands:
    def __init__(self, *, api, continuation, backend, publish):
        self.api, self.continuation, self.backend = api, continuation, backend
        self.actor = api.actor
        self.publish = publish or _publish_resume

    @property
    def loader(self):
        return self.api.loader

    def _request(self, **values):
        request = self.api._request(**values)
        if request.context.get("profile", {}).get("profile_id") != PROFILE:
            raise BuilderExecutionPolicyError("native_profile_unavailable")
        return request

    def _root_ref(self, *, actor, request_id):
        return self.api.lifecycle._root_ref(actor, request_id)

    def prepare_wait(self, **values):
        return self.continuation.prepare_wait(**values)

    def persist_parent_wait(self, **values):
        return self.continuation.persist_parent_wait(**values)

    def settle_parent(self, *, ref):
        """Project the initial ordinary Run's actual terminal SQL fact, without a dispatch."""
        validate_private_read(self.loader, ref)
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
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
            if run is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            state = invocation_state(session, ref, owned.tenant_id)
            if scope.cancelled:
                raise BuilderExecutionPolicyError("native_state_conflict")
            if state.state in {"completed", "unknown"} and state.outcome is not None:
                saved = NativeWorkflowOutcome.model_validate(state.outcome)
                if (
                    saved.ref != ref
                    or saved.native_run_id != native_run_id
                    or (saved.status == "completed" and saved.native_status != run.status)
                ):
                    raise BuilderExecutionPolicyError("native_outcome_mismatch")
                return saved
            if state.generation != 0:
                # The resume worker alone owns its claimed dispatch settlement.
                # Seeing a terminal native row before that commit grants no seal.
                return NativeWorkflowOutcome(
                    status="unknown",
                    ref=ref,
                    native_run_id=native_run_id,
                    checkpoint_ref=None,
                    pending_operation_ids=(),
                    reason_code="native_resume_unsettled",
                    wait_reason=None,
                    native_status=None,
                    output_result_ref=None,
                )
            operations = session.scalars(owner_query(NativeEffectOperation, ref, owned.tenant_id)).all()
            outcome = confirmed_parent_outcome(
                ref=ref,
                native_run_id=native_run_id,
                native_status=run.status,
                operation_states=(operation.state for operation in operations),
            )
            if outcome.status == "unknown":
                quarantine_unknown(session, ref=ref, tenant_id=owned.tenant_id, outcome=outcome.model_dump(mode="json"))
            else:
                state.state, state.outcome = "completed", outcome.model_dump(mode="json")
                invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id))
                if invocation is None:
                    raise BuilderExecutionPolicyError("native_invocation_mismatch")
                invocation.active = False
                request.state = "sealed"
            return outcome

    def load_wait(self, *, ref, parent_node):
        matches = [wait for wait in self.continuation._stored_waits(ref=ref) if wait.parent_node == parent_node]
        if not matches:
            return None
        if len(matches) != 1:
            raise BuilderExecutionPolicyError("native_agent_checkpoint_mismatch")
        return self.api.store.load_agent_association(ref=ref, parent_node=parent_node, wait=matches[0])

    def get(self, *, actor, session_id, request_id):
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        receipt = self.api.get(actor=actor, session_id=session_id, request_id=request_id)
        ref = self._root_ref(actor=actor, request_id=request_id)
        if receipt.status == "terminal" and receipt.outcome in {"succeeded", "failed"}:
            self._complete_builder(ref=ref)
        if receipt.status == "waiting":
            self.continuation.read_parent_pause(ref=ref)
        # A queued outbox is not proof that the ordinary resume worker ran.
        if receipt.status == "running" and receipt.cancellation is None and receipt.native_status == "paused":
            unknown_pause = False
            queued = None
            with self.loader.session_factory() as session:
                owned, _ = self.loader._load(session, ref=ref, lock=False)
                state = invocation_state(session, ref, owned.tenant_id)
                if state.state == "queued":
                    source = session.scalar(
                        owner_query(NativeDispatch, ref, owned.tenant_id).where(
                            NativeDispatch.generation == state.generation,
                            NativeDispatch.state.in_(("queued", "published")),
                        )
                    )
                    if source is None:
                        raise BuilderExecutionPolicyError("native_dispatch_mismatch")
                    queued = (source.generation, source.id)
                unknown_pause = state.state == "running"
            if queued is not None:
                self._publish_one(ref=ref, generation=queued[0], dispatch_id=queued[1])
                return receipt.model_copy(update={"status": "prepared"})
            if unknown_pause:
                # A create/continue ACK can be unresolved while Graphon is
                # safely paused. Only read-only lookup and checkpoint discovery
                # can upgrade it to an actual approval wait.
                try:
                    if self._recover_pending_ack(ref=ref):
                        recovered = self.api.get(actor=actor, session_id=session_id, request_id=request_id)
                        if recovered.status == "running" and recovered.native_status == "paused":
                            return recovered.model_copy(update={"status": "prepared"})
                        return recovered
                except Exception:
                    logger.warning("Confirmed Agent acknowledgement remains unknown")
                return receipt.model_copy(update={"status": "terminal", "outcome": "unknown"})
        return receipt

    def _complete_builder(self, *, ref):
        from services.dify_builder.native_testing.confirmed_agent_completion import reconcile_builder_run

        try:
            reconcile_builder_run(sessions=self.loader.session_factory, actor=self.actor, ref=ref)
        except Exception:
            # Native completion stays true even when the Builder CAS loses or
            # the original worker has not committed its pending card yet.
            # An authenticated status reconnect retries only this projection.
            logger.warning("Confirmed Agent Builder completion remains unprojected")

    def _waiting_event(self, *, run_id):
        from dify_agent.protocol.schemas import RunEventsResponse, RunWaitingEvent

        cursor, selected = "0-0", None
        # Bounded read-only event discovery; never connect to a live SSE wait or
        # rebuild the executable request merely to recover an acknowledgement.
        for _ in range(16):
            page = self.backend.client.get_events_sync(run_id, after=cursor, limit=100)
            page = RunEventsResponse.model_validate(page.model_dump(mode="json"))
            _validate_event_page(page=page, run_id=run_id, after=cursor)
            for event in page.events:
                if isinstance(event, RunWaitingEvent):
                    selected = event
            if not page.events or page.next_cursor is None:
                return selected
            if page.next_cursor == cursor:
                raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
            cursor = page.next_cursor
        raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")

    def _recover_pending_ack(self, *, ref):
        from services.agent.workflow_run_recovery import AgentCreateScope, WorkflowAgentRunRecovery
        from services.dify_builder.native_testing.agent_confirmed_workspace import load_confirmed_agent_parent

        context = self.api.store.load_context(ref=ref)
        paused = self.continuation.read_parent_pause(ref=ref)
        execution_ids = [item.execution_id for item in paused.runtime.graph_execution.node_executions.values()]
        with self.loader.session_factory() as session:
            executions = session.scalars(
                select(WorkflowNodeExecutionModel).where(
                    WorkflowNodeExecutionModel.id.in_(execution_ids),
                    WorkflowNodeExecutionModel.tenant_id == context.tenant_id,
                    WorkflowNodeExecutionModel.app_id == context.app_id,
                    WorkflowNodeExecutionModel.workflow_id == context.workflow_id,
                    WorkflowNodeExecutionModel.workflow_run_id == context.native_run_id,
                    WorkflowNodeExecutionModel.node_type == "agent",
                )
            ).all()
            selections = []
            for execution in executions:
                intents = WorkflowAgentRunRecovery._intents(execution)
                binding = (execution.process_data_dict or {}).get("workflow_agent_binding_id")
                if not intents or not isinstance(binding, str):
                    continue
                selections.append(
                    (
                        AgentCreateScope(
                            tenant_id=context.tenant_id,
                            app_id=context.app_id,
                            workflow_id=context.workflow_id,
                            workflow_run_id=context.native_run_id,
                            node_id=execution.node_id,
                            execution_id=execution.id,
                            workflow_binding_id=binding,
                        ),
                        max(intent.attempt for intent in intents),
                    )
                )
        if not selections:
            return False
        recovery = WorkflowAgentRunRecovery(self.loader.session_factory)
        for scope, attempt in selections:
            response = recovery.recover_existing(
                scope=scope, attempt=attempt, client=self.backend, on_persisted=lambda _: None
            )
            if response is None:
                return False
            parent = load_confirmed_agent_parent(
                service=SimpleNamespace(state_store=self.api.store), ref=ref, execution_id=scope.execution_id
            )
            if parent is None:
                raise BuilderExecutionPolicyError("native_agent_input_unavailable")
            protected = self.api.store.load_agent_association(ref=ref, parent_node=parent)
            if protected.association.agent_run_id != response.run_id:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            if response.status in {"succeeded", "failed", "cancelled"}:
                return len(selections) == 1 and self._recover_terminal_continuation(ref=ref, parent_node=parent)
            if response.status != "waiting":
                return False
            event = self._waiting_event(run_id=response.run_id)
            if event is None or event.id is None:
                return False
            self.prepare_wait(
                ref=ref, parent_node=parent, agent_generation=event.data.generation, backend_wait_event_id=event.id
            )
        waiting = self.continuation.persist_parent_wait(ref=ref, allow_ack_recovery=True)
        if context.generation:
            with self.loader.session_factory() as session:
                dispatch = session.scalar(
                    owner_query(NativeDispatch, ref, context.tenant_id).where(
                        NativeDispatch.generation == context.generation, NativeDispatch.state == "claimed"
                    )
                )
                dispatch_id = dispatch.id if dispatch else None
            if dispatch_id is not None:
                outcome = NativeWorkflowOutcome(
                    status="waiting",
                    ref=ref,
                    native_run_id=context.native_run_id,
                    checkpoint_ref=waiting.checkpoint,
                    pending_operation_ids=waiting.pending_operation_ids,
                    reason_code=None,
                    wait_reason=waiting.wait_reason,
                    native_status=None,
                    output_result_ref=None,
                )
                with self.loader.locked(ref=ref) as (session, owned, scope):
                    self.api.lifecycle.finalize_dispatch_locked(
                        session=session,
                        owned=owned,
                        scope=scope,
                        dispatch_id=dispatch_id,
                        generation=context.generation,
                        outcome=outcome,
                    )
        return True

    def _terminal_recovery_proof(self, *, ref, protected):
        from dify_agent.protocol.schemas import RunStatusResponse

        paused = self.continuation.read_parent_pause(ref=ref)
        if protected.wait is None:
            raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
        run_id = protected.association.agent_run_id
        status = self.backend.client.get_run_sync(run_id)
        status = RunStatusResponse.model_validate(status.model_dump(mode="json"))
        if status.run_id != run_id or status.status not in {"succeeded", "failed", "cancelled"}:
            raise BuilderExecutionPolicyError("native_recovery_unproven")
        if not self._continuation_observed(protected=protected, require_terminal=True):
            raise BuilderExecutionPolicyError("native_recovery_unproven")
        return paused

    def _source_protected(self, *, ref, dispatch_id):
        context = self.api.store.load_context(ref=ref)
        with self.loader.session_factory() as session:
            state = invocation_state(session, ref, context.tenant_id)
            source = session.scalar(
                owner_query(NativeDispatch, ref, context.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            saved = session.scalar(
                owner_query(NativeContinuation, ref, context.tenant_id).where(
                    NativeContinuation.checkpoint_id == state.checkpoint_id
                )
            )
            if (
                source is None
                or saved is None
                or source.checkpoint_id != state.checkpoint_id
                or source.generation != state.generation
            ):
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            checkpoint = CheckpointRef(checkpoint_id=saved.checkpoint_id, payload_digest=saved.payload_digest)
        payload = self.api.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
        if len(payload.agent_associations) != 1:
            raise BuilderExecutionPolicyError("native_recovery_unproven")
        wait = payload.agent_associations[0]
        return self.api.store.load_agent_association(ref=ref, parent_node=wait.parent_node, wait=wait)

    def _recover_terminal_continuation(self, *, ref, parent_node):
        """Reattach a completed approved child using the existing C03 recovery claim."""
        context = self.api.store.load_context(ref=ref)
        if context.generation == 0:
            return False  # No prior approved continuation exists to recover.
        protected = self.load_wait(ref=ref, parent_node=parent_node)
        if protected is None:
            return False
        proof = self._terminal_recovery_proof(ref=ref, protected=protected)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            state = invocation_state(session, ref, owned.tenant_id)
            source = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(
                    NativeDispatch.generation == state.generation, NativeDispatch.state.in_(("claimed", "unknown"))
                )
            )
            operations = session.scalars(owner_query(NativeEffectOperation, ref, owned.tenant_id)).all()
            _, pause = self.continuation._parent_rows(session, ref=ref)
            if (
                scope.cancelled
                or state.state != "running"
                or state.generation != context.generation
                or source is None
                or source.checkpoint_id != state.checkpoint_id
                or any(operation.state not in {"completed", "failed", "not_dispatched"} for operation in operations)
                or (pause.id, pause.state_object_key) != (proof.pause_id, proof.state_object_key)
            ):
                raise BuilderExecutionPolicyError("native_recovery_unproven")
            source.state = "unknown"
            dispatch_id = source.id
        # This owner independently rereads the selected C03 association, actual
        # paused parent and terminal child before restoring that exact source.
        self.api.lifecycle.recover_dispatch(ref=ref, dispatch_id=dispatch_id)
        self._publish_one(ref=ref, generation=context.generation, dispatch_id=dispatch_id)
        return True

    def decide(
        self,
        *,
        actor,
        session_id,
        request_id,
        pending_operation_id,
        decision: Literal["confirm", "deny"],
        scope_digest,
        expected_version,
        idempotency_key,
    ):
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        receipt = self.api.decide(
            actor=actor,
            session_id=session_id,
            request_id=request_id,
            pending_operation_id=pending_operation_id,
            decision=decision,
            scope_digest=scope_digest,
            expected_version=expected_version,
            idempotency_key=idempotency_key,
        )
        if decision == "deny":
            # Denial is terminal control. It cannot become ToolReturn feedback
            # or permit the model to choose an alternate effect.
            return self.cancel(
                actor=actor,
                session_id=session_id,
                request_id=request_id,
                idempotency_key=canonical_digest({"deny": idempotency_key}),
            )
        return receipt

    def resume(self, *, actor, session_id, request_id, expected_generation, idempotency_key):
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        receipt = self.api.lifecycle.resume(
            actor=actor, request_id=request_id, expected_generation=expected_generation, idempotency_key=idempotency_key
        )
        # lifecycle.resume has exited its SQL writer before publishing. A lost
        # broker ACK retains the same row/key for publication and claim recovery.
        self._publish_one(
            ref=self._root_ref(actor=actor, request_id=request_id),
            generation=receipt.generation,
            dispatch_id=receipt.dispatch_id,
        )
        return self.get(actor=actor, session_id=session_id, request_id=request_id)

    def _publish_one(self, *, ref, generation, dispatch_id):
        context = self.api.store.load_context(ref=ref)
        with self.loader.session_factory() as session:
            row = session.scalar(
                owner_query(NativeDispatch, ref, context.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if row is None or row.generation != generation:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            if row.state not in {"queued", "published"}:
                return
        if not context.native_run_id:
            raise BuilderExecutionPolicyError("native_run_mismatch")
        envelope = _ResumeDispatch(
            ref=ref,
            generation=generation,
            dispatch_id=dispatch_id,
            actor=_ActorHint(account_id=self.actor.account_id, tenant_id=self.actor.tenant_id),
        )
        try:
            self.publish(workflow_run_id=context.native_run_id, dispatch=envelope.model_dump(mode="json"))
        except Exception:
            return  # The committed outbox remains queued, never fake running.
        with self.loader.locked(ref=ref) as (session, owned, _):
            row = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if row is None or row.generation != generation:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            if row.state == "queued":
                row.state = "published"

    def publish_pending(self, *, limit=100):
        """A reconnect can reconcile this actor's retained ordinary resume outbox."""
        with self.loader.session_factory() as session:
            rows = session.execute(
                select(NativeDispatch, DifyBuilderExecutionRequest.context_digest)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeDispatch.request_id)
                .where(
                    NativeDispatch.tenant_id == self.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.actor.account_id,
                    DifyBuilderExecutionRequest.context["profile"]["profile_id"].as_string() == PROFILE,
                    NativeDispatch.state.in_(("queued", "published")),
                )
                .limit(limit)
            ).all()
        for dispatch, digest in rows:
            self._publish_one(
                ref=NativeTestContextRef(
                    request_id=dispatch.request_id, invocation_id=dispatch.invocation_id, context_digest=digest
                ),
                generation=dispatch.generation,
                dispatch_id=dispatch.id,
            )

    def claim_resume(self, *, ref, native_run_id, generation, dispatch_id):
        context = self.api.store.load_context(ref=ref)
        if context.native_run_id != native_run_id:
            raise BuilderExecutionPolicyError("native_run_mismatch")
        # An already claimed delivery is read-only even while the first worker
        # has moved WorkflowPause to resumed/running.
        prepared = self.api.lifecycle.prepare_dispatch_claim(ref=ref, generation=generation, dispatch_id=dispatch_id)
        if prepared is None:
            return False
        self.continuation.read_parent_pause(ref=ref)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            self.continuation._parent_rows(session, ref=ref)
            return self.api.lifecycle.consume_dispatch_claim(
                session=session, owned=owned, scope=scope, prepared=prepared
            )

    def preflight_resume(self, *, ref, native_run_id, generation, dispatch_id):
        """Scope the ordinary task before its legacy WorkflowPause storage lookup."""
        prepared = self.api.lifecycle.prepare_dispatch_claim(ref=ref, generation=generation, dispatch_id=dispatch_id)
        if prepared is None:
            return False
        if prepared.context.native_run_id != native_run_id:
            raise BuilderExecutionPolicyError("native_run_mismatch")
        with self.loader.session_factory() as session:
            self.continuation._parent_rows(session, ref=ref)
        return True

    def continue_wait(self, *, ref, parent_node):
        context = self.api.store.load_context(ref=ref)
        with self.loader.session_factory() as session:
            row = session.scalar(
                owner_query(NativeDispatch, ref, context.tenant_id).where(
                    NativeDispatch.generation == context.generation, NativeDispatch.state == "claimed"
                )
            )
            if row is None:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            dispatch_id = row.id
        checkpoint = self.api.lifecycle.claimed_resume_checkpoint(
            ref=ref, generation=context.generation, dispatch_id=dispatch_id
        )
        payload = self.api.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
        waits = [wait for wait in payload.agent_associations if wait.parent_node == parent_node]
        if len(waits) != 1:
            raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
        wait = waits[0]
        protected = self.api.store.load_agent_association(ref=ref, parent_node=parent_node, wait=wait)
        if self._continuation_observed(protected=protected):
            return protected
        key = canonical_digest(
            {
                "run": protected.association.agent_run_id,
                "generation": wait.agent_generation,
                "checkpoint": wait.checkpoint_digest,
            }
        )
        request = ContinueRunRequest(
            ref=AgentNativeTestRef.model_validate(ref.model_dump(mode="json")),
            expected_generation=wait.agent_generation,
            idempotency_key=key,
        )
        try:
            claim = self.backend.client.continue_run_sync(
                protected.association.agent_run_id, request, profile="confirmed"
            )
            claim = ContinuationClaim.model_validate(claim.model_dump(mode="json"))
            if (claim.run_id, claim.idempotency_key, claim.generation) != (
                protected.association.agent_run_id,
                key,
                wait.agent_generation + 1,
            ):
                raise ValueError("claim")
        except Exception:
            raise BuilderExecutionPolicyError("native_agent_continuation_unknown") from None
        return protected

    def _continuation_observed(self, *, protected, require_terminal=False):
        from dify_agent.protocol.schemas import (
            RunCancelledEvent,
            RunEventsResponse,
            RunFailedEvent,
            RunResumedEvent,
            RunStatusResponse,
            RunSucceededEvent,
        )

        wait = protected.wait
        if wait is None:
            raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
        run_id = protected.association.agent_run_id
        try:
            status = self.backend.client.get_run_sync(run_id)
            status = RunStatusResponse.model_validate(status.model_dump(mode="json"))
            if status.run_id != run_id:
                raise ValueError("owner")
            cursor, resumed, terminal = wait.backend_wait_event_id, False, None
            for _ in range(16):
                page = self.backend.client.get_events_sync(run_id, after=cursor, limit=100)
                page = RunEventsResponse.model_validate(page.model_dump(mode="json"))
                _validate_event_page(page=page, run_id=run_id, after=cursor)
                for event in page.events:
                    if isinstance(event, RunResumedEvent):
                        if event.data.generation != wait.agent_generation + 1:
                            raise ValueError("generation")
                        resumed = True
                    if isinstance(event, (RunSucceededEvent, RunFailedEvent, RunCancelledEvent)):
                        terminal = {
                            RunSucceededEvent: "succeeded",
                            RunFailedEvent: "failed",
                            RunCancelledEvent: "cancelled",
                        }[type(event)]
                if not page.events or page.next_cursor is None:
                    if require_terminal:
                        if terminal is not None and terminal == status.status:
                            return True
                        raise ValueError("terminal event unavailable")
                    if resumed or terminal is not None and terminal == status.status:
                        return True
                    if status.status == "waiting":
                        return False
                    raise ValueError("unverified continuation")
                if page.next_cursor == cursor:
                    raise ValueError("cursor")
                cursor = page.next_cursor
            raise ValueError("bounded read")
        except Exception:
            raise BuilderExecutionPolicyError("native_agent_continuation_unknown") from None

    def cancel(self, *, actor, session_id, request_id, idempotency_key):
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        ref = self._root_ref(actor=actor, request_id=request_id)
        children = []
        try:
            for wait in self.continuation._stored_waits(ref=ref):
                protected = self.api.store.load_agent_association(ref=ref, parent_node=wait.parent_node, wait=wait)
                children.append(protected.association.agent_run_id)
        except BuilderExecutionPolicyError:
            pass  # Revocation still commits when checkpoint/cleanup is unknown.
        self.api.lifecycle.cancel(actor=actor, request_id=request_id, idempotency_key=idempotency_key)
        for child in children:
            try:
                self.backend.cancel_run(child)
            except Exception:
                # A cancellation request is never proof of physical cleanup.
                logger.warning("Confirmed Agent cancellation acknowledgement unavailable")
        return self.get(actor=actor, session_id=session_id, request_id=request_id)

    def finish_resume(self, *, ref, generation, dispatch_id):
        context = self.api.store.load_context(ref=ref)
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
            status = run.status if run else None
        values = {
            "ref": ref,
            "native_run_id": context.native_run_id,
            "checkpoint_ref": None,
            "pending_operation_ids": (),
            "reason_code": None,
            "wait_reason": None,
            "native_status": None,
            "output_result_ref": None,
        }
        if status == "paused":
            paused = self.continuation.read_parent_pause(ref=ref)
            reasons = {getattr(reason, "message", None) for reason in paused.runtime.graph_execution.pause_reasons}
            if reasons & {
                "agent_create_ack_unknown",
                "native_agent_continuation_unknown",
                "native_agent_wait_unverified",
                "agent_stream_ack_unknown",
            }:
                # Preserve the claim for read-only ACK recovery. An old pending
                # checkpoint cannot acknowledge this newer unknown pause.
                try:
                    self._recover_pending_ack(ref=ref)
                except Exception:
                    logger.warning("Confirmed Agent continuation acknowledgement remains unknown")
                return
            waiting = self.continuation.persist_parent_wait(ref=ref)
            outcome = NativeWorkflowOutcome(
                status="waiting",
                **{
                    **values,
                    "checkpoint_ref": waiting.checkpoint,
                    "pending_operation_ids": waiting.pending_operation_ids,
                    "wait_reason": waiting.wait_reason,
                },
            )
        elif status in {"succeeded", "failed", "partial-succeeded", "stopped"}:
            native_status = cast(Literal["succeeded", "failed", "partial-succeeded", "stopped"], status)
            outcome = NativeWorkflowOutcome(status="completed", **{**values, "native_status": native_status})
        else:
            outcome = NativeWorkflowOutcome(status="unknown", **{**values, "reason_code": "native_resume_unknown"})
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
            if outcome.status == "completed":
                # Recheck effect facts under the same request lock as sealing;
                # an unacknowledged native effect cannot become success/failure.
                operations = session.scalars(owner_query(NativeEffectOperation, ref, owned.tenant_id)).all()
                outcome = confirmed_parent_outcome(
                    ref=ref,
                    native_run_id=context.native_run_id,
                    native_status=status,
                    operation_states=(operation.state for operation in operations),
                )
            self.api.lifecycle.finalize_dispatch_locked(
                session=session,
                owned=owned,
                scope=scope,
                dispatch_id=dispatch_id,
                generation=generation,
                outcome=outcome,
            )
        if outcome.status == "completed":
            self._complete_builder(ref=ref)

    def snapshots(self, *, actor, session_id):
        self.api._actor(actor)
        self.publish_pending()
        with self.loader.session_factory() as session:
            identities = session.scalars(
                select(DifyBuilderExecutionRequest.id)
                .where(
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    DifyBuilderExecutionRequest.session_id == session_id,
                    DifyBuilderExecutionRequest.context["profile"]["profile_id"].as_string() == PROFILE,
                )
                .order_by(DifyBuilderExecutionRequest.created_at.desc())
                .limit(100)
            ).all()
        return tuple(self.get(actor=actor, session_id=session_id, request_id=identity) for identity in identities)


class _ConfirmedParentRecovery:
    """Existing lifecycle's proof port, restricted to a terminal confirmed child."""

    def __init__(self, commands):
        self.commands = commands

    def recovery_evidence(self, *, context, dispatch_id):
        try:
            protected = self.commands._source_protected(ref=context.ref, dispatch_id=dispatch_id)
            self.commands._terminal_recovery_proof(ref=context.ref, protected=protected)
            with self.commands.loader.session_factory() as session:
                operations = session.scalars(owner_query(NativeEffectOperation, context.ref, context.tenant_id)).all()
                if any(operation.state not in {"completed", "failed", "not_dispatched"} for operation in operations):
                    return "unknown"
            return "stopped"
        except Exception:
            return "unknown"

    def cancel(self, *, refs):
        return ()  # Commands cancels the actual children; this supplies no cleanup ACK.

    def run_initial(self, *, context):
        raise BuilderExecutionPolicyError("unsupported_execution_transport")

    def resume(self, *, context, checkpoint, resolutions):
        raise BuilderExecutionPolicyError("unsupported_execution_transport")


def build_confirmed_agent_commands(*, sessions, actor, operations, backend, publish=None):
    api = NativeTestApiService(
        session_factory=sessions,
        actor=actor,
        resolver=operations.loader.resolver,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=operations,
    )
    continuation = ConfirmedAgentContinuation(
        loader=api.loader, store=api.store, operations=operations, backend=backend, lifecycle=api.lifecycle
    )
    commands = ConfirmedAgentCommands(api=api, continuation=continuation, backend=backend, publish=publish)
    api.lifecycle.runtime = _ConfirmedParentRecovery(commands)
    return commands


def _dispatch_owner(payload, *, generate_entity=None):
    try:
        dispatch = _ResumeDispatch.model_validate(payload.get("builder_agent_dispatch"))
        if generate_entity is not None:
            context = generate_entity.builder_agent_execution
            if context is None or (dispatch.ref, payload.get("workflow_run_id")) != (
                context.ref,
                context.native_run_id,
            ):
                raise ValueError("owner")
        factory = current_app.extensions.get("confirmed_agent_command_factory")
        if factory is None:
            from services.dify_builder.wiring import build_confirmed_agent_command_service

            factory = build_confirmed_agent_command_service
        actor = Actor(account_id=dispatch.actor.account_id, tenant_id=dispatch.actor.tenant_id)
        commands = factory(actor=actor)
        if commands is None or commands.actor != actor:
            raise ValueError("actor")
        return commands, dispatch
    except BuilderExecutionPolicyError:
        raise
    except Exception:
        raise BuilderExecutionPolicyError("native_dispatch_mismatch") from None


def guard_confirmed_agent_resume(*, payload, generate_entity) -> bool:
    payload.pop("_builder_agent_claimed", None)
    if getattr(generate_entity, "builder_agent_execution", None) is None:
        if payload.get("builder_agent_dispatch") is not None:
            raise BuilderExecutionPolicyError("native_dispatch_mismatch")
        return True
    commands, dispatch = _dispatch_owner(payload, generate_entity=generate_entity)
    claimed = commands.claim_resume(
        ref=dispatch.ref,
        native_run_id=payload["workflow_run_id"],
        generation=dispatch.generation,
        dispatch_id=dispatch.dispatch_id,
    )
    if claimed:
        payload["_builder_agent_claimed"] = True
    return claimed


def preflight_confirmed_agent_resume(*, payload) -> bool:
    if payload.get("builder_agent_dispatch") is None:
        return True
    commands, dispatch = _dispatch_owner(payload)
    return commands.preflight_resume(
        ref=dispatch.ref,
        native_run_id=payload.get("workflow_run_id"),
        generation=dispatch.generation,
        dispatch_id=dispatch.dispatch_id,
    )


def finish_confirmed_agent_resume(*, payload) -> None:
    if not payload.pop("_builder_agent_claimed", False):
        return
    commands, dispatch = _dispatch_owner(payload)
    try:
        commands.finish_resume(ref=dispatch.ref, generation=dispatch.generation, dispatch_id=dispatch.dispatch_id)
    except Exception:
        commands.api.lifecycle._mark_unknown(ref=dispatch.ref, dispatch_id=dispatch.dispatch_id)
        raise


class ProfiledNativeTestCommands:
    """Select only from the authenticated stored request's server-owned profile."""

    def __init__(self, *, sessions, actor, confirmed_factory, legacy_factory):
        self.sessions, self.actor = sessions, actor
        self.confirmed_factory, self.legacy_factory = confirmed_factory, legacy_factory

    def _service(self, *, actor, session_id, request_id):
        if actor != self.actor:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        with self.sessions() as session:
            request = session.scalar(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.id == request_id,
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    DifyBuilderExecutionRequest.session_id == session_id,
                )
            )
            if request is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            confirmed = request.context.get("profile", {}).get("profile_id") == PROFILE
        # Each concrete C04 service repeats current owner/RBAC/context validation;
        # the profile read confers no authority by itself.
        return self.confirmed_factory() if confirmed else self.legacy_factory()

    def start(self, **values):
        return self.legacy_factory().start(**values)

    def get(self, **values):
        return self._service(**values).get(**values)

    def decide(self, **values):
        return self._service(**{name: values[name] for name in ("actor", "session_id", "request_id")}).decide(**values)

    def resume(self, **values):
        return self._service(**{name: values[name] for name in ("actor", "session_id", "request_id")}).resume(**values)

    def cancel(self, **values):
        return self._service(**{name: values[name] for name in ("actor", "session_id", "request_id")}).cancel(**values)

    def snapshots(self, *, actor, session_id):
        if actor != self.actor:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        with self.sessions() as session:
            identities = session.scalars(
                select(DifyBuilderExecutionRequest.id)
                .where(
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    DifyBuilderExecutionRequest.session_id == session_id,
                    DifyBuilderExecutionRequest.context["policy_version"].as_string() == "builder-native-test-v1",
                )
                .order_by(DifyBuilderExecutionRequest.created_at.desc())
                .limit(100)
            ).all()
        return tuple(self.get(actor=actor, session_id=session_id, request_id=identity) for identity in identities)
