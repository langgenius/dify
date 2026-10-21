"""Trusted native root capacity; App lock precedes the existing request lock.

No ordinary workflow limiter, physical host, provider I/O or default cleanup proof.
"""

from contextlib import contextmanager
from typing import Protocol, runtime_checkable

from sqlalchemy import and_, select

from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
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
from models.model import App
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.state_store import invocation_state, owner_query


@runtime_checkable
class NativeHostCleanupVerifier(Protocol):
    def consume_cleanup(self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> None:
        """Consume exact retained acquisition's genuine complete cleanup once.

        Immutable per-lifetime binding; reject if this lifetime is not CURRENT,
        even after SAME dispatch ID/generation reacquisition. No handle absence,
        caller DTO/boolean, lease or runtime.cancel list substitutes for proof.
        Invoked outside the writer. Missing/old/replayed/uncertain proof raises.
        """
        ...


class NativeHostCapacity:
    def __init__(
        self, lifecycle: NativeTestLifecycleService, *, cleanup_verifier: NativeHostCleanupVerifier, code_cleanup=None
    ):
        if not isinstance(cleanup_verifier, NativeHostCleanupVerifier) or not callable(
            cleanup_verifier.consume_cleanup
        ):
            raise BuilderExecutionPolicyError("native_cleanup_verifier_required")
        if lifecycle._capacity is not None:
            raise BuilderExecutionPolicyError("native_capacity_already_bound")
        self.lifecycle, self.loader, self._verifier = lifecycle, lifecycle.loader, cleanup_verifier
        # Absent for the existing HTTP-only runtime: do not query Code storage.
        self._code_cleanup = code_cleanup
        self._used = False
        lifecycle._capacity = self

    @contextmanager
    def locked(self, *, ref: NativeTestContextRef, settlement: bool = False):
        with locked_native_capacity(self.lifecycle, ref=ref, settlement=settlement) as result:
            yield result

    def _occupants(self, session, owned):
        request_model, dispatch_model, state_model, invocation_model, scope_model = (
            DifyBuilderExecutionRequest,
            NativeDispatch,
            NativeInvocationState,
            NativeTestInvocation,
            NativeTestScope,
        )
        rows = session.execute(
            select(
                request_model,
                dispatch_model,
                state_model,
                invocation_model,
                scope_model,
                DifyBuilderSession,
                DifyBuilderTestInput,
            )
            .select_from(request_model)
            .outerjoin(dispatch_model, dispatch_model.request_id == request_model.id)
            .outerjoin(
                state_model,
                and_(
                    state_model.request_id == request_model.id,
                    state_model.invocation_id == dispatch_model.invocation_id,
                ),
            )
            .outerjoin(
                invocation_model,
                and_(
                    invocation_model.request_id == request_model.id,
                    invocation_model.invocation_id == dispatch_model.invocation_id,
                ),
            )
            .outerjoin(scope_model, scope_model.request_id == request_model.id)
            .outerjoin(DifyBuilderSession, DifyBuilderSession.id == request_model.session_id)
            .outerjoin(DifyBuilderTestInput, DifyBuilderTestInput.id == request_model.test_input_id)
            .where(request_model.app_id == owned.app_id, request_model.tenant_id == owned.tenant_id)
        ).all()
        roots = set()
        for request, dispatch, state, invocation, scope, builder, inputs in rows:
            if dispatch is None or dispatch.state not in {"claimed", "unknown", "completed"}:
                continue
            if (
                (dispatch.request_id, dispatch.tenant_id) != (request.id, request.tenant_id)
                or state is None
                or invocation is None
                or scope is None
                or (state.request_id, state.tenant_id, state.invocation_id)
                != (request.id, request.tenant_id, dispatch.invocation_id)
                or (invocation.request_id, invocation.tenant_id, invocation.invocation_id)
                != (request.id, request.tenant_id, dispatch.invocation_id)
                or (scope.request_id, scope.tenant_id) != (request.id, request.tenant_id)
            ):
                raise BuilderExecutionPolicyError("native_capacity_owner_mismatch")
            if state.parent_invocation_id is not None:
                continue  # Actual host children are a separately gated physical owner.
            if (
                (state.request_id, state.tenant_id, state.app_id, state.workflow_id)
                != (request.id, request.tenant_id, request.app_id, request.workflow_id)
                or not isinstance(request.context, dict)
                or request.context.get("policy_version") != "builder-native-test-v1"
                or canonical_digest(request.context) != request.context_digest
            ):
                raise BuilderExecutionPolicyError("native_capacity_owner_mismatch")
            if state.cleanup_complete:
                continue
            if (
                invocation is None
                or scope is None
                or builder is None
                or inputs is None
                or (builder.tenant_id, builder.app_id, builder.owner_account_id, inputs.session_id)
                != (request.tenant_id, request.app_id, request.actor_id, request.session_id)
            ):
                raise BuilderExecutionPolicyError("native_capacity_owner_mismatch")
            roots.add((request.id, state.invocation_id))
        return roots

    def claim_dispatch(self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> bool:
        if self._used:
            return False
        prepared = self.lifecycle.prepare_dispatch_claim(ref=ref, generation=generation, dispatch_id=dispatch_id)
        if prepared is None:
            return False
        with self.locked(ref=ref, settlement=True) as (session, owned, scope):
            if self._used:
                return False
            current = session.scalar(
                owner_query(NativeDispatch, ref, owned.tenant_id).where(NativeDispatch.id == dispatch_id)
            )
            if current is None or type(generation) is not int or current.generation != generation:
                raise BuilderExecutionPolicyError("native_dispatch_mismatch")
            if current.state not in {"queued", "published"}:
                return False
            if self._occupants(session, owned):
                raise BuilderExecutionPolicyError("native_capacity_busy")
            self._used = True  # An ambiguous claim cannot reuse this physical lifetime.
            return self.lifecycle.consume_dispatch_claim(session=session, owned=owned, scope=scope, prepared=prepared)

    @staticmethod
    def _latest_acquired(session, ref, tenant_id):
        rows = session.scalars(
            owner_query(NativeDispatch, ref, tenant_id).where(
                NativeDispatch.state.in_(("claimed", "unknown", "completed"))
            )
        ).all()
        return max(rows, key=lambda row: row.generation) if rows else None

    def record_cleanup(self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> None:
        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False, settlement=True)
            state = invocation_state(session, ref, owned.tenant_id)
            selected = self._latest_acquired(session, ref, owned.tenant_id)
            self._validate_cleanup(state, selected, generation, dispatch_id)
            if self._code_cleanup is not None:
                self._code_cleanup.validate_cleanup_rows(
                    session=session, ref=ref, tenant_id=owned.tenant_id, dispatch_id=dispatch_id, generation=generation
                )
        # This verifier is immutable and bound to ONE actual physical lifetime,
        # never a registry lookup that selects a newer lifetime by these IDs.
        if self._verifier.consume_cleanup(ref=ref, generation=generation, dispatch_id=dispatch_id) is not None:
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        with self.locked(ref=ref, settlement=True) as (session, owned, _):
            state = invocation_state(session, ref, owned.tenant_id)
            selected = self._latest_acquired(session, ref, owned.tenant_id)
            self._validate_cleanup(state, selected, generation, dispatch_id)
            if self._code_cleanup is not None:
                self._code_cleanup.validate_cleanup_rows(
                    session=session, ref=ref, tenant_id=owned.tenant_id, dispatch_id=dispatch_id, generation=generation
                )
            for current in self.lifecycle._subtree(session, ref, owned.tenant_id):
                current.cleanup_complete = True

    @staticmethod
    def _validate_cleanup(state, selected, generation, dispatch_id):
        if (
            type(generation) is not int
            or state.parent_invocation_id is not None
            or state.generation < generation
            or state.cleanup_complete
            or selected is None
            or (selected.id, selected.generation) != (dispatch_id, generation)
        ):
            raise BuilderExecutionPolicyError("native_cleanup_unproven")

    def _finish_unacquired_cancellation(self, *, ref: NativeTestContextRef) -> bool:
        return finish_unacquired_cancellation(self.lifecycle, ref=ref)

    def record_cancelled_cleanup(self, *, ref: NativeTestContextRef) -> None:
        if self._finish_unacquired_cancellation(ref=ref):
            return
        with self.loader.session_factory() as session:
            owned, _ = self.loader._load(session, ref=ref, lock=False, settlement=True)
            selected = self._latest_acquired(session, ref, owned.tenant_id)
            if selected is None:
                return  # No physical claim is inferred from a cancelled queue row.
            identity, generation = selected.id, selected.generation
        self.record_cleanup(ref=ref, generation=generation, dispatch_id=identity)


@contextmanager
def locked_native_capacity(lifecycle, *, ref: NativeTestContextRef, settlement: bool = False):
    # Read just the persisted App identity before starting the App-first writer.
    with lifecycle.loader.session_factory() as session:
        owned, _ = lifecycle.loader._load(session, ref=ref, lock=False, settlement=settlement)
        app_id, tenant_id = owned.app_id, owned.tenant_id
    with lifecycle.loader.session_factory.begin() as session:
        app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
        if app is None:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        owned, scope = lifecycle.loader._load(session, ref=ref, lock=True, settlement=settlement)
        state = invocation_state(session, ref, owned.tenant_id)
        if (
            state.parent_invocation_id is not None
            or (owned.app_id, owned.tenant_id) != (app_id, tenant_id)
            or (state.app_id, state.workflow_id) != (owned.app_id, owned.workflow_id)
        ):
            raise BuilderExecutionPolicyError("native_capacity_root_required")
        yield session, owned, scope


def finish_unacquired_cancellation(lifecycle, *, ref: NativeTestContextRef) -> bool:
    # Authoritative SQL history under App→request, never local handle absence.
    with locked_native_capacity(lifecycle, ref=ref, settlement=True) as (session, owned, scope):
        states = session.scalars(
            select(NativeInvocationState).where(NativeInvocationState.request_id == ref.request_id)
        ).all()
        invocations = session.scalars(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        ).all()
        dispatches = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == ref.request_id)).all()
        identities = {row.invocation_id for row in states}
        if (
            not scope.cancelled
            or not states
            or len(identities) != len(states)
            or identities != {row.invocation_id for row in invocations}
            or len(invocations) != len(states)
            or any(
                (row.request_id, row.tenant_id) != (ref.request_id, owned.tenant_id)
                for row in (*states, *invocations, *dispatches)
            )
            or any(row.state != "cancelled" or not row.cancellation_key for row in states)
            or any(row.active for row in invocations)
            or any(row.invocation_id not in identities for row in dispatches)
        ):
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        if any(row.state in {"claimed", "unknown", "completed"} for row in dispatches):
            return False  # The exact retained-lifetime verifier remains mandatory.
        # Only a complete genuine initial outbox proves never acquired here.
        # Missing history, children, resumed/effectful work remain uncertain.
        state = states[0]
        if (
            len(states) != 1
            or state.invocation_id != ref.invocation_id
            or state.parent_invocation_id is not None
            or type(state.generation) is not int
            or state.generation != 0
            or scope.generation != 0
            or state.checkpoint_id is not None
            or state.pending_ids != []
            or state.wait_reason is not None
            or state.resolution != []
            or state.outcome is not None
            or len(dispatches) != 1
            or dispatches[0].state != "cancelled"
            or dispatches[0].generation != 0
            or dispatches[0].checkpoint_id is not None
            or dispatches[0].claim_expires_at is not None
            or dispatches[0].idempotency_digest != canonical_digest({"initial": ref.model_dump(mode="json")})
        ):
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        context = session.get(NativePayloadObject, state.context_object_id)
        if context is None or (context.request_id, context.tenant_id, context.invocation_id, context.kind) != (
            ref.request_id,
            owned.tenant_id,
            ref.invocation_id,
            "context",
        ):
            raise BuilderExecutionPolicyError("native_cleanup_unproven")
        for model in (
            NativeContinuation,
            NativeEffectOperation,
            NativeEffectAttempt,
            NativeEffectDispatchClaim,
            NativeEffectOutcome,
        ):
            if session.scalar(select(model.id).where(model.request_id == ref.request_id)) is not None:
                raise BuilderExecutionPolicyError("native_cleanup_unproven")
        state.cleanup_complete = True  # Logical cancellation; no physical acquisition was inferred.
        return True
