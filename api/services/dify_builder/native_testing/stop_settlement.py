"""Evidence-only authority for one retained, acknowledged native policy STOP.

The seal revokes execution authority. It does not revoke this exact acquisition's
ability to finish protected diagnostics and prove physical cleanup. This owner
never admits execution, reads checkpoints, acknowledges cleanup or finalizes SQL.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from threading import Condition, local
from time import monotonic
from typing import TYPE_CHECKING

from sqlalchemy import select

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from services.dify_builder.execution_contracts import canonical_digest
from services.dify_builder.native_testing.control import NativeControlRecord, NativePolicyStop
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.state_store import invocation_state, owner_query

if TYPE_CHECKING:
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch


class NativeEvidenceReadGate:
    """Drain active evidence reads before seal; wait for exact ACK afterward.

    The condition protects counters only. No private reads, SQL or callbacks run
    under it. Nested diagnostic validators share their outer read lease, so a
    concurrent STOP cannot strand an inner read behind its own outer lease.
    """

    def __init__(self, host: NativeHostLaunch) -> None:
        self._host = host
        self._condition = Condition()
        self._local = local()
        self._readers = 0
        self._record: NativeControlRecord | None = None
        self._deadline: float | None = None
        self._acknowledged: bool | None = None

    def _wait(self) -> None:
        if self._deadline is None:
            raise ValueError("native_stop_settlement_unavailable")
        remaining = self._deadline - monotonic()
        if remaining <= 0:
            raise ValueError("native_stop_settlement_late")
        # BoundaryOwner accepts after the sink returns. Its assignment has no
        # callback/notification; bounded observation cannot block that return.
        self._condition.wait(min(remaining, 0.01))

    @contextmanager
    def read(self) -> Generator[None]:
        nested = getattr(self._local, "depth", 0) > 0
        with self._condition:
            if not nested:
                while self._record is not None:
                    if self._acknowledged is False or self._host.lifetime.unknown:
                        raise ValueError("native_stop_settlement_unavailable")
                    if (
                        self._acknowledged is True
                        and self._record.carrier_ref in self._host.boundary_owner._accepted
                        and self._host.boundary_owner.status == "STOP_RECORDED"
                    ):
                        break
                    self._wait()
                self._readers += 1
            self._local.depth = getattr(self._local, "depth", 0) + 1
        try:
            yield
        finally:
            with self._condition:
                self._local.depth -= 1
                if not nested:
                    self._readers -= 1
                    self._condition.notify_all()

    def begin_stop(self, *, record: NativeControlRecord, deadline: float) -> None:
        with self._condition:
            if self._record is not None or getattr(self._local, "depth", 0):
                raise ValueError("native_stop_settlement_replayed")
            self._record, self._deadline = record, deadline
            while self._readers:
                self._wait()

    def finish_stop(self, *, record: NativeControlRecord, acknowledged: bool) -> None:
        with self._condition:
            if self._record is record:
                self._acknowledged = acknowledged
                self._condition.notify_all()


class NativeStopSettlement:
    """Created by the sink only after its synchronous seal commit acknowledgment.

    Possession alone grants nothing: every use demands that the same boundary
    accepted that exact record and the same acquisition remains current. Reads
    run outside host locks and SQL writers; rechecks bracket those reads.
    """

    def __init__(self, *, host: NativeHostLaunch, record: NativeControlRecord) -> None:
        self._host, self._record = host, record
        self._lifetime, self._sealer = host.lifetime, host._stop_sealer
        self._context = host.lifetime.context
        self._stamp = canonical_digest(self._context.model_dump(mode="json"))
        self._identity = self._context.ref, self._context.generation, host.lifetime.dispatch_id
        self._resume = host._resume_bindings
        self._checkpoint = self._resume.checkpoint if self._resume is not None else None

    def _require_retained(self) -> None:
        host, life, record = self._host, self._lifetime, self._record
        with host._registration:
            host._require_live()
            if (
                host._stop_settlement is not self
                or host.lifetime is not life
                or host._stop_sealer is not self._sealer
                or host._resume_bindings is not self._resume
                or host.lifetime.context is not self._context
                or self._identity != (life.ref, life.generation, life.dispatch_id)
                or host.boundary_owner.status != "STOP_RECORDED"
                or type(record.control) is not NativePolicyStop
                or record.control.ref != self._context.ref
                or not any(item is record for item in host.boundary_owner.records)
                or not any(item is record for item in host._controls_seen)
                or record.carrier_ref not in host.boundary_owner._accepted
            ):
                raise ValueError("native_stop_settlement_unavailable")
        with life._condition:
            life._require_current()
            if life.unknown or not any(item is record for item in life.control_records):
                raise ValueError("native_stop_settlement_unavailable")
        if canonical_digest(self._context.model_dump(mode="json")) != self._stamp:
            raise ValueError("native_stop_settlement_changed")

    def require_context(self) -> ResolvedNativeTestContext:
        from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
        from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

        self._require_retained()
        host, lifecycle, context = self._host, self._sealer, self._context
        if (
            type(lifecycle) is not NativeTestLifecycleService
            or type(lifecycle.store) is not NativeExecutionStateStore
            or host._journal is None
            or host._journal._state is not lifecycle.store
            or host._checkpoints is None
            or host._checkpoints._lifecycle is not lifecycle
            or (self._resume is not None and host._resume_lifecycle is not lifecycle)
        ):
            raise ValueError("native_stop_settlement_owner_mismatch")
        # Existing private-read owner rechecks current RBAC, complete lineage,
        # context provenance, revision, expiry and cancellation. Recovery is
        # reachable here only for the retained exact accepted STOP capability.
        if lifecycle.store.load_recovery_context(ref=context.ref) != context:
            raise ValueError("native_stop_settlement_changed")
        with lifecycle.loader.session_factory() as session:
            request = session.scalar(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.id == context.ref.request_id,
                    DifyBuilderExecutionRequest.tenant_id == context.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == context.actor_id,
                    DifyBuilderExecutionRequest.context_digest == context.ref.context_digest,
                )
            )
            state = invocation_state(session, context.ref, context.tenant_id)
            scope = session.scalar(
                select(NativeTestScope).where(
                    NativeTestScope.request_id == context.ref.request_id, NativeTestScope.tenant_id == context.tenant_id
                )
            )
            invocation = session.scalar(owner_query(NativeTestInvocation, context.ref, context.tenant_id))
            dispatch = session.scalar(
                owner_query(NativeDispatch, context.ref, context.tenant_id).where(
                    NativeDispatch.id == self._identity[2]
                )
            )
            if (
                request is None
                or request.state != "sealed"
                or canonical_digest(request.context) != context.ref.context_digest
                or request.context.get("native_run_id") != context.native_run_id
                or scope is None
                or scope.cancelled
                or invocation is None
                or invocation.active
                or context.parent_invocation_id is not None
                or context.call_depth != 0
                or (state.generation, state.app_id, state.workflow_id, state.parent_invocation_id, state.state)
                != (context.generation, context.app_id, context.workflow_id, None, "running")
                or dispatch is None
                or (dispatch.generation, dispatch.state) != (context.generation, "claimed")
                or dispatch.checkpoint_id != state.checkpoint_id
                or (context.generation == 0) != (self._checkpoint is None)
            ):
                raise ValueError("native_stop_settlement_unconfirmed")
            if self._checkpoint is None:
                if dispatch.checkpoint_id is not None:
                    raise ValueError("native_stop_settlement_unconfirmed")
            else:
                checkpoint = self._checkpoint
                saved = session.scalar(
                    owner_query(NativeContinuation, context.ref, context.tenant_id).where(
                        NativeContinuation.checkpoint_id == checkpoint.checkpoint_id
                    )
                )
                row = session.scalar(
                    owner_query(NativePayloadObject, context.ref, context.tenant_id).where(
                        NativePayloadObject.id == checkpoint.checkpoint_id, NativePayloadObject.kind == "checkpoint"
                    )
                )
                if (
                    dispatch.checkpoint_id != checkpoint.checkpoint_id
                    or saved is None
                    or row is None
                    or not 0 <= saved.generation < context.generation
                    or (saved.payload_digest, row.payload_digest)
                    != (checkpoint.payload_digest, checkpoint.payload_digest)
                    or row.logical_key != str(saved.generation)
                    or not saved.payload_ref
                    or row.storage_key != saved.payload_ref
                ):
                    raise ValueError("native_stop_settlement_checkpoint_changed")
        self._require_retained()
        return context

    def require_resume(self, *, bindings) -> None:
        self.require_context()
        if bindings is not self._resume or bindings is None or bindings.checkpoint != self._checkpoint:
            raise ValueError("native_stop_settlement_checkpoint_changed")
