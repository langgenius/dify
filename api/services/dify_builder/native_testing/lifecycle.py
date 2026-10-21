"""Durable native wait/resume/cancel owner; no competing workflow executor.

SQL request locks serialize shared generations. Queue delivery may repeat; a
claimed dispatch never restarts on a Redis timeout or a missing queue ack.
Qualified native adapters must supply actual execution/termination evidence.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from re import fullmatch
from typing import TYPE_CHECKING, Literal, Protocol, Self, cast

from pydantic import StrictBool, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectGrant,
    NativeEffectOperation,
    NativeInvocationState,
    NativePayloadObject,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import (
    ID,
    CancellationReceipt,
    CheckpointRef,
    FrozenDTO,
    NativeTestContextRef,
    Outcome,
    ResumeReceipt,
    WaitingReceipt,
    WaitReason,
)
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.private_reads import validate_invocation_workflow, validate_private_read
from services.dify_builder.native_testing.repository import (
    OwnedNativeTest,
    OwnedNativeTestLoader,
    admitted_workflow_revision,
    native_workflow_revision,
    utc_now,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore, invocation_state, owner_query
from services.dify_builder.native_testing.transitions import (
    dispatch_readiness,
    has_unknown_descendant,
    invocation_subtree,
    pending_reason,
    quarantine_unknown,
    recoverable_invocation_ids,
    require_ancestor_authority,
    validate_pending_fence,
    validate_pending_history,
)

if TYPE_CHECKING:
    from services.dify_builder.native_testing.host_capacity import NativeHostCapacity


class NativePendingResolution(FrozenDTO):
    """Facts from the actual configuration/form owner, never client completion flags."""

    category: Literal["configuration", "interaction"]
    invocation_id: ID
    pending_action_id: ID
    owner_ref: ID
    reference: ID
    resolved: StrictBool
    account_ref: ID | None
    answer_result_ref: ID | None

    @model_validator(mode="after")
    def validate_completion(self) -> Self:
        if self.category == "configuration":
            if self.answer_result_ref is not None or (self.resolved and self.account_ref is None):
                raise ValueError("configuration requires resolved account identity")
        elif self.account_ref is not None or (self.resolved and self.answer_result_ref is None):
            raise ValueError("interaction requires authentic form answer")
        if not self.resolved and (self.account_ref is not None or self.answer_result_ref is not None):
            raise ValueError("unresolved owner has no completion evidence")
        return self


class NativePendingResolutionPort(Protocol):
    def resolve(
        self, *, session: Session, owned: OwnedNativeTest, pending: NativePendingAction
    ) -> NativePendingResolution:
        """Read actual native owner facts in SQL only; no OAuth/decryption/network."""
        ...


class NativeResumeSettlementPort(Protocol):
    def validate(
        self, *, session: Session, owned: OwnedNativeTest, state: NativeInvocationState, checkpoint: CheckpointRef
    ) -> None:
        """SQL-only proof of the completed source acquisition, inside the resume writer."""
        ...


class NativeRuntimePort(Protocol):
    def run_initial(self, *, context: ResolvedNativeTestContext) -> NativeWorkflowOutcome: ...
    def resume(
        self,
        *,
        context: ResolvedNativeTestContext,
        checkpoint: NativeCheckpointPayload,
        resolutions: tuple[NativePendingResolution, ...],
    ) -> NativeWorkflowOutcome: ...
    def cancel(self, *, refs: tuple[NativeTestContextRef, ...]) -> tuple[str, ...]:
        """Legacy generic C03 receipt; production uses exact capacity SQL ACKs instead."""
        ...

    def recovery_evidence(
        self, *, context: ResolvedNativeTestContext, dispatch_id: str
    ) -> Literal["not_started", "stopped", "unknown"]:
        """Fence the complete native subtree, never infer proof from a lease timeout.

        'stopped' proves neither the old root nor any child execution can continue.
        """
        ...


@dataclass(frozen=True)
class _ResumeCheckpoint:
    """Private acknowledged selection read outside the writer, rechecked inside."""

    ref: NativeTestContextRef
    checkpoint: CheckpointRef
    payload: NativeCheckpointPayload
    pending_ids: tuple[str, ...]
    observed_generation: int


@dataclass(frozen=True)
class NativeDispatchRef:
    ref: NativeTestContextRef
    generation: int
    dispatch_id: str


@dataclass(frozen=True)
class PreparedNativeDispatchClaim:
    ref: NativeTestContextRef
    generation: int
    dispatch_id: str
    context: ResolvedNativeTestContext
    context_object_id: str | None
    checkpoint: CheckpointRef | None
    payload: NativeCheckpointPayload | None
    selected: dict[str, _ResumeCheckpoint]


class NativeCancellationSettlementPort(Protocol):
    def finish_unacquired(self, *, ref: NativeTestContextRef) -> None:
        """SQL-only genuine initial-outbox cancellation; no physical ACK by ID."""
        ...


class NativeTestLifecycleService:
    def __init__(
        self,
        loader: OwnedNativeTestLoader,
        *,
        state_store: NativeExecutionStateStore,
        resolution: NativePendingResolutionPort | None = None,
        runtime: NativeRuntimePort | None = None,
        resume_settlement: NativeResumeSettlementPort | None = None,
        cancellation_settlement: NativeCancellationSettlementPort | None = None,
        clock: Callable[[], datetime] = utc_now,
    ):
        self.loader, self.store, self.resolution, self.runtime, self.clock = (
            loader,
            state_store,
            resolution,
            runtime,
            clock,
        )
        self._dispatch_ref: NativeDispatchRef | None = None
        self.resume_settlement = resume_settlement
        self.cancellation_settlement = cancellation_settlement
        self._capacity: NativeHostCapacity | None = None

    @staticmethod
    def _request_row(session: Session, request_id: str) -> DifyBuilderExecutionRequest:
        request = session.get(DifyBuilderExecutionRequest, request_id)
        if request is None:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        return request

    def _root_ref(self, actor: Actor, request_id: str) -> NativeTestContextRef:
        if actor != self.loader.actor:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        with self.loader.session_factory() as session:
            request = session.scalar(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.id == request_id,
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                )
            )
            state = session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == request_id,
                    NativeInvocationState.tenant_id == actor.tenant_id,
                    NativeInvocationState.parent_invocation_id.is_(None),
                )
            )
            if request is None or state is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            return NativeTestContextRef(
                request_id=request_id, invocation_id=state.invocation_id, context_digest=request.context_digest
            )

    def fence_pending(
        self, *, ref: NativeTestContextRef, pending_operation_ids: tuple[str, ...], expected_generation: int
    ) -> None:
        """Commit pause intent only; success acknowledges a fence, never a wait.

        Permission RPC stays outside the writer. A lost acknowledgement does not
        prove physical closure; already committed claims retain their owners.
        """
        authority = validate_private_read(self.loader, ref)
        with self.loader.locked(ref=ref) as (session, owned, _):
            state = invocation_state(session, ref, owned.tenant_id)
            if (
                type(expected_generation) is not int
                or (state.generation, state.app_id, state.workflow_id, state.context_object_id)
                != (expected_generation, authority.app_id, authority.workflow_id, authority.context_object_id)
                or (state.generation != authority.generation)
            ):
                raise BuilderExecutionPolicyError("native_generation_conflict")
            dispatch_readiness(session, ref=ref, tenant_id=owned.tenant_id, now=self.clock(), coalesce_self=True)
            workflow = validate_invocation_workflow(
                session, tenant_id=owned.tenant_id, app_id=authority.app_id, workflow_id=authority.workflow_id
            )
            revision_context = authority.revision_context
            revision = (
                admitted_workflow_revision(workflow, revision_context)
                if revision_context
                else native_workflow_revision(workflow)
            )
            if revision != authority.graph_revision:
                raise BuilderExecutionPolicyError("native_revision_drift")
            if (
                not isinstance(pending_operation_ids, tuple)
                or not pending_operation_ids
                or any(type(identity) is not str or not identity for identity in pending_operation_ids)
                or len(set(pending_operation_ids)) != len(pending_operation_ids)
            ):
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            base = state.pending_ids if state.wait_reason is not None else []
            combined = tuple(dict.fromkeys((*base, *pending_operation_ids)))
            rows = session.scalars(
                owner_query(NativePendingAction, ref, owned.tenant_id).where(NativePendingAction.id.in_(combined))
            ).all()
            # Validate the incoming tuple separately so duplicates or an empty
            # request cannot disappear into the ordered union.
            validate_pending_fence(
                [row for row in rows if row.id in pending_operation_ids],
                state=state,
                ref=ref,
                tenant_id=owned.tenant_id,
                pending_ids=pending_operation_ids,
            )
            validated = validate_pending_fence(
                rows, state=state, ref=ref, tenant_id=owned.tenant_id, pending_ids=combined
            )
            state.pending_ids, state.wait_reason = list(combined), pending_reason(validated)
        # The writer context has committed before returning plain completion.

    def seal_stop(
        self, *, ref: NativeTestContextRef, expected_generation: int, dispatch_id: str, reason_code: str
    ) -> None:
        """Permanently close this request's authority, not its physical evidence.

        Called by the exact currently owned native control sink. Settlement
        ownership permits safe shutdown after permission revocation or expiry;
        this SQL-only operation grants no I/O, checkpoint, cleanup or terminal
        Run receipt. Acquisition evidence stays intact for actual settlement.
        A repeated or ambiguously acknowledged seal cannot confer acceptance.
        """
        if (
            type(expected_generation) is not int
            or type(dispatch_id) is not str
            or not dispatch_id
            or type(reason_code) is not str
            or fullmatch(r"[a-z][a-z0-9_]{0,127}", reason_code) is None
        ):
            raise BuilderExecutionPolicyError("native_stop_fence_invalid")
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
            request = session.get(DifyBuilderExecutionRequest, ref.request_id)
            states = session.scalars(
                select(NativeInvocationState).where(NativeInvocationState.request_id == ref.request_id)
            ).all()
            invocations = session.scalars(
                select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
            ).all()
            dispatches = session.scalars(
                select(NativeDispatch).where(NativeDispatch.request_id == ref.request_id)
            ).all()
            owner = (ref.request_id, owned.tenant_id)
            if any((row.request_id, row.tenant_id) != owner for row in (*states, *invocations, *dispatches)):
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            by_id = {row.invocation_id: row for row in states}
            active = {row.invocation_id: row for row in invocations}
            roots = [row for row in states if row.parent_invocation_id is None]
            current = next((row for row in dispatches if row.id == dispatch_id), None)
            state = by_id.get(ref.invocation_id)
            if (
                request is None
                or request.state not in {"running", "waiting"}
                or scope.cancelled
                or len(roots) != 1
                or len(by_id) != len(states)
                or len(active) != len(invocations)
                or set(by_id) != set(active)
                or state is None
                or not active[ref.invocation_id].active
                or state.state not in {"running", "waiting"}
                or state.generation != expected_generation
                or current is None
                or (current.invocation_id, current.generation, current.state)
                != (ref.invocation_id, expected_generation, "claimed")
            ):
                raise BuilderExecutionPolicyError("native_stop_fence_conflict")
            root = roots[0]
            if (root.app_id, root.workflow_id) != (owned.app_id, owned.workflow_id):
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            connected = {root.invocation_id}
            while True:
                expanded = connected | {row.invocation_id for row in states if row.parent_invocation_id in connected}
                if expanded == connected:
                    break
                connected = expanded
            if connected != set(by_id) or any(row.invocation_id not in connected for row in dispatches):
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            request.state = "sealed"
            for invocation in invocations:
                invocation.active = False
            for dispatch in dispatches:
                if dispatch.state in {"queued", "published"}:
                    dispatch.state = "cancelled"
        # None is returned only after the actual request writer acknowledges commit.

    def pause(
        self,
        *,
        ref: NativeTestContextRef,
        checkpoint: CheckpointRef,
        pending_operation_ids: tuple[str, ...],
        expected_generation: int,
    ) -> WaitingReceipt:
        payload = self.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
        if (
            not isinstance(pending_operation_ids, tuple)
            or not pending_operation_ids
            or any(type(identity) is not str or not identity for identity in pending_operation_ids)
            or len(set(pending_operation_ids)) != len(pending_operation_ids)
        ):
            raise BuilderExecutionPolicyError("native_pending_mismatch")
        with self.loader.locked(ref=ref) as (session, owned, _):
            state = invocation_state(session, ref, owned.tenant_id)
            if (
                type(expected_generation) is not int
                or state.generation != expected_generation
                or payload.generation != expected_generation
            ):
                raise BuilderExecutionPolicyError("native_generation_conflict")
            if owned.expires_at <= self.clock():
                raise BuilderExecutionPolicyError("native_expired")
            if state.state not in {"running", "waiting"}:
                raise BuilderExecutionPolicyError("native_state_conflict")
            if type(state.pending_ids) is not list or state.wait_reason not in {
                None,
                "configuration",
                "interaction",
                "approval",
            }:
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            if state.state == "running" and state.wait_reason is None and state.pending_ids:
                validate_pending_history(session, ref=ref, tenant_id=owned.tenant_id, state=state)
            if state.wait_reason is not None and not set(state.pending_ids) <= set(pending_operation_ids):
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            if (
                state.wait_reason is not None
                and pending_reason(self._pending_rows(session, owned, state)) != state.wait_reason
            ):
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            child_pending = set()
            for child_ref in payload.child_refs:
                if (child_ref.request_id, child_ref.context_digest) != (ref.request_id, ref.context_digest):
                    raise BuilderExecutionPolicyError("native_child_owner_mismatch")
                child_state = invocation_state(session, child_ref, owned.tenant_id)
                if child_state.parent_invocation_id != ref.invocation_id:
                    raise BuilderExecutionPolicyError("native_child_owner_mismatch")
                if child_state.state == "waiting":
                    if child_state.checkpoint_id is None:
                        raise BuilderExecutionPolicyError("native_child_wait_uncommitted")
                    child_continuation = session.scalar(
                        owner_query(NativeContinuation, child_ref, owned.tenant_id).where(
                            NativeContinuation.checkpoint_id == child_state.checkpoint_id,
                            NativeContinuation.generation == child_state.generation,
                        )
                    )
                    if child_continuation is None:
                        raise BuilderExecutionPolicyError("native_child_wait_uncommitted")
                    self._pending_rows(session, owned, child_state)
                    child_pending.update(child_state.pending_ids)
            rows = session.scalars(
                select(NativePendingAction).where(
                    NativePendingAction.tenant_id == owned.tenant_id,
                    NativePendingAction.request_id == ref.request_id,
                    NativePendingAction.id.in_(pending_operation_ids),
                )
            ).all()
            if len(rows) != len(pending_operation_ids) or any(
                row.category not in {"approval", "configuration", "interaction"}
                or row.id not in child_pending
                and (row.invocation_id != ref.invocation_id or row.generation != expected_generation)
                for row in rows
            ):
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            continuation = session.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                    NativeContinuation.generation == expected_generation,
                    NativeContinuation.payload_digest == checkpoint.payload_digest,
                )
            )
            if continuation is None:
                raise BuilderExecutionPolicyError("checkpoint_unavailable")
            if state.state == "waiting" and (
                state.checkpoint_id != checkpoint.checkpoint_id or set(state.pending_ids) != set(pending_operation_ids)
            ):
                raise BuilderExecutionPolicyError("native_wait_conflict")
            reasons = {row.category for row in rows}
            reason = cast(
                WaitReason, next(reason for reason in ("configuration", "interaction", "approval") if reason in reasons)
            )
            state.state, state.checkpoint_id = "waiting", checkpoint.checkpoint_id
            state.pending_ids, state.wait_reason = list(pending_operation_ids), reason
            self._request_row(session, ref.request_id).state = "waiting"
            result = WaitingReceipt(
                request_id=ref.request_id,
                invocation_id=ref.invocation_id,
                generation=expected_generation,
                checkpoint=checkpoint,
                pending_operation_ids=pending_operation_ids,
                wait_reason=reason,
            )
        # Caller may emit this receipt only after the transaction has committed.
        return result

    def _pending_rows(self, session, owned, state, *, generations=None):
        """SQL provenance for own and precisely represented descendant waits."""
        ids = state.pending_ids
        if (
            type(ids) is not list
            or not ids
            or any(type(identity) is not str or not identity for identity in ids)
            or len(set(ids)) != len(ids)
        ):
            raise BuilderExecutionPolicyError("native_pending_mismatch")
        ref = owned.ref.model_copy(update={"invocation_id": state.invocation_id})
        states = {row.invocation_id: row for row in self._subtree(session, ref, owned.tenant_id)}
        rows = session.scalars(
            select(NativePendingAction).where(
                NativePendingAction.tenant_id == owned.tenant_id,
                NativePendingAction.request_id == owned.ref.request_id,
                NativePendingAction.id.in_(ids),
            )
        ).all()
        by_id = {row.id: row for row in rows}
        if set(by_id) != set(ids) or len(rows) != len(ids):
            raise BuilderExecutionPolicyError("native_pending_mismatch")
        for row in rows:
            owner = states.get(row.invocation_id)
            expected = (
                generations.get(row.invocation_id) if generations is not None else owner.generation if owner else None
            )
            if (
                owner is None
                or (row.tenant_id, row.request_id) != (owned.tenant_id, owned.ref.request_id)
                or row.generation != expected
                or row.id not in owner.pending_ids
                or row.category not in {"approval", "configuration", "interaction"}
            ):
                raise BuilderExecutionPolicyError("native_pending_mismatch")
        return tuple(by_id[identity] for identity in ids)

    def _resolve_pending(self, session, owned, state, *, generations=None) -> list[NativePendingResolution]:
        resolutions = []
        for pending in self._pending_rows(session, owned, state, generations=generations):
            pending_ref = owned.ref.model_copy(update={"invocation_id": pending.invocation_id})
            if pending.category == "approval":
                operation = session.scalar(
                    owner_query(NativeEffectOperation, pending_ref, owned.tenant_id).where(
                        NativeEffectOperation.id == pending.operation_id
                    )
                )
                if operation is None:
                    raise BuilderExecutionPolicyError("native_pending_mismatch")
                if operation.state == "completed":
                    continue
                self.loader._load(session, ref=pending_ref, lock=False)
                grant = session.scalar(
                    select(NativeEffectGrant).where(
                        NativeEffectGrant.tenant_id == owned.tenant_id,
                        NativeEffectGrant.request_id == owned.ref.request_id,
                        NativeEffectGrant.scope_digest == operation.scope_digest,
                    )
                )
                if (
                    operation.state != "pending"
                    or grant is None
                    or grant.decision != "approved"
                    or grant.expires_at <= self.clock()
                    or grant.spent_calls >= grant.max_calls
                    or grant.spent_dispatches >= grant.max_dispatches
                ):
                    raise BuilderExecutionPolicyError("native_pending_unresolved")
            else:
                if self.resolution is None:
                    raise BuilderExecutionPolicyError("native_pending_resolver_required")
                pending_owned, _ = self.loader._load(session, ref=pending_ref, lock=False)
                resolution = NativePendingResolution.model_validate(
                    self.resolution.resolve(session=session, owned=pending_owned, pending=pending).model_dump(
                        mode="json"
                    )
                )
                if (
                    resolution.category,
                    resolution.invocation_id,
                    resolution.pending_action_id,
                    resolution.owner_ref,
                    resolution.reference,
                ) != (
                    pending.category,
                    pending.invocation_id,
                    pending.id,
                    pending.owner_ref,
                    pending.reference,
                ):
                    raise BuilderExecutionPolicyError("native_pending_owner_mismatch")
                if not resolution.resolved:
                    raise BuilderExecutionPolicyError("native_pending_unresolved")
                resolutions.append(resolution)
        return resolutions

    def _validate_resolution_results(self, session, owned, resolutions):
        """Current protected answer provenance; no payload read inside a writer."""
        from models.dify_builder_native_tests import NativePayloadObject

        for resolution in resolutions:
            if (
                resolution.answer_result_ref is not None
                and session.scalar(
                    owner_query(
                        NativePayloadObject,
                        owned.ref.model_copy(update={"invocation_id": resolution.invocation_id}),
                        owned.tenant_id,
                    ).where(
                        NativePayloadObject.id == resolution.answer_result_ref,
                        NativePayloadObject.kind == "result",
                    )
                )
                is None
            ):
                raise BuilderExecutionPolicyError("native_result_owner_mismatch")

    def _checkpoint_tree(self, ref, checkpoint, payload):
        """Read only the acknowledged represented tree, with all payload I/O outside SQL writers."""
        selected, stack = {}, [(ref, checkpoint, payload)]
        while stack:
            current_ref, current_checkpoint, current_payload = stack.pop()
            if current_ref.invocation_id in selected:
                raise BuilderExecutionPolicyError("native_child_owner_mismatch")
            with self.loader.session_factory() as session:
                owned, _ = self.loader._load(session, ref=current_ref, lock=False, settlement=True)
                state = invocation_state(session, current_ref, owned.tenant_id)
                if state.checkpoint_id != current_checkpoint.checkpoint_id:
                    raise BuilderExecutionPolicyError("checkpoint_unavailable")
                selected[current_ref.invocation_id] = _ResumeCheckpoint(
                    current_ref, current_checkpoint, current_payload, tuple(state.pending_ids), state.generation
                )
                children = []
                for child_ref in current_payload.child_refs:
                    if (child_ref.request_id, child_ref.context_digest) != (ref.request_id, ref.context_digest):
                        raise BuilderExecutionPolicyError("native_child_owner_mismatch")
                    child = invocation_state(session, child_ref, owned.tenant_id)
                    if child.parent_invocation_id != current_ref.invocation_id:
                        raise BuilderExecutionPolicyError("native_child_owner_mismatch")
                    if child.state not in {"waiting", "queued", "completed", "stopped"} or not child.pending_ids:
                        continue
                    saved = session.scalar(
                        owner_query(NativeContinuation, child_ref, owned.tenant_id).where(
                            NativeContinuation.checkpoint_id == child.checkpoint_id
                        )
                    )
                    if saved is None:
                        raise BuilderExecutionPolicyError("checkpoint_unavailable")
                    children.append(
                        (
                            child_ref,
                            CheckpointRef(checkpoint_id=saved.checkpoint_id, payload_digest=saved.payload_digest),
                        )
                    )
            for child_ref, child_checkpoint in children:
                child_payload = self.store.read_checkpoint(ref=child_ref, checkpoint=child_checkpoint)
                stack.append((child_ref, child_checkpoint, child_payload))
        return selected

    def _validate_checkpoints(self, session, owned, selected):
        states = {}
        for identity, proof in selected.items():
            state = invocation_state(session, proof.ref, owned.tenant_id)
            continuation = session.scalar(
                owner_query(NativeContinuation, proof.ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == proof.checkpoint.checkpoint_id,
                    NativeContinuation.payload_digest == proof.checkpoint.payload_digest,
                    NativeContinuation.generation == proof.payload.generation,
                )
            )
            if (
                continuation is None
                or state.checkpoint_id != proof.checkpoint.checkpoint_id
                or tuple(state.pending_ids) != proof.pending_ids
                or state.generation != proof.observed_generation
                or continuation.generation != proof.payload.generation
                or state.state == "waiting"
                and state.generation != proof.payload.generation
            ):
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            states[identity] = state
        return states

    def _resume_selection(self, *, actor: Actor, request_id: str):
        ref = self._root_ref(actor, request_id)
        context = self.store.load_context(ref=ref)  # current RBAC, revision and immutable input snapshot
        with self.loader.session_factory() as session:
            observed = invocation_state(session, ref, context.tenant_id)
            saved = session.scalar(
                owner_query(NativeContinuation, ref, context.tenant_id).where(
                    NativeContinuation.checkpoint_id == observed.checkpoint_id
                )
            )
            if saved is None:
                raise BuilderExecutionPolicyError("checkpoint_unavailable")
            checkpoint = CheckpointRef(checkpoint_id=saved.checkpoint_id, payload_digest=saved.payload_digest)
        try:
            recovered = self.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
            if recovered.native_run_id != context.native_run_id:
                raise BuilderExecutionPolicyError("native_run_mismatch")
        except Exception:
            raise BuilderExecutionPolicyError("checkpoint_unavailable") from None
        selected = self._checkpoint_tree(ref, checkpoint, recovered)
        return ref, context, checkpoint, recovered, selected

    def _validate_resume(self, *, session, owned, scope, checkpoint, recovered, selected, expected_generation):
        """Shared SQL-only resume checks; no generation, queue, or grant writes."""
        if owned.expires_at <= self.clock():
            raise BuilderExecutionPolicyError("native_expired")
        ref = owned.ref
        state = invocation_state(session, ref, owned.tenant_id)
        if type(expected_generation) is not int or expected_generation != state.generation:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        if state.state != "waiting" or state.checkpoint_id != checkpoint.checkpoint_id:
            raise BuilderExecutionPolicyError("native_state_conflict")
        if has_unknown_descendant(session, ref, owned.tenant_id):
            raise BuilderExecutionPolicyError("native_subtree_unknown")
        represented = self._validate_checkpoints(session, owned, selected)
        generations = {identity: proof.payload.generation for identity, proof in selected.items()}
        if recovered.generation != state.generation:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        if self.resume_settlement is not None:
            self.resume_settlement.validate(session=session, owned=owned, state=state, checkpoint=checkpoint)
        resolutions = self._resolve_pending(session, owned, state, generations=generations)
        self._validate_resolution_results(session, owned, resolutions)
        return state, represented, resolutions

    def check_resume(self, *, actor: Actor, request_id: str, expected_generation: int) -> None:
        """Full advisory proof; the actual command repeats every check under lock.

        Existing owned storage reads and permission checks are allowed. This
        path invokes no business operation, OAuth refresh, LLM, claim or queue
        publication and writes no SQL/object-storage state.
        """
        ref, _context, checkpoint, recovered, selected = self._resume_selection(actor=actor, request_id=request_id)
        with self.loader.session_factory() as session:
            owned, scope = self.loader._load(session, ref=ref, lock=False)
            self._validate_resume(
                session=session,
                owned=owned,
                scope=scope,
                checkpoint=checkpoint,
                recovered=recovered,
                selected=selected,
                expected_generation=expected_generation,
            )

    def resume(self, *, actor: Actor, request_id: str, expected_generation: int, idempotency_key: str) -> ResumeReceipt:
        ref, _context, checkpoint, recovered, selected = self._resume_selection(actor=actor, request_id=request_id)
        digest = self._idempotency("resume", idempotency_key)
        with self.loader.locked(ref=ref) as (session, owned, scope):
            if owned.expires_at <= self.clock():
                raise BuilderExecutionPolicyError("native_expired")
            previous = session.scalar(
                select(NativeDispatch).where(
                    NativeDispatch.request_id == request_id,
                    NativeDispatch.tenant_id == owned.tenant_id,
                    NativeDispatch.idempotency_digest == digest,
                )
            )
            if previous is not None:
                prior_checkpoint = session.scalar(
                    owner_query(NativeContinuation, ref, owned.tenant_id).where(
                        NativeContinuation.checkpoint_id == previous.checkpoint_id,
                        NativeContinuation.generation == expected_generation,
                    )
                )
                if type(expected_generation) is not int or prior_checkpoint is None:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
                return self._receipt(previous)
            state, represented, resolutions = self._validate_resume(
                session=session,
                owned=owned,
                scope=scope,
                checkpoint=checkpoint,
                recovered=recovered,
                selected=selected,
                expected_generation=expected_generation,
            )
            scope.generation += 1
            # Advance precisely the waiting descendants represented by this
            # parent's committed wait. Other branches retain their own cursors.
            resolved_ids = set(state.pending_ids)
            for child in self._subtree(session, ref, owned.tenant_id):
                if (
                    child.invocation_id != ref.invocation_id
                    and child.invocation_id in represented
                    and child.state == "waiting"
                    and child.pending_ids
                    and set(child.pending_ids) <= resolved_ids
                ):
                    child.generation, child.state = scope.generation, "queued"
            state.generation, state.state = scope.generation, "queued"
            state.resolution = [resolution.model_dump(mode="json") for resolution in resolutions]
            dispatch = NativeDispatch(
                tenant_id=owned.tenant_id,
                request_id=request_id,
                invocation_id=ref.invocation_id,
                generation=scope.generation,
                idempotency_digest=digest,
                state="queued",
                checkpoint_id=state.checkpoint_id,
                claim_expires_at=None,
            )
            session.add(dispatch)
            session.flush()
            result = self._receipt(dispatch)
        return result

    @staticmethod
    def _idempotency(kind: str, key: str) -> str:
        if not isinstance(key, str) or not key or len(key) > 128:
            raise BuilderExecutionPolicyError("invalid_idempotency_key")
        return canonical_digest({"kind": kind, "key": key})

    @staticmethod
    def _receipt(dispatch: NativeDispatch) -> ResumeReceipt:
        status = (
            "running"
            if dispatch.state == "claimed"
            else "queued"
            if dispatch.state in {"queued", "published"}
            else "terminal"
        )
        return ResumeReceipt(
            request_id=dispatch.request_id, generation=dispatch.generation, dispatch_id=dispatch.id, status=status
        )

    def publish_pending(self, *, publish: Callable[..., None], limit: int = 100, request_id: str | None = None) -> int:
        """Every unclaimed outbox remains retryable, including lost broker acknowledgements."""
        with self.loader.session_factory() as session:
            query = (
                select(NativeDispatch, DifyBuilderExecutionRequest.context_digest)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeDispatch.request_id)
                .where(
                    NativeDispatch.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.loader.actor.account_id,
                    NativeDispatch.state.in_(("queued", "published")),
                )
                .order_by(NativeDispatch.id)
            )
            if request_id is not None:
                query = query.where(NativeDispatch.request_id == request_id)
            rows = session.execute(query.limit(limit)).all()
        published = 0
        for dispatch, digest in rows:
            ref = NativeTestContextRef(
                request_id=dispatch.request_id, invocation_id=dispatch.invocation_id, context_digest=digest
            )
            try:
                self.loader.load(ref=ref)
                publish(
                    ref=ref.model_dump(mode="json"),
                    generation=dispatch.generation,
                    dispatch_id=dispatch.id,
                    actor={"account_id": self.loader.actor.account_id, "tenant_id": self.loader.actor.tenant_id},
                )
            except Exception:
                continue  # durable row remains available to the next sweep
            with self.loader.locked(ref=ref) as (session, _, _):
                row = session.get(NativeDispatch, dispatch.id)
                if row is None:
                    raise BuilderExecutionPolicyError("native_dispatch_conflict")
                if row.state == "queued":
                    row.state = "published"
            published += 1
        return published

    def _validate_initial(self, session, owned, scope, context, state, *, states):
        from models.dify_builder import DifyBuilderTestInput
        from models.dify_builder_native_tests import (
            NativeEffectAttempt,
            NativeEffectDispatchClaim,
            NativeEffectOutcome,
            NativePayloadObject,
        )

        if (
            type(state.generation) is not int
            or state.generation != 0
            or scope.generation != 0
            or context.generation != 0
            or context.ref != owned.ref
            or context.parent_invocation_id is not None
            or state.parent_invocation_id is not None
            or context.execution_mode != "native"
            or not context.native_run_id
            or context.native_run_id != context.root_native_run_id
            or state.state not in states
            or state.checkpoint_id is not None
            or state.pending_ids != []
            or state.wait_reason is not None
            or state.resolution != []
            or state.outcome is not None
            or state.cancellation_key is not None
            or state.cleanup_complete is not False
            or scope.cancelled
            or owned.expires_at <= self.clock()
            or (state.app_id, state.workflow_id) != (context.app_id, context.workflow_id)
            or (context.tenant_id, context.actor_id, context.app_id, context.workflow_id)
            != (owned.tenant_id, owned.actor_id, owned.app_id, owned.workflow_id)
            or any(value != 0 for value in (scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units))
            or scope.budget_spent != {}
        ):
            raise BuilderExecutionPolicyError("native_initial_conflict")
        row = session.scalar(
            owner_query(NativePayloadObject, owned.ref, owned.tenant_id).where(
                NativePayloadObject.id == state.context_object_id,
                NativePayloadObject.kind == "context",
                NativePayloadObject.value_digest == canonical_digest(context.model_dump(mode="json")),
            )
        )
        if row is None:
            raise BuilderExecutionPolicyError("native_state_unavailable")
        workflow = validate_invocation_workflow(
            session, tenant_id=owned.tenant_id, app_id=context.app_id, workflow_id=context.workflow_id
        )
        inputs = session.get(DifyBuilderTestInput, owned.test_input_id)
        revision_context = owned.revision_context
        if (
            (
                admitted_workflow_revision(workflow, revision_context)
                if revision_context
                else native_workflow_revision(workflow)
            )
            != context.graph_revision
            or inputs is None
            or canonical_digest(inputs.inputs) != context.input_revision
            or canonical_digest(context.inputs) != context.input_revision
        ):
            raise BuilderExecutionPolicyError("native_revision_drift")
        for model in (
            NativeContinuation,
            NativePendingAction,
            NativeEffectOperation,
            NativeEffectAttempt,
            NativeEffectDispatchClaim,
            NativeEffectOutcome,
        ):
            if (
                session.scalar(
                    select(model.id).where(model.request_id == owned.ref.request_id, model.tenant_id == owned.tenant_id)
                )
                is not None
            ):
                raise BuilderExecutionPolicyError("native_initial_conflict")
        lineage = session.scalars(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == owned.ref.request_id,
                NativeInvocationState.tenant_id == owned.tenant_id,
            )
        ).all()
        if len(lineage) != 1 or lineage[0].invocation_id != owned.ref.invocation_id:
            raise BuilderExecutionPolicyError("native_initial_conflict")

    def enqueue_initial_dispatch(self, *, ref: NativeTestContextRef) -> NativeDispatchRef:
        context = self.store.load_context(ref=ref)
        digest = canonical_digest({"initial": ref.model_dump(mode="json")})
        with self.loader.locked(ref=ref) as (session, owned, scope):
            state = invocation_state(session, ref, owned.tenant_id)
            existing = session.scalars(owner_query(NativeDispatch, ref, owned.tenant_id)).all()
            if existing:
                if (
                    len(existing) != 1
                    or existing[0].generation != 0
                    or existing[0].checkpoint_id is not None
                    or existing[0].idempotency_digest != digest
                ):
                    raise BuilderExecutionPolicyError("native_initial_conflict")
                return NativeDispatchRef(ref, 0, existing[0].id)
            self._validate_initial(session, owned, scope, context, state, states={"running"})
            dispatch_readiness(session, ref=ref, tenant_id=owned.tenant_id, now=self.clock())
            dispatch = NativeDispatch(
                tenant_id=owned.tenant_id,
                request_id=ref.request_id,
                invocation_id=ref.invocation_id,
                generation=0,
                idempotency_digest=digest,
                state="queued",
                checkpoint_id=None,
                claim_expires_at=None,
            )
            session.add(dispatch)
            state.state = "queued"
            session.flush()
            result = NativeDispatchRef(ref, 0, dispatch.id)
        return result

    def claim_dispatch(self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> bool:
        if self._capacity is not None:
            return self._capacity.claim_dispatch(ref=ref, generation=generation, dispatch_id=dispatch_id)
        prepared = self.prepare_dispatch_claim(ref=ref, generation=generation, dispatch_id=dispatch_id)
        if prepared is None:
            return False
        with self.loader.locked(ref=ref) as (session, owned, scope):
            return self.consume_dispatch_claim(session=session, owned=owned, scope=scope, prepared=prepared)

    def claimed_resume_checkpoint(
        self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str
    ) -> CheckpointRef:
        """Metadata handoff for an already claimed resume, never new execution authority.

        Permission checks precede the bounded SQL read; no writer or private I/O.
        Runtime must still reread this C03 object and verify its actual native run.
        """
        from models.dify_builder_native_tests import NativePayloadObject

        if type(generation) is not int or generation <= 0 or type(dispatch_id) is not str or not dispatch_id:
            raise BuilderExecutionPolicyError("native_dispatch_mismatch")
        authority = validate_private_read(self.loader, ref)
        if not authority.root_revision_matches:
            raise BuilderExecutionPolicyError("native_revision_drift")
        if authority.cancelled or not authority.active or authority.request_state not in {"running", "waiting"}:
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False)
            state = invocation_state(session, ref, owned.tenant_id)
            if (
                owned.ref != ref
                or (authority.tenant_id, authority.actor_id) != (owned.tenant_id, owned.actor_id)
                or (state.generation, authority.generation) != (generation, generation)
                or (state.app_id, state.workflow_id, state.context_object_id, state.parent_invocation_id)
                != (
                    authority.app_id,
                    authority.workflow_id,
                    authority.context_object_id,
                    authority.parent_invocation_id,
                )
            ):
                raise BuilderExecutionPolicyError("native_generation_conflict")
            dispatch_readiness(session, ref=ref, tenant_id=owned.tenant_id, now=self.clock())
            dispatch = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if (
                dispatch is None
                or dispatch.state != "claimed"
                or dispatch.generation != generation
                or dispatch.claim_expires_at is None
                or dispatch.claim_expires_at <= self.clock()
                or not dispatch.checkpoint_id
                or state.checkpoint_id != dispatch.checkpoint_id
            ):
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            saved = session.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == dispatch.checkpoint_id
                )
            )
            row = session.scalar(
                owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                    NativePayloadObject.id == dispatch.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                )
            )
            if (
                saved is None
                or row is None
                or type(saved.generation) is not int
                or not 0 <= saved.generation < generation
                or row.logical_key != str(saved.generation)
                or row.payload_digest != saved.payload_digest
                or not saved.payload_ref
                or row.storage_key != saved.payload_ref
            ):
                raise BuilderExecutionPolicyError("checkpoint_unavailable")
            try:
                return CheckpointRef(checkpoint_id=saved.checkpoint_id, payload_digest=saved.payload_digest)
            except ValueError:
                raise BuilderExecutionPolicyError("checkpoint_unavailable") from None

    def prepare_dispatch_claim(
        self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str
    ) -> PreparedNativeDispatchClaim | None:
        # Already-claimed/unknown deliveries can be rejected even after the
        # invocation has been quarantined. They acquire no execution authority.
        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False, settlement=True)
            prior = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if (
                prior is not None
                and prior.generation == generation
                and prior.state in {"claimed", "completed", "unknown"}
            ):
                return None
            require_ancestor_authority(session, ref, owned.tenant_id)
        self.loader.load(ref=ref)
        context = self.store.load_context(ref=ref)
        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False)
            observed = invocation_state(session, ref, owned.tenant_id)
            dispatch = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if dispatch is None or observed.checkpoint_id != dispatch.checkpoint_id:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            if generation == 0 and dispatch.generation == 0 and dispatch.checkpoint_id is None:
                if dispatch.idempotency_digest != canonical_digest({"initial": ref.model_dump(mode="json")}):
                    raise BuilderExecutionPolicyError("native_initial_conflict")
                self._validate_initial(
                    session,
                    owned,
                    self.loader._load(session, ref=ref, lock=False)[1],
                    context,
                    observed,
                    states={"queued"},
                )
                return PreparedNativeDispatchClaim(
                    ref, generation, dispatch_id, context, observed.context_object_id, None, None, {}
                )
            saved = session.scalar(
                owner_query(NativeContinuation, ref, owned.tenant_id).where(
                    NativeContinuation.checkpoint_id == dispatch.checkpoint_id
                )
            )
            if saved is None:
                raise BuilderExecutionPolicyError("checkpoint_unavailable")
            checkpoint = CheckpointRef(checkpoint_id=saved.checkpoint_id, payload_digest=saved.payload_digest)
        payload = self.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
        if payload.native_run_id != context.native_run_id:
            raise BuilderExecutionPolicyError("native_run_mismatch")
        selected = self._checkpoint_tree(ref, checkpoint, payload)
        return PreparedNativeDispatchClaim(ref, generation, dispatch_id, context, None, checkpoint, payload, selected)

    def consume_dispatch_claim(
        self, *, session: Session, owned: OwnedNativeTest, scope: NativeTestScope, prepared: PreparedNativeDispatchClaim
    ) -> bool:
        """SQL only; caller holds the request lock, and App first for physical admission."""
        ref, generation, dispatch_id = prepared.ref, prepared.generation, prepared.dispatch_id
        if owned.ref != ref:
            raise BuilderExecutionPolicyError("native_dispatch_mismatch")
        dispatch = session.scalar(
            owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
        )
        if dispatch is None or type(generation) is not int or generation != dispatch.generation:
            raise BuilderExecutionPolicyError("native_dispatch_mismatch")
        if dispatch.state not in {"queued", "published"}:
            return False
        # Recheck the full local chain in this transaction, without RPC or a new session.
        owned, scope = self.loader._load(session, ref=ref, lock=False)
        state = invocation_state(session, ref, owned.tenant_id)
        if generation == 0 and dispatch.checkpoint_id is None:
            if dispatch.idempotency_digest != canonical_digest({"initial": ref.model_dump(mode="json")}):
                raise BuilderExecutionPolicyError("native_initial_conflict")
            if state.context_object_id != prepared.context_object_id:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            if prepared.checkpoint is not None or prepared.payload is not None or prepared.selected:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            self._validate_initial(session, owned, scope, prepared.context, state, states={"queued"})
            state.state = "running"
            dispatch_readiness(session, ref=ref, tenant_id=owned.tenant_id, now=self.clock())
            dispatch.state, dispatch.claim_expires_at = "claimed", self.clock() + timedelta(minutes=10)
            state.cleanup_complete = False
            request = session.get(DifyBuilderExecutionRequest, ref.request_id)
            if request is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            request.state = "running"
            return True
        checkpoint, payload, selected = prepared.checkpoint, prepared.payload, prepared.selected
        if checkpoint is None or payload is None:
            raise BuilderExecutionPolicyError("checkpoint_unavailable")
        require_ancestor_authority(session, ref, owned.tenant_id)
        state = invocation_state(session, ref, owned.tenant_id)
        dispatch = session.scalar(
            owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
        )
        if dispatch is None or type(generation) is not int or generation != dispatch.generation:
            raise BuilderExecutionPolicyError("native_dispatch_mismatch")
        if dispatch.state not in {"queued", "published"}:
            return False
        if state.generation != generation or state.state != "queued" or owned.expires_at <= self.clock():
            raise BuilderExecutionPolicyError("native_generation_conflict")
        if has_unknown_descendant(session, ref, owned.tenant_id):
            raise BuilderExecutionPolicyError("native_subtree_unknown")
        if dispatch.checkpoint_id != checkpoint.checkpoint_id or payload.generation >= generation:
            raise BuilderExecutionPolicyError("native_dispatch_mismatch")
        represented = self._validate_checkpoints(session, owned, selected)
        generations = {identity: proof.payload.generation for identity, proof in selected.items()}
        resolutions = self._resolve_pending(session, owned, state, generations=generations)
        if [resolution.model_dump(mode="json") for resolution in resolutions] != state.resolution:
            raise BuilderExecutionPolicyError("native_pending_unresolved")
        self._validate_resolution_results(session, owned, resolutions)
        resolved_ids = set(state.pending_ids)
        reopened = [state]
        for child in self._subtree(session, ref, owned.tenant_id):
            if (
                child.invocation_id != ref.invocation_id
                and child.invocation_id in represented
                and child.generation == generation
                and child.state == "queued"
                and child.pending_ids
                and set(child.pending_ids) <= resolved_ids
            ):
                reopened.append(child)
        dispatch.state, dispatch.claim_expires_at = "claimed", self.clock() + timedelta(minutes=10)
        for current in reopened:
            current.state, current.wait_reason = "running", None
        for current in reopened:
            dispatch_readiness(
                session,
                ref=ref.model_copy(update={"invocation_id": current.invocation_id}),
                tenant_id=owned.tenant_id,
                now=self.clock(),
            )
        state.cleanup_complete = False
        self._request_row(session, ref.request_id).state = "running"
        return True

    def execute_dispatch(
        self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str
    ) -> NativeWorkflowOutcome | None:
        if self.runtime is None:
            raise BuilderExecutionPolicyError("native_runtime_unavailable")
        if self._dispatch_ref is not None and self._dispatch_ref != NativeDispatchRef(ref, generation, dispatch_id):
            raise BuilderExecutionPolicyError("native_dispatch_conflict")
        if self._capacity is not None and self._capacity._used:
            return None  # Exact already-used acquisition, including a terminal duplicate.
        # Validate/read recovery material before claiming. No fake completion or
        # ordinary-runtime fallback if a qualified collaborator is absent.
        context = self.store.load_context(ref=ref)
        checkpoint = None
        resolutions = ()
        if generation != 0:
            with self.loader.session_factory() as session:
                state = invocation_state(session, ref, context.tenant_id)
                row = session.scalar(
                    owner_query(NativeContinuation, ref, context.tenant_id).where(
                        NativeContinuation.checkpoint_id == state.checkpoint_id
                    )
                )
                if row is None:
                    raise BuilderExecutionPolicyError("checkpoint_unavailable")
                checkpoint_ref = CheckpointRef(checkpoint_id=row.checkpoint_id, payload_digest=row.payload_digest)
                resolutions = tuple(NativePendingResolution.model_validate(raw) for raw in state.resolution)
            checkpoint = self.store.read_checkpoint(ref=ref, checkpoint=checkpoint_ref)
        if not self.claim_dispatch(ref=ref, generation=generation, dispatch_id=dispatch_id):
            return None
        try:
            if generation == 0:
                outcome = self.runtime.run_initial(context=context)
            else:
                assert checkpoint is not None
                outcome = self.runtime.resume(context=context, checkpoint=checkpoint, resolutions=resolutions)
            outcome = NativeWorkflowOutcome.model_validate(outcome.model_dump(mode="json"))
            if outcome.ref != ref or outcome.native_run_id != context.native_run_id:
                raise BuilderExecutionPolicyError("native_outcome_mismatch")
            if outcome.status == "waiting":
                if outcome.checkpoint_ref is None:
                    raise BuilderExecutionPolicyError("native_outcome_mismatch")
                self.pause(
                    ref=ref,
                    checkpoint=outcome.checkpoint_ref,
                    pending_operation_ids=outcome.pending_operation_ids,
                    expected_generation=generation,
                )
            elif outcome.output_result_ref is not None:
                self.store.load_result(ref=ref, result_ref=outcome.output_result_ref)
            with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
                self.finalize_dispatch_locked(
                    session=session,
                    owned=owned,
                    scope=scope,
                    dispatch_id=dispatch_id,
                    generation=generation,
                    outcome=outcome,
                )
            return outcome
        except Exception:
            self._mark_unknown(ref=ref, dispatch_id=dispatch_id)
            raise

    def finalize_dispatch_locked(
        self,
        *,
        session: Session,
        owned: OwnedNativeTest,
        scope: NativeTestScope,
        dispatch_id: str,
        generation: int,
        outcome: NativeWorkflowOutcome,
    ) -> None:
        """SQL projection only, after caller's real outcome/checkpoint/result preparation."""
        ref = owned.ref
        if outcome.ref != ref:
            raise BuilderExecutionPolicyError("native_outcome_mismatch")
        if owned.state == "sealed" and outcome.status not in {"stopped", "unknown"}:
            raise BuilderExecutionPolicyError("native_request_sealed")
        state = invocation_state(session, ref, owned.tenant_id)
        dispatch = session.scalar(
            owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
        )
        if (
            dispatch is None
            or type(generation) is not int
            or dispatch.generation != generation
            or dispatch.state != "claimed"
            or state.generation != generation
            or scope.cancelled
        ):
            raise BuilderExecutionPolicyError("native_dispatch_conflict")
        if outcome.status == "waiting":
            checkpoint = outcome.checkpoint_ref
            if (
                checkpoint is None
                or state.state != "waiting"
                or state.checkpoint_id != checkpoint.checkpoint_id
                or tuple(state.pending_ids) != outcome.pending_operation_ids
                or state.wait_reason != outcome.wait_reason
                or session.scalar(
                    owner_query(NativeContinuation, ref, owned.tenant_id).where(
                        NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                        NativeContinuation.payload_digest == checkpoint.payload_digest,
                        NativeContinuation.generation == generation,
                    )
                )
                is None
            ):
                raise BuilderExecutionPolicyError("checkpoint_unavailable")
            self._pending_rows(session, owned, state)
        if outcome.output_result_ref is not None:
            from models.dify_builder_native_tests import NativePayloadObject

            if (
                session.scalar(
                    owner_query(NativePayloadObject, ref, owned.tenant_id).where(
                        NativePayloadObject.id == outcome.output_result_ref,
                        NativePayloadObject.kind == "result",
                    )
                )
                is None
            ):
                raise BuilderExecutionPolicyError("native_result_owner_mismatch")
        if outcome.status == "completed" and has_unknown_descendant(session, ref, owned.tenant_id):
            raise BuilderExecutionPolicyError("native_subtree_unknown")
        if outcome.status == "unknown":
            quarantine_unknown(session, ref=ref, tenant_id=owned.tenant_id, outcome=outcome.model_dump(mode="json"))
        else:
            dispatch.state = "completed"
        if outcome.status not in {"waiting", "unknown"}:
            state.state, state.outcome = outcome.status, outcome.model_dump(mode="json")
            invocation = session.scalar(owner_query(NativeTestInvocation, ref, owned.tenant_id))
            invocation.active = False
            if state.parent_invocation_id is None and outcome.status != "unknown":
                remaining = session.scalar(
                    select(NativeTestInvocation.id).where(
                        NativeTestInvocation.request_id == ref.request_id,
                        NativeTestInvocation.tenant_id == owned.tenant_id,
                        NativeTestInvocation.invocation_id != ref.invocation_id,
                        NativeTestInvocation.active.is_(True),
                    )
                )
                if remaining is not None:
                    raise BuilderExecutionPolicyError("native_children_running")
                self._request_row(session, ref.request_id).state = "sealed"

    def _mark_unknown(self, *, ref: NativeTestContextRef, dispatch_id: str) -> None:
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _):
            dispatch = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if dispatch is not None and dispatch.state == "claimed":
                dispatch.state = "unknown"
                state = invocation_state(session, ref, owned.tenant_id)
                if state.generation == dispatch.generation and state.state != "cancelled":
                    quarantine_unknown(session, ref=ref, tenant_id=owned.tenant_id)

    _subtree = staticmethod(invocation_subtree)

    def reconcile(self, *, limit: int = 100, request_id: str | None = None) -> int:
        with self.loader.session_factory() as session:
            query = (
                select(NativeDispatch, DifyBuilderExecutionRequest.context_digest)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeDispatch.request_id)
                .where(
                    NativeDispatch.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.loader.actor.account_id,
                    NativeDispatch.state == "claimed",
                    NativeDispatch.claim_expires_at <= self.clock(),
                )
            )
            if request_id is not None:
                query = query.where(NativeDispatch.request_id == request_id)
            rows = session.execute(query.limit(limit)).all()
        for row, digest in rows:
            self._mark_unknown(
                ref=NativeTestContextRef(
                    request_id=row.request_id, invocation_id=row.invocation_id, context_digest=digest
                ),
                dispatch_id=row.id,
            )
        with self.loader.session_factory() as session:
            cancellation_query = (
                select(NativeInvocationState.request_id)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeInvocationState.request_id)
                .where(
                    NativeInvocationState.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.loader.actor.account_id,
                    NativeInvocationState.cancellation_key.is_not(None),
                    NativeInvocationState.cleanup_complete.is_(False),
                )
                .distinct()
            )
            if request_id is not None:
                cancellation_query = cancellation_query.where(NativeInvocationState.request_id == request_id)
            cancelled = session.scalars(cancellation_query.limit(limit)).all()
        for request_id in cancelled:
            self.cancel(actor=self.loader.actor, request_id=request_id, idempotency_key="cleanup-reconcile")
        return len(rows) + len(cancelled)

    def recover_dispatch(self, *, ref: NativeTestContextRef, dispatch_id: str) -> None:
        """Require native fencing proof and current authority before restoring execution.

        Physical dispatch uncertainty cannot reopen a terminal business outcome.
        Recheck authority under the root lock after collecting external proof.
        """
        if self.runtime is None:
            raise BuilderExecutionPolicyError("native_runtime_unavailable")
        context = self.store.load_recovery_context(ref=ref)
        with self.loader.session_factory() as session:
            owned, scope = self.loader._load(session, ref=ref, lock=False, settlement=True)
            self._check_recovery_authority(session, ref, owned, scope)
            row = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            state = invocation_state(session, ref, owned.tenant_id)
            self._check_recovery_source(session, ref, owned, row, state)
        proof = self.runtime.recovery_evidence(context=context, dispatch_id=dispatch_id)
        if proof not in {"not_started", "stopped"}:
            raise BuilderExecutionPolicyError("native_recovery_unproven")
        recovery_lock = self._capacity.locked if self._capacity is not None else self.loader.locked
        with recovery_lock(ref=ref, settlement=True) as (session, owned, scope):
            row = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            state = invocation_state(session, ref, owned.tenant_id)
            self._check_recovery_authority(session, ref, owned, scope)
            if row is None or row.state != "unknown" or state.generation != row.generation:
                raise BuilderExecutionPolicyError("native_dispatch_conflict")
            self._check_recovery_source(session, ref, owned, row, state)
            row.state, row.claim_expires_at = "queued", None
            state.state = "queued"
            # Proof applies to the complete native execution subtree. Preserve
            # completed/unknown child outcomes and the prior waiting cursors.
            recoverable = recoverable_invocation_ids(self._subtree(session, ref, owned.tenant_id), ref.invocation_id)
            for invocation in session.scalars(
                select(NativeTestInvocation).where(
                    NativeTestInvocation.request_id == ref.request_id,
                    NativeTestInvocation.tenant_id == owned.tenant_id,
                    NativeTestInvocation.invocation_id.in_(recoverable),
                )
            ):
                invocation.active = True

    @staticmethod
    def _check_recovery_source(session, ref, owned, row, state):
        if (
            row is None
            or row.state != "unknown"
            or row.generation != state.generation
            or row.checkpoint_id != state.checkpoint_id
        ):
            raise BuilderExecutionPolicyError("native_recovery_unavailable")
        # Retained exact IDs survive the first claim. A later active fence or
        # checkpoint may replace that source; never guess it back into existence.
        validate_pending_history(session, ref=ref, tenant_id=owned.tenant_id, state=state, dispatch_states=("unknown",))

    def _check_recovery_authority(self, session, ref, owned, scope):
        if scope.cancelled or owned.expires_at <= self.clock() or owned.state not in {"running", "waiting"}:
            raise BuilderExecutionPolicyError("native_recovery_unavailable")
        if self._capacity is not None and not invocation_state(session, ref, owned.tenant_id).cleanup_complete:
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        require_ancestor_authority(session, ref, owned.tenant_id)
        state = invocation_state(session, ref, owned.tenant_id)
        if state.state in {"completed", "stopped", "cancelled"}:
            raise BuilderExecutionPolicyError("native_recovery_unavailable")

    def cancellation_receipt(
        self, *, session: Session, owned: OwnedNativeTest, scope: NativeTestScope
    ) -> CancellationReceipt:
        """Read current cancellation facts; physical ACK never settles a source.

        The existing request owner validates actor/session/app/workflow/context.
        Inspect all request history so foreign or missing rows cannot prove clean
        cancellation, and retain older unresolved local acquisitions.
        """
        ref = owned.ref
        # GET may already retain a pre-cancel version of these ORM identities.
        # Reselecting alone does not replace their cached attributes.
        states = session.scalars(
            select(NativeInvocationState)
            .where(NativeInvocationState.request_id == ref.request_id)
            .execution_options(populate_existing=True)
        ).all()
        invocations = session.scalars(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        ).all()
        sources = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == ref.request_id)).all()
        by_id = {row.invocation_id: row for row in states}
        complete = (
            bool(states)
            and len(by_id) == len(states) == len(invocations)
            and set(by_id) == {row.invocation_id for row in invocations}
            and all(
                (row.request_id, row.tenant_id) == (ref.request_id, owned.tenant_id) for row in (*states, *invocations)
            )
            and {row.invocation_id for row in states if row.parent_invocation_id is None} == {ref.invocation_id}
            and len(self._subtree(session, ref, owned.tenant_id)) == len(states)
        )
        for state in states:
            local_ref = ref.model_copy(update={"invocation_id": state.invocation_id})
            if (state.request_id, state.tenant_id) != (ref.request_id, owned.tenant_id):
                complete = False
                continue
            self.loader._load(session, ref=local_ref, lock=False, settlement=True)
            if not state.app_id or not state.workflow_id:
                complete = False
                continue
            validate_invocation_workflow(
                session, tenant_id=owned.tenant_id, app_id=state.app_id, workflow_id=state.workflow_id
            )
            context = session.scalar(
                owner_query(NativePayloadObject, local_ref, owned.tenant_id).where(
                    NativePayloadObject.id == state.context_object_id, NativePayloadObject.kind == "context"
                )
            )
            if (
                context is None
                or type(state.generation) is not int
                or not 0 <= state.generation <= scope.generation
                or (
                    state.parent_invocation_id is None
                    and (state.app_id, state.workflow_id) != (owned.app_id, owned.workflow_id)
                )
            ):
                complete = False
        source_states = []
        current_root = False
        for source in sources:
            state = by_id.get(source.invocation_id)
            if (
                (source.request_id, source.tenant_id) != (ref.request_id, owned.tenant_id)
                or state is None
                or (state.request_id, state.tenant_id) != (ref.request_id, owned.tenant_id)
                or type(source.generation) is not int
                or type(state.generation) is not int
                or not 0 <= source.generation <= state.generation
            ):
                complete = False
                continue
            source_states.append(source.state)
            if source.invocation_id == ref.invocation_id and source.generation == state.generation:
                current_root = True
            if source.state == "cancelled" and (
                source.generation != 0
                or source.checkpoint_id is not None
                or source.claim_expires_at is not None
                or source.idempotency_digest
                != canonical_digest(
                    {"initial": ref.model_copy(update={"invocation_id": source.invocation_id}).model_dump(mode="json")}
                )
            ):
                complete = False
        complete = complete and current_root
        operation_states: dict[str, Outcome] = {}
        for operation in session.scalars(
            select(NativeEffectOperation).where(
                NativeEffectOperation.request_id == ref.request_id, NativeEffectOperation.tenant_id == owned.tenant_id
            )
        ):
            if operation.invocation_id not in by_id:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            operation_states[operation.id] = cast(
                Outcome,
                "unknown"
                if operation.state in {"claimed", "unknown"}
                else "not_dispatched"
                if operation.state in {"pending", "denied", "cancelled"}
                else operation.state,
            )
        status = (
            "unknown"
            if "unknown" in operation_states.values() or "unknown" in source_states
            else "cancelled"
            if complete
            and all(row.cleanup_complete for row in states)
            and all(value in {"completed", "cancelled"} for value in source_states)
            else "cancelling"
        )
        return CancellationReceipt(
            request_id=ref.request_id, generation=scope.generation, status=status, operation_states=operation_states
        )

    def cancel(self, *, actor: Actor, request_id: str, idempotency_key: str) -> CancellationReceipt:
        ref = self._root_ref(actor, request_id)
        digest = self._idempotency("cancel", idempotency_key)
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
            scope.cancelled = True
            states = session.scalars(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == request_id, NativeInvocationState.tenant_id == owned.tenant_id
                )
            ).all()
            refs = tuple(
                ref.model_copy(update={"invocation_id": state.invocation_id})
                for state in states
                if not state.cleanup_complete
            )
            for state in states:
                state.state, state.cancellation_key = "cancelled", state.cancellation_key or digest
            for invocation in session.scalars(
                select(NativeTestInvocation).where(
                    NativeTestInvocation.request_id == request_id, NativeTestInvocation.tenant_id == owned.tenant_id
                )
            ):
                invocation.active = False
            for dispatch in session.scalars(
                select(NativeDispatch).where(
                    NativeDispatch.request_id == request_id,
                    NativeDispatch.tenant_id == owned.tenant_id,
                    NativeDispatch.state.in_(("queued", "published")),
                )
            ):
                dispatch.state = "cancelled"
            for operation in session.scalars(
                select(NativeEffectOperation).where(
                    NativeEffectOperation.request_id == request_id, NativeEffectOperation.tenant_id == owned.tenant_id
                )
            ):
                if operation.state in {"pending", "denied", "cancelled"}:
                    operation.state = "not_dispatched"
        stopped = set()
        if self.runtime is not None:
            try:
                stopped = set(self.runtime.cancel(refs=refs))
            except Exception:
                stopped = set()  # cancellation remains durable; cleanup can be retried
        if self._capacity is not None:
            try:
                self._capacity.record_cancelled_cleanup(ref=ref)
            except Exception:
                stopped = set()  # No verified cleanup acknowledgement; keep its slot quarantined.
        if self.cancellation_settlement is not None:
            try:
                self.cancellation_settlement.finish_unacquired(ref=ref)
            except Exception:
                stopped = set()  # Missing/ambiguous history grants no physical cleanup ACK.
        cleanup_lock = self._capacity.locked if self._capacity is not None else self.loader.locked
        with cleanup_lock(ref=ref, settlement=True) as (session, owned, scope):
            states = session.scalars(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == request_id, NativeInvocationState.tenant_id == owned.tenant_id
                )
            ).all()
            for state in states:
                if self._capacity is None and self.cancellation_settlement is None and state.invocation_id in stopped:
                    state.cleanup_complete = True
            receipt = self.cancellation_receipt(session=session, owned=owned, scope=scope)
            if receipt.status == "cancelled":
                self._request_row(session, request_id).state = "sealed"
        return receipt
