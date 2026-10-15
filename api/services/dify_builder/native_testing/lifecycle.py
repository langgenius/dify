"""Durable native wait/resume/cancel owner; no competing workflow executor.

SQL request locks serialize shared generations. Queue delivery may repeat; a
claimed dispatch never restarts on a Redis timeout or a missing queue ack.
Qualified native adapters must supply actual execution/termination evidence.
"""

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Literal, Protocol, Self

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
    NativePendingAction,
    NativeTestInvocation,
)
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import (
    ID,
    CancellationReceipt,
    CheckpointRef,
    FrozenDTO,
    NativeTestContextRef,
    ResumeReceipt,
    WaitingReceipt,
)
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader, utc_now
from services.dify_builder.native_testing.runtime_contracts import (
    NativeCheckpointPayload,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore, invocation_state, owner_query


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


class NativeRuntimePort(Protocol):
    def resume(
        self,
        *,
        context: ResolvedNativeTestContext,
        checkpoint: NativeCheckpointPayload,
        resolutions: tuple[NativePendingResolution, ...],
    ) -> NativeWorkflowOutcome: ...
    def cancel(self, *, refs: tuple[NativeTestContextRef, ...]) -> tuple[str, ...]:
        """Return only invocation IDs proven physically stopped by their native owners."""
        ...

    def recovery_evidence(
        self, *, context: ResolvedNativeTestContext, dispatch_id: str
    ) -> Literal["not_started", "stopped", "unknown"]:
        """Fence the complete native subtree, never infer proof from a lease timeout.

        'stopped' proves neither the old root nor any child execution can continue.
        """
        ...


class NativeTestLifecycleService:
    def __init__(
        self,
        loader: OwnedNativeTestLoader,
        *,
        state_store: NativeExecutionStateStore,
        resolution: NativePendingResolutionPort | None = None,
        runtime: NativeRuntimePort | None = None,
        clock: Callable[[], datetime] = utc_now,
    ):
        self.loader, self.store, self.resolution, self.runtime, self.clock = (
            loader,
            state_store,
            resolution,
            runtime,
            clock,
        )

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

    def pause(
        self,
        *,
        ref: NativeTestContextRef,
        checkpoint: CheckpointRef,
        pending_operation_ids: tuple[str, ...],
        expected_generation: int,
    ) -> WaitingReceipt:
        payload = self.store.read_checkpoint(ref=ref, checkpoint=checkpoint)
        if not pending_operation_ids or len(set(pending_operation_ids)) != len(pending_operation_ids):
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
            child_pending = set()
            for child_ref in payload.child_refs:
                child_state = invocation_state(session, child_ref, owned.tenant_id)
                if child_state.parent_invocation_id != ref.invocation_id:
                    raise BuilderExecutionPolicyError("native_child_owner_mismatch")
                if child_state.state == "waiting":
                    if child_state.checkpoint_id is None:
                        raise BuilderExecutionPolicyError("native_child_wait_uncommitted")
                    child_pending.update(child_state.pending_ids)
            rows = session.scalars(
                select(NativePendingAction).where(
                    NativePendingAction.tenant_id == owned.tenant_id,
                    NativePendingAction.request_id == ref.request_id,
                    NativePendingAction.id.in_(pending_operation_ids),
                )
            ).all()
            if len(rows) != len(pending_operation_ids) or any(
                row.id not in child_pending
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
            reason = next(reason for reason in ("configuration", "interaction", "approval") if reason in reasons)
            state.state, state.checkpoint_id = "waiting", checkpoint.checkpoint_id
            state.pending_ids, state.wait_reason = list(pending_operation_ids), reason
            session.get(DifyBuilderExecutionRequest, ref.request_id).state = "waiting"
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

    def _resolve_pending(self, session, owned, state) -> list[NativePendingResolution]:
        resolutions = []
        for identity in state.pending_ids:
            pending = session.scalar(
                select(NativePendingAction).where(
                    NativePendingAction.tenant_id == owned.tenant_id,
                    NativePendingAction.request_id == owned.ref.request_id,
                    NativePendingAction.id == identity,
                )
            )
            if pending is None:
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            pending_ref = owned.ref.model_copy(update={"invocation_id": pending.invocation_id})
            pending_owned, _ = self.loader._load(session, ref=pending_ref, lock=False)
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

    def resume(self, *, actor: Actor, request_id: str, expected_generation: int, idempotency_key: str) -> ResumeReceipt:
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
                if type(expected_generation) is not int or previous.generation != expected_generation + 1:
                    raise BuilderExecutionPolicyError("native_generation_conflict")
                return self._receipt(previous)
            state = invocation_state(session, ref, owned.tenant_id)
            if (
                type(expected_generation) is not int
                or expected_generation != scope.generation
                or expected_generation != state.generation
            ):
                raise BuilderExecutionPolicyError("native_generation_conflict")
            if state.state != "waiting" or state.checkpoint_id != checkpoint.checkpoint_id:
                raise BuilderExecutionPolicyError("native_state_conflict")
            resolutions = self._resolve_pending(session, owned, state)
            # Answer reference provenance is checked in SQL here; payload is read
            # outside this transaction by the runtime/state owner.
            from models.dify_builder_native_tests import NativePayloadObject

            for resolution in resolutions:
                if (
                    resolution.answer_result_ref is not None
                    and session.scalar(
                        owner_query(
                            NativePayloadObject,
                            ref.model_copy(update={"invocation_id": resolution.invocation_id}),
                            owned.tenant_id,
                        ).where(
                            NativePayloadObject.id == resolution.answer_result_ref, NativePayloadObject.kind == "result"
                        )
                    )
                    is None
                ):
                    raise BuilderExecutionPolicyError("native_result_owner_mismatch")
            scope.generation += 1
            # Advance precisely the waiting descendants represented by this
            # parent's committed wait. Other branches retain their own cursors.
            resolved_ids = set(state.pending_ids)
            for child in self._subtree(session, ref, owned.tenant_id):
                if (
                    child.invocation_id != ref.invocation_id
                    and child.state == "waiting"
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

    def publish_pending(self, *, publish: Callable[..., None], limit: int = 100) -> int:
        """Every unclaimed outbox remains retryable, including lost broker acknowledgements."""
        with self.loader.session_factory() as session:
            rows = session.execute(
                select(NativeDispatch, DifyBuilderExecutionRequest.context_digest)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeDispatch.request_id)
                .where(
                    NativeDispatch.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.loader.actor.account_id,
                    NativeDispatch.state.in_(("queued", "published")),
                )
                .order_by(NativeDispatch.id)
                .limit(limit)
            ).all()
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
                if row.state == "queued":
                    row.state = "published"
            published += 1
        return published

    def claim_dispatch(self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> bool:
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
                return False
        self.loader.load(ref=ref)
        with self.loader.locked(ref=ref) as (session, owned, _):
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
            dispatch.state, dispatch.claim_expires_at = "claimed", self.clock() + timedelta(minutes=10)
            state.state = "running"
            for child in self._subtree(session, ref, owned.tenant_id):
                if child.generation == generation and child.state == "queued":
                    child.state = "running"
            session.get(DifyBuilderExecutionRequest, ref.request_id).state = "running"
        return True

    def execute_dispatch(
        self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str
    ) -> NativeWorkflowOutcome | None:
        if self.runtime is None:
            raise BuilderExecutionPolicyError("native_runtime_unavailable")
        # Validate/read recovery material before claiming. No fake completion or
        # ordinary-runtime fallback if a qualified collaborator is absent.
        context = self.store.load_context(ref=ref)
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
            outcome = self.runtime.resume(context=context, checkpoint=checkpoint, resolutions=resolutions)
            outcome = NativeWorkflowOutcome.model_validate(outcome.model_dump(mode="json"))
            if outcome.ref != ref or outcome.native_run_id != context.native_run_id:
                raise BuilderExecutionPolicyError("native_outcome_mismatch")
            if outcome.status == "waiting":
                self.pause(
                    ref=ref,
                    checkpoint=outcome.checkpoint_ref,
                    pending_operation_ids=outcome.pending_operation_ids,
                    expected_generation=generation,
                )
            elif outcome.output_result_ref is not None:
                self.store.load_result(ref=ref, result_ref=outcome.output_result_ref)
            with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
                state = invocation_state(session, ref, owned.tenant_id)
                dispatch = session.get(NativeDispatch, dispatch_id)
                if dispatch.state != "claimed" or state.generation != generation or scope.cancelled:
                    raise BuilderExecutionPolicyError("native_dispatch_conflict")
                dispatch.state = "completed" if outcome.status != "unknown" else "unknown"
                if outcome.status != "waiting":
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
                        session.get(DifyBuilderExecutionRequest, ref.request_id).state = "sealed"
            return outcome
        except Exception:
            self._mark_unknown(ref=ref, dispatch_id=dispatch_id)
            raise

    def _mark_unknown(self, *, ref: NativeTestContextRef, dispatch_id: str) -> None:
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _):
            dispatch = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if dispatch is not None and dispatch.state == "claimed":
                dispatch.state = "unknown"
                state = invocation_state(session, ref, owned.tenant_id)
                if state.generation == dispatch.generation and state.state != "cancelled":
                    state.state = "unknown"
                    child_ids = {row.invocation_id for row in self._subtree(session, ref, owned.tenant_id)}
                    for invocation in session.scalars(
                        select(NativeTestInvocation).where(
                            NativeTestInvocation.request_id == ref.request_id,
                            NativeTestInvocation.tenant_id == owned.tenant_id,
                            NativeTestInvocation.invocation_id.in_(child_ids),
                        )
                    ):
                        invocation.active = False

    @staticmethod
    def _subtree(session, ref, tenant_id):
        states = session.scalars(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == ref.request_id, NativeInvocationState.tenant_id == tenant_id
            )
        ).all()
        ids = {ref.invocation_id}
        while True:
            expanded = ids | {state.invocation_id for state in states if state.parent_invocation_id in ids}
            if expanded == ids:
                return [state for state in states if state.invocation_id in ids]
            ids = expanded

    def reconcile(self, *, limit: int = 100) -> int:
        with self.loader.session_factory() as session:
            rows = session.execute(
                select(NativeDispatch, DifyBuilderExecutionRequest.context_digest)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeDispatch.request_id)
                .where(
                    NativeDispatch.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.loader.actor.account_id,
                    NativeDispatch.state == "claimed",
                    NativeDispatch.claim_expires_at <= self.clock(),
                )
                .limit(limit)
            ).all()
        for row, digest in rows:
            self._mark_unknown(
                ref=NativeTestContextRef(
                    request_id=row.request_id, invocation_id=row.invocation_id, context_digest=digest
                ),
                dispatch_id=row.id,
            )
        with self.loader.session_factory() as session:
            cancelled = session.scalars(
                select(NativeInvocationState.request_id)
                .join(DifyBuilderExecutionRequest, DifyBuilderExecutionRequest.id == NativeInvocationState.request_id)
                .where(
                    NativeInvocationState.tenant_id == self.loader.actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == self.loader.actor.account_id,
                    NativeInvocationState.cancellation_key.is_not(None),
                    NativeInvocationState.cleanup_complete.is_(False),
                )
                .distinct()
                .limit(limit)
            ).all()
        for request_id in cancelled:
            self.cancel(actor=self.loader.actor, request_id=request_id, idempotency_key="cleanup-reconcile")
        return len(rows) + len(cancelled)

    def recover_dispatch(self, *, ref: NativeTestContextRef, dispatch_id: str) -> None:
        """Explicit safe recovery requires native owner fencing evidence, not lease expiry."""
        if self.runtime is None:
            raise BuilderExecutionPolicyError("native_runtime_unavailable")
        context = self.store.load_recovery_context(ref=ref)
        proof = self.runtime.recovery_evidence(context=context, dispatch_id=dispatch_id)
        if proof not in {"not_started", "stopped"}:
            raise BuilderExecutionPolicyError("native_recovery_unproven")
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
            row = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            state = invocation_state(session, ref, owned.tenant_id)
            if scope.cancelled or owned.expires_at <= self.clock():
                raise BuilderExecutionPolicyError("native_recovery_unavailable")
            if row is None or row.state != "unknown" or state.generation != row.generation:
                raise BuilderExecutionPolicyError("native_dispatch_conflict")
            row.state, row.claim_expires_at = "queued", None
            state.state = "queued"
            # Proof applies to the complete native execution subtree. Preserve
            # completed/unknown child outcomes and the prior waiting cursors.
            recoverable = {
                child.invocation_id
                for child in self._subtree(session, ref, owned.tenant_id)
                if child.state in {"running", "waiting", "queued"}
            }
            for invocation in session.scalars(
                select(NativeTestInvocation).where(
                    NativeTestInvocation.request_id == ref.request_id,
                    NativeTestInvocation.tenant_id == owned.tenant_id,
                    NativeTestInvocation.invocation_id.in_(recoverable),
                )
            ):
                invocation.active = True

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
            operation_states = {}
            for operation in session.scalars(
                select(NativeEffectOperation).where(
                    NativeEffectOperation.request_id == request_id, NativeEffectOperation.tenant_id == owned.tenant_id
                )
            ):
                if operation.state in {"pending", "denied", "cancelled"}:
                    operation.state = "not_dispatched"
                operation_states[operation.id] = "unknown" if operation.state == "claimed" else operation.state
            generation = scope.generation
        stopped = set()
        if self.runtime is not None:
            try:
                stopped = set(self.runtime.cancel(refs=refs))
            except Exception:
                stopped = set()  # cancellation remains durable; cleanup can be retried
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, _):
            states = session.scalars(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == request_id, NativeInvocationState.tenant_id == owned.tenant_id
                )
            ).all()
            for state in states:
                if state.invocation_id in stopped:
                    state.cleanup_complete = True
            cleaned = all(state.cleanup_complete for state in states)
            if cleaned and "unknown" not in operation_states.values():
                session.get(DifyBuilderExecutionRequest, request_id).state = "sealed"
        status = "unknown" if "unknown" in operation_states.values() else "cancelled" if cleaned else "cancelling"
        return CancellationReceipt(
            request_id=request_id, generation=generation, status=status, operation_states=operation_states
        )
