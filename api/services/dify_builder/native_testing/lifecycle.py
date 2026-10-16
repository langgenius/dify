"""Durable native wait/resume/cancel owner; no competing workflow executor.

SQL request locks serialize shared generations. Queue delivery may repeat; a
claimed dispatch never restarts on a Redis timeout or a missing queue ack.
Qualified native adapters must supply actual execution/termination evidence.
"""

from collections.abc import Callable
from dataclasses import dataclass
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
from services.dify_builder.native_testing.private_reads import validate_invocation_workflow, validate_private_read
from services.dify_builder.native_testing.repository import (
    OwnedNativeTest,
    OwnedNativeTestLoader,
    native_workflow_revision,
    utc_now,
)
from services.dify_builder.native_testing.runtime_contracts import (
    NativeCheckpointPayload,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
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


@dataclass(frozen=True)
class _ResumeCheckpoint:
    """Private acknowledged selection read outside the writer, rechecked inside."""

    ref: NativeTestContextRef
    checkpoint: CheckpointRef
    payload: NativeCheckpointPayload
    pending_ids: tuple[str, ...]
    observed_generation: int


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
            if native_workflow_revision(workflow) != authority.graph_revision:
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
                pending_owned, _ = self.loader._load(session, ref=pending_ref, lock=False)
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
        selected = self._checkpoint_tree(ref, checkpoint, recovered)
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
            resolutions = self._resolve_pending(session, owned, state, generations=generations)
            self._validate_resolution_results(session, owned, resolutions)
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
        with self.loader.locked(ref=ref) as (session, owned, _):
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
                if outcome.status == "completed" and has_unknown_descendant(session, ref, owned.tenant_id):
                    raise BuilderExecutionPolicyError("native_subtree_unknown")
                if outcome.status == "unknown":
                    quarantine_unknown(
                        session, ref=ref, tenant_id=owned.tenant_id, outcome=outcome.model_dump(mode="json")
                    )
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
                    quarantine_unknown(session, ref=ref, tenant_id=owned.tenant_id)

    _subtree = staticmethod(invocation_subtree)

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
        with self.loader.locked(ref=ref, settlement=True) as (session, owned, scope):
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
        require_ancestor_authority(session, ref, owned.tenant_id)
        state = invocation_state(session, ref, owned.tenant_id)
        if state.state in {"completed", "stopped", "cancelled"}:
            raise BuilderExecutionPolicyError("native_recovery_unavailable")

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
