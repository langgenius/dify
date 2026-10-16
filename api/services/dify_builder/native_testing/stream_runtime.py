"""Actual single-reader native coordination; resume and activation stay gated.

The existing Dify generator executes the graph. This owner only drains its
already-created source, observes physical/native facts, reads the actual Run,
and delegates checkpoint/cleanup to the retained C03/capacity owners. SSE never
supplies business or waiting authority. Diagnostic route privacy and restored
history provenance require their separate joint qualification before wiring.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from threading import Lock, Thread, current_thread

from models.enums import CreatorUserRole
from models.workflow import WorkflowRun
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from services.dify_builder.native_testing.contracts import JsonValue
from services.dify_builder.native_testing.control import NativeApprovalWait, NativePolicyStop
from services.dify_builder.native_testing.generation_wiring import HostOwnedNativeGeneratorStream
from services.dify_builder.native_testing.host_capacity import NativeHostCapacity
from services.dify_builder.native_testing.host_execution import HostAuthorizationPort, NativeHostLaunch
from services.dify_builder.native_testing.native_execution import ClosableNativeEventStream
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.runtime_contracts import (
    NativeStatePort,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
)


class _ReaderFinalizer:
    def __init__(self, stream: HostOwnedNativeGeneratorStream) -> None:
        self._stream = stream

    def close(self) -> None:
        # Lifetime's actual call ticket closes on this same reader. A failed
        # source close leaves the ticket incomplete, including for late cleanup.
        from libs.sensitive_http_telemetry import sensitive_http_telemetry

        from services.dify_builder.native_testing.context_runtime import NATIVE_LOG_EMITTERS

        # Even a failed diagnostic guard cannot fabricate source-close ACK.
        # A missing telemetry boundary conservatively leaves this ticket open.
        with sensitive_http_telemetry(additional_emitters=NATIVE_LOG_EMITTERS):
            self._stream.finish_reader()


class DifyNativeStreamOwner:
    """One exact acquisition with no whole-run timer or alternate executor."""

    def __init__(
        self,
        *,
        host: NativeHostLaunch,
        capacity: NativeHostCapacity,
        session_factory: sessionmaker[Session],
        state: NativeStatePort,
        authorization: HostAuthorizationPort,
        journal: NodeOperationJournal,
        checkpoints: NativeCheckpointBridge,
    ) -> None:
        if (
            type(host) is not NativeHostLaunch
            or type(capacity) is not NativeHostCapacity
            or capacity._verifier is not host.lifetime
            or checkpoints._lifecycle is not capacity.lifecycle
            or capacity.loader.session_factory is not session_factory
        ):
            raise ValueError("native_stream_composition_mismatch")
        host.validate_composition(state=state, authorization=authorization, journal=journal, checkpoints=checkpoints)
        self._host = host
        self._capacity = capacity
        self._sessions = session_factory
        self._state = state
        self._lock = Lock()
        self._consumed = False
        self._stream: HostOwnedNativeGeneratorStream | None = None
        self._reader: Thread | None = None

    def _read(self) -> None:
        host, stream = self._host, self._stream
        assert stream is not None
        try:
            with host.lifetime.call_scope() as ticket:
                ticket.own_stream(stream=_ReaderFinalizer(stream))
                with host.observation_scope():
                    for _ in stream:
                        # Raw SSE is drained only. The same retained guard owns
                        # the queue/pipeline before any source serialization.
                        pass
        except BaseException:
            host.mark_unknown()
        finally:
            host.lifetime.thread_finished(thread=current_thread())

    def _unknown(self, context: ResolvedNativeTestContext) -> NativeWorkflowOutcome:
        self._host.mark_unknown()
        try:
            self._host.request_close(reason="failed")
            if self._stream is not None:
                self._stream.close()  # Signal only; never concurrently close source.
        except ValueError:
            self._host.mark_unknown()  # Cleanup may have consumed payload before SQL ACK failed.
        try:
            # Existing C03 transaction owner; never under reader/admission locks.
            self._capacity.lifecycle._mark_unknown(ref=context.ref, dispatch_id=self._host.lifetime.dispatch_id)
        except BaseException:
            self._host.mark_unknown()  # No confirmed durable quarantine on a failed ACK.
        return NativeWorkflowOutcome(
            status="unknown",
            ref=context.ref,
            native_run_id=context.native_run_id,
            checkpoint_ref=None,
            pending_operation_ids=(),
            reason_code="native_host_unknown",
            wait_reason=None,
            native_status=None,
            output_result_ref=None,
        )

    def _persisted_status(self, context: ResolvedNativeTestContext) -> str:
        # A synchronous repository's private cache is not persistence ACK. Read
        # the actual fully scoped row after physical join, with no writer held.
        with self._sessions() as session:
            row = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == context.native_run_id,
                    WorkflowRun.tenant_id == context.tenant_id,
                    WorkflowRun.app_id == context.app_id,
                    WorkflowRun.workflow_id == context.workflow_id,
                    WorkflowRun.created_by == context.actor_id,
                    WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                )
            )
            if row is None or (
                row.id,
                row.tenant_id,
                row.app_id,
                row.workflow_id,
                row.created_by,
                row.created_by_role,
            ) != (
                context.native_run_id,
                context.tenant_id,
                context.app_id,
                context.workflow_id,
                context.actor_id,
                CreatorUserRole.ACCOUNT,
            ):
                raise ValueError("native_run_persistence_unconfirmed")
            return row.status

    def _outcome(self, context: ResolvedNativeTestContext) -> NativeWorkflowOutcome:
        host = self._host
        host.lifetime.require_settled_root()
        if host.require_evidence_context() != context:
            raise ValueError("native_stream_context_changed")
        host.lifetime.require_settled_root()
        observed = host.root_observation
        if (
            not observed.started
            or not observed.ended
            or not observed.exhausted
            or observed.interrupted
            or observed.contradictory
            or (observed.graph_end_error and observed.terminal not in ("failed", "stopped"))
            or observed.worker_exit != "returned"
        ):
            raise ValueError("native_root_terminal_unconfirmed")
        persisted = self._persisted_status(context)
        host.lifetime.require_settled_root()
        if host.root_observation != observed:
            raise ValueError("native_root_observation_changed")
        if host.boundary_owner.status == "WAIT_RECORDED":
            if persisted != "paused":
                raise ValueError("native_run_persistence_mismatch")
            payload = host.snapshot_wait()
            pending = tuple(
                dict.fromkeys(
                    record.control.pending_operation_id
                    for record in host.boundary_owner.records
                    if type(record.control) is NativeApprovalWait
                )
            )
            receipt = host.commit_wait(payload=payload, pending_operation_ids=pending)
            return NativeWorkflowOutcome(
                status="waiting",
                ref=context.ref,
                native_run_id=context.native_run_id,
                checkpoint_ref=receipt.checkpoint,
                pending_operation_ids=receipt.pending_operation_ids,
                reason_code=None,
                wait_reason=receipt.wait_reason,
                native_status=None,
                output_result_ref=None,
            )
        if host.boundary_owner.status == "STOP_RECORDED":
            if observed.terminal != "stopped" or not observed.aborted or persisted != "stopped":
                raise ValueError("native_stop_unconfirmed")
            controls = tuple(record.control for record in host.boundary_owner.records)
            stop = next(control for control in controls if type(control) is NativePolicyStop)
            return NativeWorkflowOutcome(
                status="stopped",
                ref=context.ref,
                native_run_id=context.native_run_id,
                checkpoint_ref=None,
                pending_operation_ids=(),
                reason_code=stop.reason_code,
                wait_reason=None,
                native_status=None,
                output_result_ref=None,
            )
        if host.boundary_owner.status != "OPEN" or observed.paused or observed.aborted:
            raise ValueError("native_root_control_unconfirmed")
        status = observed.terminal
        if status not in ("succeeded", "failed", "partial-succeeded") or persisted != status:
            raise ValueError("native_run_persistence_mismatch")
        if (status == "failed") != observed.error or (status != "failed" and not observed.completed):
            raise ValueError("native_root_terminal_mismatch")
        return NativeWorkflowOutcome(
            status="completed",
            ref=context.ref,
            native_run_id=context.native_run_id,
            checkpoint_ref=None,
            pending_operation_ids=(),
            reason_code=None,
            wait_reason=None,
            native_status=status,
            output_result_ref=None,
        )

    def consume(
        self,
        *,
        context: ResolvedNativeTestContext,
        stream: ClosableNativeEventStream,
        on_event: Callable[[Mapping[str, JsonValue]], None],
    ) -> NativeWorkflowOutcome:
        if (
            type(stream) is not HostOwnedNativeGeneratorStream
            or stream._host is not self._host
            or context != self._host.lifetime.context
        ):
            raise ValueError("native_stream_owner_mismatch")
        with self._lock:
            if self._consumed:
                raise ValueError("native_stream_consume_replayed")
            self._consumed = True
            self._stream = stream
            self._reader = Thread(target=self._read, daemon=True)
        try:
            self._host.lifetime.register_reader(thread=self._reader, stream=stream)
            self._host.lifetime.start_thread(thread=self._reader)
            self._host.lifetime.wait_until_closing()
            if self._host.settlement_deadline is None:
                self._host.request_close(reason="failed")
            if self._host.lifetime.settle() != "settled":
                return self._unknown(context)
            outcome = self._outcome(context)
            self._host.lifetime.require_settled_root()
            self._host.release_dispatcher_logs()
            self._host.lifetime.require_settled_root()
            self._capacity.record_cleanup(
                ref=context.ref,
                generation=context.generation,
                dispatch_id=self._host.lifetime.dispatch_id,
            )
            self._host.retire()  # Only after the real capacity SQL ACK.
        except BaseException:
            return self._unknown(context)
        # Bounded final projection only. The existing raw queue/pipeline and
        # public routing still need joint qualification before activation.
        on_event(
            {
                "status": outcome.status,
                "native_run_id": outcome.native_run_id,
                "native_status": outcome.native_status,
                "wait_reason": outcome.wait_reason,
            }
        )
        return outcome

    def resume(self, *, context: ResolvedNativeTestContext, generation: int) -> NativeWorkflowOutcome:
        raise NativeContextUnavailable("native_resume_adapter_unavailable")
