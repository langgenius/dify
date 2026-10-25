"""Authenticated C04 commands composed with the ordinary Workflow resume task.

The existing lifecycle owns decisions, generations and dispatch claims. This
owner publishes only committed outbox rows and restores the ordinary pause; it
never admits another parent or child execution.
"""

import logging
from collections.abc import Callable
from datetime import UTC
from typing import Literal, cast

from celery.exceptions import SoftTimeLimitExceeded
from dify_agent.protocol.execution_binding import KeepAliveExecutionBindingRequest, KeepAliveExecutionBindingResponse
from dify_agent.protocol.native_continuation import RedisStreamID
from dify_agent.protocol.native_testing import AgentNativeTestRef, ContinuationClaim, ContinueRunRequest
from dify_agent.protocol.schemas import RunStatusResponse
from flask import current_app
from pydantic import Field, TypeAdapter
from sqlalchemy import select

from core.dify_builder.models import Actor
from graphon.entities.pause_reason import SchedulingPause
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import ID, CheckpointRef, Counter, FrozenDTO, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.confirmed_agent_continuation import PROFILE, ConfirmedAgentContinuation
from services.dify_builder.native_testing.private_reads import validate_private_read
from services.dify_builder.native_testing.repository import utc_now
from services.dify_builder.native_testing.state_store import (
    NativeExecutionStateStore,
    ObjectReceipt,
    invocation_state,
    owner_query,
)
from services.dify_builder.native_testing.transitions import quarantine_unknown, validate_pending_history

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

    def _waiting_binding_checkpoint(self, *, session, ref, request):
        """Current approval wait only; completed historical effects remain valid."""
        owned, scope = self.loader._load(session, ref=ref, lock=False)
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

    def keep_alive_waiting_binding(self, *, actor, session_id, request_id) -> bool:
        """Health-only retention; never renew authority, recover, or replace a binding.

        SQL closes before storage/SDK I/O. The independent absolute backend
        lifetime is unchanged. Uncertain or missing resources stop this pass.
        """
        try:
            request = self._request(actor=actor, session_id=session_id, request_id=request_id)
            ref = self._root_ref(actor=actor, request_id=request_id)
            with self.loader.session_factory() as session:
                checkpoint, generation = self._waiting_binding_checkpoint(session=session, ref=ref, request=request)
            paused = self.continuation.read_parent_pause(ref=ref)
            reasons = {
                reason.message if isinstance(reason, SchedulingPause) else None
                for reason in paused.runtime.graph_execution.pause_reasons
            }
            if reasons != {"agent_tool_approval"}:
                return False
            payload = self.api.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
            if payload.generation != generation or not 0 < len(payload.agent_associations) <= 100:
                return False
            retained = False
            executions = {node.execution_id for node in paused.runtime.graph_execution.node_executions.values()}
            for wait in payload.agent_associations:
                parent = wait.parent_node
                if parent.execution_id not in executions:
                    return False
                protected = self.api.store.load_agent_association(ref=ref, parent_node=parent, wait=wait)
                if protected.terminal_result_ref is not None:
                    continue
                prepared = self.api.store._agent_prepare(
                    ref=ref, parent_node=parent, writing=False, expected_generation=generation
                )
                if prepared.workspace != protected.association.workspace:
                    return False
                status = RunStatusResponse.model_validate(
                    self.backend.client.get_run_sync(protected.association.agent_run_id).model_dump(mode="json")
                )
                if status.run_id != protected.association.agent_run_id or status.status != "waiting":
                    return False
                selected = self.continuation._selected(
                    ref=ref,
                    association=protected.association,
                    generation=wait.agent_generation,
                    event_id=wait.backend_wait_event_id,
                )
                if canonical_digest(selected.checkpoint.model_dump(mode="json")) != wait.checkpoint_digest:
                    return False
                self.api.store._agent_refresh_access(prepared)
                with self.loader.session_factory() as session:
                    current = self._waiting_binding_checkpoint(session=session, ref=ref, request=request)
                    if current != (checkpoint, generation):
                        return False
                    owned, scope = self.loader._load(session, ref=ref, lock=False)
                    self.api.store._agent_recheck(session, owned, scope, prepared, writing=False)
                    run, pause = self.continuation._parent_rows(session, ref=ref)
                    if (run.id, pause.id, pause.state_object_key) != (
                        paused.native_run_id,
                        paused.pause_id,
                        paused.state_object_key,
                    ):
                        return False
                response = self.backend.client.keep_alive_execution_binding_sync(
                    KeepAliveExecutionBindingRequest(binding_ref=prepared.workspace.backend_binding_ref)
                )
                retained = (
                    KeepAliveExecutionBindingResponse.model_validate(response.model_dump(mode="json")).supported
                    or retained
                )
            return retained
        except SoftTimeLimitExceeded:
            raise
        except BuilderExecutionPolicyError:
            return False
        except Exception:
            logger.warning("Dify Builder waiting binding retention unavailable (request=%s)", request_id)
            return False

    def peek(self, *, actor, session_id, request_id):
        """Read public facts without enqueue, ACK recovery, or settlement.

        Physical cleanup alone does not prove that a paused parent logically
        stopped. Keep that outcome unresolved until its durable stop is saved.
        """
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        receipt = self.api.get(actor=actor, session_id=session_id, request_id=request_id)
        if receipt.cancellation is not None and receipt.cancellation.status != "unknown":
            from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation

            ref = self._root_ref(actor=actor, request_id=request_id)
            if ConfirmedAgentCancellation(self).stop_is_saved(ref=ref):
                return receipt.model_copy(
                    update={
                        "status": "terminal",
                        "outcome": "cancelled",
                        "native_status": "stopped",
                        "can_resume": False,
                        "wait_reason": None,
                        "pending": (),
                        # Public request cancellation is logical; C02 retains its
                        # independent, conservative physical cleanup facts.
                        "cancellation": receipt.cancellation.model_copy(update={"status": "cancelled"}),
                    }
                )
        if (
            receipt.cancellation is not None
            and receipt.cancellation.status == "cancelled"
            and receipt.native_status == "paused"
        ):
            return receipt.model_copy(update={"status": "running", "outcome": None})
        return receipt

    def get(self, *, actor, session_id, request_id):
        self._request(actor=actor, session_id=session_id, request_id=request_id)
        receipt = self.api.get(actor=actor, session_id=session_id, request_id=request_id)
        ref = self._root_ref(actor=actor, request_id=request_id)
        if receipt.cancellation is not None:
            from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation

            try:
                validate_private_read(self.loader, ref)
                if ConfirmedAgentCancellation(self).settle(ref=ref):
                    self._complete_builder(ref=ref)
                    return receipt.model_copy(
                        update={
                            "status": "terminal",
                            "outcome": "cancelled",
                            "native_status": "stopped",
                            "wait_reason": None,
                            "pending": (),
                        }
                    )
            except Exception:
                logger.warning("Confirmed Agent logical cancellation remains unproven")
            if receipt.cancellation.status == "cancelled" and receipt.native_status == "paused":
                # A physical cleanup receipt cannot close the ordinary pause.
                # Confirmed callers need the separately saved logical stop.
                return receipt.model_copy(update={"status": "running", "outcome": None})
        if (
            receipt.cancellation is None
            and receipt.native_status == "failed"
            and receipt.outcome not in {"succeeded", "failed"}
        ):
            try:
                if self._settle_unconsumed_failure(ref=ref):
                    receipt = self.api.get(actor=actor, session_id=session_id, request_id=request_id)
            except Exception:
                logger.warning("Confirmed Agent failed effect settlement remains unproven")
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
                # A normal callback can commit its next wait while the bounded
                # ACK recovery read is in flight. Never hide that newer fact.
                fresh = self.api.get(actor=actor, session_id=session_id, request_id=request_id)
                if fresh.status == "waiting":
                    self.continuation.read_parent_pause(ref=ref)
                    return fresh
                if fresh.status != "running" or fresh.native_status != "paused":
                    return fresh
                with self.loader.session_factory() as session:
                    owned, _ = self.loader._load(session, ref=ref, lock=False)
                    state = invocation_state(session, ref, owned.tenant_id)
                    active_resume = session.scalar(
                        owner_query(NativeDispatch, ref, owned.tenant_id).where(
                            NativeDispatch.generation == state.generation,
                            NativeDispatch.state == "claimed",
                            NativeDispatch.claim_expires_at > utc_now(),
                        )
                    )
                    if (
                        state.state == "running"
                        and state.generation == fresh.generation == receipt.generation
                        and active_resume is not None
                    ):
                        return fresh.model_copy(update={"status": "prepared"})
                return fresh.model_copy(update={"status": "terminal", "outcome": "unknown"})
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
            parent = load_confirmed_agent_parent(state_store=self.api.store, ref=ref, execution_id=scope.execution_id)
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

    def _publish_one(self, *, ref, generation, dispatch_id) -> bool:
        context = self.api.store.load_context(ref=ref)
        with self.loader.session_factory() as session:
            row = session.scalar(
                owner_query(NativeDispatch, ref, context.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if row is None or row.generation != generation:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            if row.state not in {"queued", "published"}:
                return False
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
            return False  # The committed outbox remains queued, never fake running.
        with self.loader.locked(ref=ref) as (session, owned, _):
            row = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if row is None or row.generation != generation:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            if row.state == "queued":
                row.state = "published"
        return True

    def publish_pending(self, *, limit: int = 100, request_id: str | None = None) -> int:
        """A reconnect can reconcile this actor's retained ordinary resume outbox."""
        with self.loader.session_factory() as session:
            query = (
                select(NativeDispatch, DifyBuilderExecutionRequest.context_digest)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeDispatch.request_id)
                .where(
                    NativeDispatch.tenant_id == self.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.actor.account_id,
                    DifyBuilderExecutionRequest.context["profile"]["profile_id"].as_string() == PROFILE,
                    NativeDispatch.state.in_(("queued", "published")),
                )
            )
            if request_id is not None:
                query = query.where(NativeDispatch.request_id == request_id)
            rows = session.execute(query.order_by(NativeDispatch.id).limit(limit)).all()
        published = 0
        for dispatch, digest in rows:
            if self._publish_one(
                ref=NativeTestContextRef(
                    request_id=dispatch.request_id, invocation_id=dispatch.invocation_id, context_digest=digest
                ),
                generation=dispatch.generation,
                dispatch_id=dispatch.id,
            ):
                published += 1
        return published

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

    def _continuation_observed(self, *, protected, require_terminal=False, failed_resume=False):
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
            if status.run_id != run_id or failed_resume and status.status != "failed":
                raise ValueError("owner")
            cursor, resumed, terminal = wait.backend_wait_event_id, False, None
            for _ in range(16):
                page = self.backend.client.get_events_sync(run_id, after=cursor, limit=100)
                page = RunEventsResponse.model_validate(page.model_dump(mode="json"))
                _validate_event_page(page=page, run_id=run_id, after=cursor)
                for event in page.events:
                    if isinstance(event, RunResumedEvent):
                        if failed_resume and terminal is not None:
                            raise ValueError("resumed after terminal")
                        if event.data.generation != wait.agent_generation + 1:
                            raise ValueError("generation")
                        resumed = True
                    if isinstance(event, (RunSucceededEvent, RunFailedEvent, RunCancelledEvent)):
                        if failed_resume and not resumed:
                            raise ValueError("terminal before expected resume")
                        terminal = {
                            RunSucceededEvent: "succeeded",
                            RunFailedEvent: "failed",
                            RunCancelledEvent: "cancelled",
                        }[type(event)]
                if not page.events or page.next_cursor is None:
                    if require_terminal:
                        if terminal is not None and terminal == status.status and (not failed_resume or resumed):
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
        from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation

        self._request(actor=actor, session_id=session_id, request_id=request_id)
        ref = self._root_ref(actor=actor, request_id=request_id)
        children = []
        try:
            for wait in self.continuation._stored_waits(ref=ref):
                protected = self.api.store.read_agent_association_for_cancellation(
                    ref=ref, parent_node=wait.parent_node, wait=wait
                )
                children.append(protected.association.agent_run_id)
        except Exception:
            # Revocation still commits when checkpoint/cleanup is unknown.
            logger.warning("Confirmed Agent cancellation child discovery unavailable")
        try:
            ConfirmedAgentCancellation(self).prepare(ref=ref)
        except Exception:
            logger.warning("Confirmed Agent cancellation preparation unavailable")
        self.api.lifecycle.cancel(actor=actor, request_id=request_id, idempotency_key=idempotency_key)
        if not children:
            try:
                children = list(ConfirmedAgentCancellation(self).retry_children(ref=ref))
            except Exception:
                logger.warning("Confirmed Agent cancellation retry remains unproven")
        for child in children:
            try:
                self.backend.cancel_run(child)
            except Exception:
                # A cancellation request is never proof of physical cleanup.
                logger.warning("Confirmed Agent cancellation acknowledgement unavailable")
        return self.get(actor=actor, session_id=session_id, request_id=request_id)

    def _failed_resume_source(self, session, *, ref, generation=None, dispatch_id=None):
        """SQL facts only. This lane supports one terminal Agent producer, never a subtree."""
        from services.dify_builder.native_testing.confirmed_agent_cancellation import ConfirmedAgentCancellation
        from services.dify_builder.native_testing.confirmed_agent_completion import _native_run_id, _request

        request = _request(session, actor=self.actor, ref=ref)
        if request is None or request.state not in {"running", "waiting"}:
            return None
        # Optional receipt recovery must not add backend-history dependencies
        # to ordinary known terminal C03 settlement.
        candidate = session.scalar(
            owner_query(NativeEffectOperation, ref, request.tenant_id)
            .where(NativeEffectOperation.state == "claimed", NativeEffectOperation.result_ref.is_(None))
            .limit(1)
        )
        if (
            candidate is None
            or session.scalar(
                select(NativeEffectDispatchClaim.id).where(NativeEffectDispatchClaim.operation_id == candidate.id)
            )
            is not None
        ):
            return None
        proof_owner = ConfirmedAgentCancellation(self)
        native_id = _native_run_id(request)
        native, _ = proof_owner._rows(session, request, native_id, lock=False)
        if native is None or native.status != "failed":
            return None
        states = session.scalars(
            select(NativeInvocationState).where(NativeInvocationState.request_id == ref.request_id)
        ).all()
        invocations = session.scalars(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        ).all()
        if len(states) != 1 or len(invocations) != 1:
            return None
        state, invocation = states[0], invocations[0]
        scope = session.get(NativeTestScope, ref.request_id)
        if (
            scope is None
            or scope.cancelled
            or scope.tenant_id != request.tenant_id
            or state.tenant_id != request.tenant_id
            or invocation.tenant_id != request.tenant_id
            or state.invocation_id != ref.invocation_id
            or invocation.invocation_id != ref.invocation_id
            or state.parent_invocation_id is not None
            or (state.app_id, state.workflow_id) != (request.app_id, request.workflow_id)
            or state.state not in {"running", "unknown"}
            or state.wait_reason is not None
            or state.generation <= 0
            or state.generation != scope.generation
            or generation is not None
            and state.generation != generation
        ):
            return None
        sources = proof_owner._sources(session, ref)
        selected = [source for source in sources if source[3] == state.generation]
        if len(selected) != 1:
            return None
        source = selected[0]
        if (
            source[1:3] != (request.tenant_id, ref.invocation_id)
            or source[4] not in {"claimed", "unknown"}
            or source[5] != state.checkpoint_id
            or dispatch_id is not None
            and source[0] != dispatch_id
            or any(
                row[1:3] != source[1:3] or row[3] >= state.generation or row[4] != "completed"
                for row in sources
                if row != source
            )
        ):
            return None
        validate_pending_history(
            session, ref=ref, tenant_id=request.tenant_id, state=state, dispatch_states=("claimed", "unknown")
        )
        continuation = session.scalar(
            owner_query(NativeContinuation, ref, request.tenant_id).where(
                NativeContinuation.checkpoint_id == state.checkpoint_id
            )
        )
        checkpoint = session.scalar(
            owner_query(NativePayloadObject, ref, request.tenant_id).where(
                NativePayloadObject.id == state.checkpoint_id, NativePayloadObject.kind == "checkpoint"
            )
        )
        if (
            continuation is None
            or checkpoint is None
            or continuation.generation != state.generation - 1
            or (continuation.payload_ref, continuation.payload_digest)
            != (checkpoint.storage_key, checkpoint.payload_digest)
        ):
            return None
        return (
            native_id,
            state.generation,
            source[0],
            state.checkpoint_id,
            continuation.payload_digest,
            proof_owner._objects(session, ref, request.tenant_id),
            sources,
            canonical_digest(invocation.bindings),
            state.context_object_id,
            tuple(state.pending_ids),
        )

    def _settle_unconsumed_failure(self, *, ref, generation=None, dispatch_id=None):
        """Observe a failed exact child, then fence an unused shell permit under C02's root lock.

        Receipt reads work for an inactive quarantine, without broadening active
        execution readers. No queue publication, permit refund or recovery occurs.
        Any physical claim, recorded outcome or result leaves uncertainty intact.
        """
        from runtime_contracts.builder.native.agent_contracts import AgentNodeAssociation, AgentProtectedState
        from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload

        validate_private_read(self.loader, ref)
        with self.loader.session_factory() as session:
            proof = self._failed_resume_source(session, ref=ref, generation=generation, dispatch_id=dispatch_id)
        if proof is None:
            return False
        native_id, selected_generation, source_id, checkpoint_id, checkpoint_digest, objects, *_ = proof
        receipts = {value["id"]: ObjectReceipt(**value) for value in objects}
        checkpoint = receipts.get(checkpoint_id)
        if checkpoint is None or checkpoint.kind != "checkpoint" or checkpoint.payload_digest != checkpoint_digest:
            return False
        payload = NativeCheckpointPayload.model_validate(self.api.store._read_object(checkpoint))
        if (
            payload.native_run_id != native_id
            or payload.generation != selected_generation - 1
            or len(payload.agent_associations) != 1
            or payload.child_refs
        ):
            return False
        wait = payload.agent_associations[0]
        receipt = receipts.get(wait.association_object_ref)
        if (
            wait.parent_node.ref != ref
            or receipt is None
            or receipt.kind != "result"
            or receipt.logical_key != NativeExecutionStateStore._agent_key("agent-bind", wait.parent_node)
        ):
            return False
        association = AgentNodeAssociation.model_validate(self.api.store._read_object(receipt))
        if association.parent_node != wait.parent_node or association.workflow_native_run_id != native_id:
            return False
        protected = AgentProtectedState(
            association_object_ref=receipt.id,
            association=association,
            wait=wait,
            checkpoint=None,
            terminal_result_ref=None,
            terminal_result=None,
        )
        if not self._continuation_observed(protected=protected, require_terminal=True, failed_resume=True):
            return False
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
            if (
                self._failed_resume_source(session, ref=ref, generation=selected_generation, dispatch_id=source_id)
                != proof
            ):
                return False
            nodes = session.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.workflow_run_id == native_id)
            ).all()
            parent = wait.parent_node
            if not any(
                node.id == parent.execution_id
                and node.status == "failed"
                and node.tenant_id == owned.tenant_id
                and node.app_id == owned.app_id
                and node.workflow_id == owned.workflow_id
                for node in nodes
            ) or any(node.status not in {"failed", "succeeded", "skipped"} for node in nodes):
                return False
            operations = session.scalars(
                select(NativeEffectOperation).where(NativeEffectOperation.request_id == ref.request_id)
            ).all()
            candidates = [
                operation
                for operation in operations
                if operation.state not in {"completed", "failed", "not_dispatched"}
            ]
            if len(candidates) != 1 or any(
                (operation.tenant_id, operation.invocation_id) != (owned.tenant_id, ref.invocation_id)
                for operation in operations
            ):
                return False
            operation = candidates[0]
            pending = validate_pending_history(
                session,
                ref=ref,
                tenant_id=owned.tenant_id,
                state=invocation_state(session, ref, owned.tenant_id),
                dispatch_states=("claimed", "unknown"),
            )
            if len(pending) != 1 or pending[0].category != "approval" or pending[0].operation_id != operation.id:
                return False
            if operation.state != "claimed" or operation.result_ref is not None:
                return False
            attempts = session.scalars(
                owner_query(NativeEffectAttempt, ref, owned.tenant_id).where(
                    NativeEffectAttempt.operation_id == operation.id
                )
            ).all()
            if len(attempts) != 1 or attempts[0].execution_id != parent.execution_id:
                return False
            attempt = attempts[0]
            if (
                session.scalar(
                    select(NativeEffectDispatchClaim.id).where(NativeEffectDispatchClaim.operation_id == operation.id)
                )
                is not None
                or session.scalar(
                    select(NativeEffectOutcome.id).where(NativeEffectOutcome.operation_id == operation.id)
                )
                is not None
            ):
                return False
            if any(value["logical_key"] == operation.operation_digest for value in objects):
                return False
            # SQL binding proves this is the existing shell owner whose I/O
            # cannot precede a committed NativeEffectDispatchClaim.
            descriptor = owned.bindings.get("_agent_operations_v1", {}).get(operation.operation_digest, {})
            binding = owned.bindings.get(operation.operation_digest, {})
            if (
                descriptor.get("parent_node") != parent.model_dump(mode="json")
                or descriptor.get("workflow_native_run_id") != native_id
                or descriptor.get("shell_boundary")
                not in {
                    "bootstrap",
                    "config_pull",
                    "shell_run",
                    "shell_wait",
                    "shell_input",
                    "shell_interrupt",
                    "file_upload",
                }
                or binding.get("kind") not in {"shell", "bootstrap"}
                or binding.get("invocation_digest") != attempt.invocation_digest
                or binding.get("intent_digest") != operation.intent_digest
                or attempt.invocation_digest != operation.intent_digest
                or binding.get("execution_id") != parent.execution_id
            ):
                return False
            # All checks precede the write. Changing claimed to not_dispatched
            # closes the very predicate claim_dispatch rechecks under this lock.
            self.api.authorization._append_outcome(session, owned, operation, attempt, "not_dispatched", None)
            session.flush()
            outcome = NativeWorkflowOutcome(
                status="completed",
                ref=ref,
                native_run_id=native_id,
                checkpoint_ref=None,
                pending_operation_ids=(),
                reason_code=None,
                wait_reason=None,
                native_status="failed",
                output_result_ref=None,
            )
            self.api.lifecycle.finalize_dispatch_locked(
                session=session,
                owned=owned,
                scope=scope,
                dispatch_id=source_id,
                generation=selected_generation,
                outcome=outcome,
                terminal_failure=True,
            )
        return True

    def finish_resume(self, *, ref, generation, dispatch_id):
        try:
            settled = self._settle_unconsumed_failure(ref=ref, generation=generation, dispatch_id=dispatch_id)
        except Exception:
            # Missing optional proof grants nothing. The original owner below
            # still validates and conservatively settles its actual effect facts.
            logger.warning("Confirmed Agent failed effect settlement remains unproven")
            settled = False
        if settled:
            self._complete_builder(ref=ref)
            return
        try:
            context = self.api.store.load_context(ref=ref)
        except BuilderExecutionPolicyError as error:
            if error.reason_code != "native_expired":
                raise
            context = self.api.store.load_terminal_context(ref=ref)
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
            reasons = {
                reason.message if isinstance(reason, SchedulingPause) else None
                for reason in paused.runtime.graph_execution.pause_reasons
            }
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
        return tuple(self.peek(actor=actor, session_id=session_id, request_id=identity) for identity in identities)


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
    if generate_entity.builder_agent_execution is None:
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

    def __init__(
        self,
        *,
        sessions,
        actor,
        confirmed_factory: Callable[[], ConfirmedAgentCommands],
        legacy_factory: Callable[[], NativeTestApiService],
    ):
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

    def reconcile_pending(
        self, *, actor, session_id, request_id: str, publish: Callable[..., None], limit: int = 100
    ) -> int:
        service = self._service(actor=actor, session_id=session_id, request_id=request_id)
        lifecycle = service.api.lifecycle if isinstance(service, ConfirmedAgentCommands) else service.lifecycle
        reconciled = lifecycle.reconcile(limit=limit, request_id=request_id)
        if isinstance(service, ConfirmedAgentCommands):
            return reconciled + service.publish_pending(limit=limit, request_id=request_id)
        return reconciled + lifecycle.publish_pending(publish=publish, limit=limit, request_id=request_id)

    def keep_alive_waiting_binding(self, *, actor, session_id, request_id) -> bool:
        service = self._service(actor=actor, session_id=session_id, request_id=request_id)
        if isinstance(service, ConfirmedAgentCommands):
            return service.keep_alive_waiting_binding(actor=actor, session_id=session_id, request_id=request_id)
        return False

    def recover_observation(self, *, actor, session_id, request_id):
        """Worker-only ACK observation, separate from outbox publication and GET."""
        service = self._service(actor=actor, session_id=session_id, request_id=request_id)
        if isinstance(service, ConfirmedAgentCommands):
            service.get(actor=actor, session_id=session_id, request_id=request_id)

    def settle_builder(self, *, actor, session_id, request_id):
        """POST-only result projection; never publish or launch work."""
        service = self._service(actor=actor, session_id=session_id, request_id=request_id)
        if isinstance(service, ConfirmedAgentCommands):
            service._complete_builder(ref=service._root_ref(actor=actor, request_id=request_id))

    def start(self, **values):
        return self.legacy_factory().start(**values)

    def peek(self, **values):
        """Observation never recovers ACKs, publishes dispatches, or executes work."""
        service = self._service(**values)
        return service.peek(**values) if isinstance(service, ConfirmedAgentCommands) else service.get(**values)

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
        return tuple(self.peek(actor=actor, session_id=session_id, request_id=identity) for identity in identities)
