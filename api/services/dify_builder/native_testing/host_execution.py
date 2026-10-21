"""Private Dify launch ownership; no production wiring or durable authority.

The admitted server owner supplies the actual lifetime and mandatory C03 fence
and stop sealer. NativeCallAdapter and the existing journal retain all C02/C03
scalar authority. Only the physically settled coordinator can delegate a wait
to the exact retained C03 bridge; native observation callbacks never commit it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from services.dify_builder.native_testing.context_runtime import NativeExecutionContext
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeBindingProducer,
    )
    from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager

from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager, suppress
from dataclasses import dataclass
from math import isfinite
from threading import Lock, RLock, Thread, current_thread
from time import monotonic
from typing import Literal, Protocol, cast, override, runtime_checkable

from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.repositories.sqlalchemy_workflow_execution_repository import (
    SQLAlchemyWorkflowExecutionRepository,
)
from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
)
from graphon.engine.command import Command, CommandChannel
from graphon.engine.filter import ResponseStreamFilter
from graphon.engine.layer import Layer
from graphon.engine_events.base import EngineEvent
from graphon.engine_events.graph import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from graphon.nodes.base.node import Node
from graphon.nodes.iteration.iteration_node import IterationNode
from graphon.nodes.loop.loop_node import LoopNode
from graphon.runtime import RuntimeState
from libs.sensitive_http_telemetry import SensitiveThreadLogLease
from runtime_contracts.builder.native.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectIntent,
    JsonValue,
    NativeTestContextRef,
    PolicyStop,
    WaitingReceipt,
    operation_digest,
)
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NativeStatePort,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.call_adapter import (
    NativeCallAdapter,
    ScalarAuthorizationPort,
)
from services.dify_builder.native_testing.checkpoint_bridge import (
    NativeCheckpointBridge,
)
from services.dify_builder.native_testing.control import (
    BoundaryOwnerState,
    NativeApprovalWait,
    NativeControlAccepted,
    NativeControlRecord,
    NativeControlRefused,
    NativePolicyStop,
    _NativeControlBoundary,
)
from services.dify_builder.native_testing.host_lifetime import (
    CloseReason,
    NativeHostCallTicket,
    NativeHostLifetime,
)
from services.dify_builder.native_testing.http_adapter import (
    PreparedHttpBinding,
    PreparedHttpRequest,
)
from services.dify_builder.native_testing.http_binding import NativeHttpBindingProducer
from services.dify_builder.native_testing.observation_adapters import (
    NativeObservationError,
    NativeObservationGuard,
)
from services.dify_builder.native_testing.operation_journal import (
    JournalAuthorizationPort,
    NodeOperationJournal,
)
from services.dify_builder.native_testing.stop_settlement import (
    NativeEvidenceReadGate,
    NativeStopSettlement,
)
from services.workflow_runtime.entry import WorkflowEntry

HttpTimeout = tuple[float | int, ...]


class HostAuthorizationPort(JournalAuthorizationPort, ScalarAuthorizationPort, Protocol):
    """The SAME existing C02 authorization owner, no new authority methods."""


class NativePendingFence(Protocol):
    def __call__(
        self, *, ref: NativeTestContextRef, pending_operation_ids: tuple[str, ...], expected_generation: int
    ) -> None: ...


@runtime_checkable
class DurableNativeStopSealer(Protocol):
    """Required committed C03 stop seal; no implementation/default in this phase."""

    def seal_stop(
        self, *, ref: NativeTestContextRef, expected_generation: int, dispatch_id: str, reason_code: str
    ) -> None: ...


def _timeout(value: HttpTimeout) -> HttpTimeout:
    if (
        type(value) is not tuple
        or len(value) not in (3, 4)
        or any(type(part) not in (int, float) or not isfinite(part) or part <= 0 for part in value)
        or not isfinite(sum(value))
    ):
        raise ValueError("native_host_http_timeout_unqualified")
    return tuple(value)


@dataclass(frozen=True, slots=True)
class NativeHostGenerationBindings:
    entity: WorkflowAppGenerateEntity
    queue: WorkflowAppQueueManager
    response_filter: ResponseStreamFilter
    workflow_repository: SQLAlchemyWorkflowExecutionRepository
    node_repository: SQLAlchemyWorkflowNodeExecutionRepository


class _HostCommandChannel:
    def __init__(self, *, host: NativeHostLaunch, channel: CommandChannel) -> None:
        self._host = host
        self._channel: CommandChannel | None = channel

    def fetch_commands(self) -> list[Command]:
        if self._channel is None:
            raise ValueError("native_host_launch_retired")
        self._host.lifetime.observe_dispatcher()
        self._host._protect_dispatcher_logs()
        try:
            if self._host._cancellation_fence is not None and self._host._cancellation_fence.poll():
                from graphon.engine.command import AbortCommand

                self._host.request_close(reason="cancel")
                return [AbortCommand(reason="native_cancelled")]
            return self._channel.fetch_commands()
        except BaseException:
            if self._host._observation is not None:
                self._host.mark_unknown()
                raise NativeObservationError() from None
            raise

    def send_command(self, command: Command) -> None:
        if self._channel is None:
            raise ValueError("native_host_launch_retired")
        self._channel.send_command(command)


@dataclass(frozen=True, slots=True)
class NativeHostEngineBindings:
    entry: WorkflowEntry
    runtime_state: RuntimeState
    response_filter: ResponseStreamFilter
    commands: CommandChannel


RootTerminal = Literal["succeeded", "failed", "partial-succeeded", "stopped", "paused"]


@dataclass(frozen=True, slots=True)
class NativeHostRootObservation:
    """Bounded native facts only; no exception, output, title or SSE payload."""

    terminal: RootTerminal | None
    started: bool
    ended: bool
    completed: bool
    paused: bool
    aborted: bool
    error: bool
    graph_end_error: bool
    contradictory: bool
    exceptions_count: int
    exhausted: bool
    interrupted: bool
    worker_exit: str | None


@dataclass(eq=False, slots=True)
class _HookScope:
    node: Node
    thread: Thread
    execution_id: str
    context: AbstractContextManager[object]


class _HostObservationLayer(Layer):
    """Install first through Engine.add_layer; retain actual worker contexts."""

    def __init__(self, host: NativeHostLaunch) -> None:
        super().__init__()
        self._host = host
        self._hooks: list[_HookScope] = []
        self._execution_context: NativeExecutionContext | None = None

    @override
    def on_graph_start(self) -> None:
        if self._host._engine_bindings is None:
            self._host._unknown()

    @override
    def on_event(self, event: EngineEvent) -> None:
        self._host._observe_root_event(event=event, layer=self)

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        with self._host._registration:
            if current_thread() is not self._host._worker:
                return  # A nested subgraph cannot end or assess the root's hooks.
            self._host._graph_ended = True
            self._host._graph_end_error |= error is not None
        if self._hooks:
            self._host._unknown()

    @override
    @contextmanager
    def node_run_context(self, node: Node, *, parent_execution_id: str | None = None) -> Generator[None]:
        """Retain each actual worker activation and restore its own context tokens.

        Suspended containers leave this manager on their current worker. Their
        resume obtains a fresh manager rather than closing another thread's
        captured context from an end hook.
        """
        from contextlib import ExitStack
        from sys import exc_info

        stack = ExitStack()
        actual = _HookScope(node, current_thread(), node.execution_id, stack)
        try:
            if self._execution_context is None:
                raise NativeObservationError()
            stack.enter_context(self._execution_context.enter())
            stack.enter_context(self._host._logical_node_scope(node=node))
            with self._host._registration:
                self._hooks.append(actual)
        except BaseException:
            self._host._unknown()
            node.runtime_state.graph_execution.abort("native_host_observation_failed")
            stack.close()
            raise
        try:
            yield
        finally:
            try:
                stack.__exit__(*exc_info())
            except BaseException:
                self._host._unknown()
                node.runtime_state.graph_execution.abort("native_host_observation_failed")
            finally:
                with self._host._registration:
                    self._hooks.remove(actual)


class NativeHostLaunch:
    """One actual acquisition, with short registration and separate admission locks.

    Tuple qualification comes from the actual HTTP config/descriptor owner; the
    host snapshots actual prepared tuples and validates finite positive bounds.
    Constructor state is not a SQL claim, capability attestation or entitlement.
    """

    def __init__(
        self,
        *,
        context: ResolvedNativeTestContext,
        dispatch_id: str,
        lifetime: NativeHostLifetime,
        journal: NodeOperationJournal,
        checkpoints: NativeCheckpointBridge,
        fence_pending: NativePendingFence,
        stop_sealer: DurableNativeStopSealer,
        authorization: HostAuthorizationPort,
        http_baseline: HttpTimeout,
    ) -> None:
        if (
            type(lifetime) is not NativeHostLifetime
            or lifetime.context is not context
            or lifetime.dispatch_id != dispatch_id
            or type(journal) is not NodeOperationJournal
            or type(checkpoints) is not NativeCheckpointBridge
            or not callable(fence_pending)
            or not isinstance(stop_sealer, DurableNativeStopSealer)
            or not callable(stop_sealer.seal_stop)
        ):
            raise ValueError("native_host_explicit_owners_required")
        self._lifetime = lifetime
        self._boundary_owner = BoundaryOwnerState(ref=lifetime.ref, ownership=self)
        self._journal: NodeOperationJournal | None = journal
        self._checkpoints: NativeCheckpointBridge | None = checkpoints
        self._fence_pending: NativePendingFence | None = fence_pending
        self._stop_sealer: DurableNativeStopSealer | None = stop_sealer
        self._authorization: HostAuthorizationPort | None = authorization
        self._baseline = _timeout(http_baseline)
        self._registration = RLock()
        self._admission = Lock()
        self._deadline: float | None = None
        self._prepared: dict[str, HttpTimeout] = {}
        self._active_http: dict[NativeHostCallTicket, HttpTimeout] = {}
        self._active_code: dict[NativeHostCallTicket, float] = {}
        self._runtimes: list[RuntimeState] = []
        self._controls_seen: list[NativeControlRecord] = []
        self._calls: list[HostBoundScalarCalls] = []
        self._generation_bindings: NativeHostGenerationBindings | None = None
        self._channel: _HostCommandChannel | None = None
        self._cancellation_fence = None
        self._exit_kind: str | None = None
        self._worker: Thread | None = None
        self._physical_phases: list[_HookScope] = []
        self._engine_bindings: NativeHostEngineBindings | None = None
        self._layer: _HostObservationLayer | None = _HostObservationLayer(self)
        self._producers: list[NativeHttpBindingProducer | NativeCodeBindingProducer] = []
        self._release: Callable[[], None] | None = None
        self._retired = False
        self._root_started = False
        self._root_terminal: RootTerminal | None = None
        self._root_contradictory = False
        self._graph_ended = False
        self._graph_end_error = False
        self._stream_exhausted = False
        self._interrupted = False
        self._wait_snapshot: NativeCheckpointPayload | None = None
        self._observation: NativeObservationGuard | None = None
        self._resume_bindings = None
        self._resume_lifecycle = None
        self._resume_attempted = False
        self._resume_history = None
        self._observation_attempted = False
        self._observation_state: NativeStatePort | None = None
        self._dispatcher_log_leases: list[SensitiveThreadLogLease] = []
        self._stop_settlement: NativeStopSettlement | None = None
        self._evidence_reads = NativeEvidenceReadGate(self)
        self._control_sink = DifyNativeControlSink(self)

    @property
    def lifetime(self) -> NativeHostLifetime:
        return self._lifetime

    @property
    def boundary_owner(self) -> BoundaryOwnerState:
        return self._boundary_owner

    @property
    def control_sink(self) -> DifyNativeControlSink:
        return self._control_sink

    def _require_live(self) -> None:
        if self._retired:
            raise ValueError("native_host_launch_retired")
        _ = self.lifetime.context

    @property
    def engine_bindings(self) -> NativeHostEngineBindings:
        with self._registration:
            if self._engine_bindings is None:
                raise ValueError("native_host_engine_unbound")
            return self._engine_bindings

    def bind_engine(
        self,
        *,
        entry: WorkflowEntry,
        runtime_state: RuntimeState,
        response_filter: ResponseStreamFilter,
        commands: CommandChannel,
    ) -> None:
        generation = self.generation_bindings
        if (
            type(entry) is not WorkflowEntry
            or entry.graph_engine.runtime_state is not runtime_state
            or runtime_state.graph_execution.workflow_id != self.lifetime.context.workflow_id
            or response_filter is not generation.response_filter
            or entry._response_stream_filter is not response_filter
            or entry.command_channel is not commands
            or commands is not self._channel
            or self._layer is None
            or self._layer.command_channel is not commands
        ):
            raise ValueError("native_host_engine_identity_invalid")
        with self._registration:
            self._require_live()
            if self._engine_bindings is not None:
                raise ValueError("native_host_engine_rebound")
            if not any(item is runtime_state for item in self._runtimes):
                self.lifetime.bind_runtime(runtime_state=runtime_state)
                self._runtimes.append(runtime_state)
            self._engine_bindings = NativeHostEngineBindings(entry, runtime_state, response_filter, commands)

    def observation_layer(self) -> Layer:
        with self._registration:
            self._require_live()
            if self._layer is None:
                raise ValueError("native_host_launch_retired")
            if self._layer._execution_context is None:
                from services.dify_builder.native_testing.context_runtime import NativeExecutionContext

                self._layer._execution_context = NativeExecutionContext(guard=self.native_observation)
            return self._layer

    def validate_composition(
        self,
        *,
        state: NativeStatePort,
        authorization: HostAuthorizationPort,
        journal: NodeOperationJournal,
        checkpoints: NativeCheckpointBridge,
    ) -> None:
        """Exact Dify owner associations, never a caller qualification flag."""
        with self._registration:
            self._require_live()
            if (
                journal is not self._journal
                or checkpoints is not self._checkpoints
                or authorization is not self._authorization
                or journal._state is not state
                or journal._authorization is not authorization
                or checkpoints._state is not state
            ):
                raise ValueError("native_host_composition_mismatch")

    def mark_unknown(self) -> None:
        """Public failure latch for the coordinator/qualified diagnostic owner."""
        self._unknown()

    def bind_observation(self) -> NativeObservationGuard:
        """Bind once through actual protected-profile owner, outside host locks."""
        from libs.sensitive_http_telemetry import sensitive_http_telemetry
        from services.dify_builder.native_testing.context_runtime import NATIVE_LOG_EMITTERS
        from services.dify_builder.native_testing.observation_owner import create_http_observation_guard
        from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

        try:
            with self._registration:
                self._require_live()
                if self._observation_attempted:
                    existing = self._observation
                    journal = None
                else:
                    self._observation_attempted = True
                    existing = None
                    journal = self._journal
                context = self.lifetime.context
                state = journal._state if journal is not None else None
            if existing is not None:
                return self.native_observation
            if journal is None or self.lifetime.unknown:
                raise NativeObservationError()
            with sensitive_http_telemetry(additional_emitters=NATIVE_LOG_EMITTERS):
                guard = create_http_observation_guard(
                    state=cast(NativeExecutionStateStore, state),
                    context=context,
                    on_failure=self.mark_unknown,
                )
            if type(guard) is not NativeObservationGuard:
                raise NativeObservationError()
            guard.require_healthy()
            with self._registration:
                self._require_live()
                if (
                    self.lifetime.context is not context
                    or self._journal is not journal
                    or journal._state is not state
                    or self.lifetime.unknown
                ):
                    raise NativeObservationError()
                self._observation = guard
                self._observation_state = state
            return self.native_observation
        except BaseException:
            self.mark_unknown()
            raise NativeObservationError() from None

    @property
    def native_observation(self) -> NativeObservationGuard:
        """The same healthy guard after a fresh current-state identity read."""
        from services.dify_builder.native_testing.context_runtime import native_observation_scope

        try:
            with self._registration:
                self._require_live()
                guard, journal, context = self._observation, self._journal, self.lifetime.context
            if (
                type(guard) is not NativeObservationGuard
                or journal is None
                or self.lifetime.unknown
                or journal._state is not self._observation_state
            ):
                raise NativeObservationError()
            with native_observation_scope(guard=guard):
                if self.require_evidence_context() != context:
                    raise NativeObservationError()
            with self._registration:
                self._require_live()
                if (
                    self._observation is not guard
                    or self._journal is not journal
                    or self.lifetime.context is not context
                    or journal._state is not self._observation_state
                    or self.lifetime.unknown
                ):
                    raise NativeObservationError()
            guard.require_healthy()
            return guard
        except BaseException:
            self.mark_unknown()
            raise NativeObservationError() from None

    def require_evidence_context(self) -> ResolvedNativeTestContext:
        """Current execution context, or exact accepted STOP evidence only."""
        with self._evidence_reads.read():
            if self.boundary_owner.status == "STOP_RECORDED":
                if self._stop_settlement is None:
                    raise ValueError("native_stop_settlement_unavailable")
                return self._stop_settlement.require_context()
            if self._journal is None:
                raise ValueError("native_host_launch_retired")
            return self._journal._state.load_context(ref=self.lifetime.ref)

    @contextmanager
    def observation_scope(self) -> Generator[None]:
        from services.dify_builder.native_testing.context_runtime import native_observation_scope

        with native_observation_scope(guard=self.native_observation):
            yield

    def _protect_dispatcher_logs(self) -> None:
        """First actual public command poll, before delegation/raw dispatcher logs.

        The lifetime already retained current_thread at this port. Pool/app
        contexts remain bounded separately; the dispatcher is a new per-run
        Thread and keeps this logging-only lease until its real joined exit.
        """
        from libs.sensitive_http_telemetry import assert_sensitive_http_telemetry_ready, protect_current_thread_logs
        from services.dify_builder.native_testing.context_runtime import NATIVE_LOG_EMITTERS

        with self._registration:
            guard = self._observation
            held = any(lease.thread is current_thread() for lease in self._dispatcher_log_leases)
        if guard is None:
            return  # Isolated historical host components have no initial DI guard.
        try:
            assert_sensitive_http_telemetry_ready(additional_emitters=NATIVE_LOG_EMITTERS)
            if not held:
                lease = protect_current_thread_logs(additional_emitters=NATIVE_LOG_EMITTERS)
                with self._registration:
                    # Retain even on a concurrent failure: a live dispatcher
                    # must never lose protection because its result is unknown.
                    self._dispatcher_log_leases.append(lease)
                    self._require_live()
                    if self._observation is not guard:
                        raise NativeObservationError()
            guard.require_healthy()
        except BaseException:
            self.mark_unknown()
            raise NativeObservationError() from None

    def release_dispatcher_logs(self) -> None:
        """Before capacity ACK, require actual settlement and dead exact Threads."""
        try:
            self.lifetime.require_settled_root()
            with self._registration:
                leases = tuple(self._dispatcher_log_leases)
            for lease in leases:
                lease.release_after_exit()
            self.lifetime.require_settled_root()
            with self._registration:
                if tuple(self._dispatcher_log_leases) != leases:
                    raise NativeObservationError()
                self._dispatcher_log_leases.clear()
        except BaseException:
            self.mark_unknown()
            raise NativeObservationError() from None

    def release_dead_dispatcher_logs(self) -> None:
        """Cleanup-only release; never grants checkpoint/business qualification.

        Sticky unknown is preserved. The original capacity verifier must still
        consume actual physical cleanup and SQL-recheck after this returns.
        """
        lifetime = self.lifetime
        with self._registration:
            self._require_live()
            leases = tuple(self._dispatcher_log_leases)
            identity = lifetime.ref, lifetime.generation, lifetime.dispatch_id
        with lifetime._condition:
            lifetime._require_current()
        for lease in leases:
            lease.release_after_exit()  # The exact retained Thread must be dead.
        with lifetime._condition:
            lifetime._require_current()
        with self._registration:
            self._require_live()
            if (
                self.lifetime is not lifetime
                or tuple(self._dispatcher_log_leases) != leases
                or identity != (lifetime.ref, lifetime.generation, lifetime.dispatch_id)
            ):
                self.mark_unknown()
                raise ValueError("native_dispatcher_cleanup_changed")
            self._dispatcher_log_leases.clear()

    def _observe_root_event(self, *, event: EngineEvent, layer: Layer) -> None:
        terminals: dict[type[EngineEvent], RootTerminal] = {
            GraphRunSucceededEvent: "succeeded",
            GraphRunFailedEvent: "failed",
            GraphRunPartialSucceededEvent: "partial-succeeded",
            GraphRunAbortedEvent: "stopped",
            GraphRunPausedEvent: "paused",
        }
        if type(event) is not GraphRunStartedEvent and type(event) not in terminals:
            return
        with self._registration:
            bindings = self._engine_bindings
            if bindings is None or layer is not self._layer or layer.command_channel is not bindings.commands:
                self._unknown()
                return
            # Root lifecycle is emitted by the owned app worker. Container
            # subgraphs/pool callbacks cannot attest a root business terminal.
            if current_thread() is not self._worker:
                return
            execution = bindings.runtime_state.graph_execution
            if type(event) in (GraphRunSucceededEvent, GraphRunPartialSucceededEvent) and not (
                execution.completed and not execution.paused and not execution.aborted and execution.error is None
            ):
                return
            if type(event) is GraphRunPausedEvent and not execution.paused:
                return
            if type(event) is GraphRunAbortedEvent and not execution.aborted:
                return
            if type(event) is GraphRunFailedEvent and execution.error is None:
                return
            if type(event) is GraphRunStartedEvent:
                if self._root_started or self._root_terminal is not None:
                    self._root_contradictory = True
                self._root_started = True
            else:
                if self._root_terminal is not None or not self._root_started:
                    self._root_contradictory = True
                self._root_terminal = terminals[type(event)]

    @property
    def root_observation(self) -> NativeHostRootObservation:
        """Coherent facts from the actual bound root; settle before authority."""
        with self._registration:
            self._require_live()
            bindings = self.engine_bindings
            execution = bindings.runtime_state.graph_execution
            count = execution.exceptions_count
            if type(count) is not int or count < 0 or count > 2**31 - 1:
                self._unknown()
                raise ValueError("native_host_root_observation_invalid")
            return NativeHostRootObservation(
                terminal=self._root_terminal,
                started=self._root_started and execution.started,
                ended=self._graph_ended,
                completed=execution.completed,
                paused=execution.paused,
                aborted=execution.aborted,
                error=execution.error is not None,
                graph_end_error=self._graph_end_error,
                contradictory=self._root_contradictory,
                exceptions_count=count,
                exhausted=self._stream_exhausted,
                interrupted=self._interrupted,
                worker_exit=self._exit_kind,
            )

    def _require_wait(self) -> tuple[str, ...]:
        self.lifetime.require_settled_root()
        observed = self.root_observation
        if (
            self.boundary_owner.status != "WAIT_RECORDED"
            or observed.terminal != "paused"
            or not observed.started
            or not observed.ended
            or not observed.paused
            or observed.aborted
            or observed.error
            or observed.graph_end_error
            or observed.contradictory
            or not observed.exhausted
            or observed.interrupted
            or observed.worker_exit != "returned"
        ):
            raise ValueError("native_host_wait_ineligible")
        records = self.boundary_owner.records
        tracked = self.lifetime.control_records
        if len(records) != len(tracked) or any(a is not b for a, b in zip(records, tracked, strict=True)):
            raise ValueError("native_host_wait_control_mismatch")
        pending = tuple(
            dict.fromkeys(
                record.control.pending_operation_id for record in records if type(record.control) is NativeApprovalWait
            )
        )
        if not pending or len(pending) > 4096 or len(records) != len(self._controls_seen):
            raise ValueError("native_host_wait_control_mismatch")
        return pending

    def snapshot_wait(self) -> NativeCheckpointPayload:
        """Serialize exact retained operational owners only after quiescence."""
        self._require_wait()
        with self._registration:
            self._require_live()
            journal, producers = self._journal, tuple(self._producers)
            generation, engine = self.generation_bindings, self.engine_bindings
        if journal is None:
            raise ValueError("native_host_launch_retired")
        context = self.lifetime.context
        journals = journal.snapshot(ref=context.ref)
        payload = NativeCheckpointPayload(
            schema_version="1",
            native_run_id=context.native_run_id or "",
            generation=context.generation,
            generate_entity_json=generation.entity.model_dump_json(),
            graph_runtime_state_json=engine.runtime_state.dumps(),
            response_stream_filter_json=engine.response_filter.dumps(),
            node_journals=journals,
            child_refs=(),
            input_result_refs=tuple(dict.fromkeys(item.input_result_ref for item in journals)),
            approval_proposals=tuple(proposal for producer in producers for proposal in producer.approval_proposals()),
        )
        self._require_wait()
        with self._registration:
            self.lifetime.require_settled_root()
            self._wait_snapshot = payload
        return payload

    def commit_wait(
        self, *, payload: NativeCheckpointPayload, pending_operation_ids: tuple[str, ...]
    ) -> WaitingReceipt:
        """Delegate to the same C03 owner, outside all local/writer locks."""
        expected = self._require_wait()
        with self._registration:
            checkpoints = self._checkpoints
            if payload is not self._wait_snapshot or checkpoints is None or pending_operation_ids != expected:
                raise ValueError("native_host_checkpoint_mismatch")
        receipt = checkpoints.commit_wait(
            ref=self.lifetime.ref,
            generation=self.lifetime.generation,
            payload=payload,
            pending_operation_ids=expected,
        )
        self._require_wait()
        receipt = WaitingReceipt.model_validate(receipt.model_dump(mode="json"))
        if (receipt.request_id, receipt.invocation_id, receipt.generation, receipt.pending_operation_ids) != (
            self.lifetime.ref.request_id,
            self.lifetime.ref.invocation_id,
            self.lifetime.generation,
            expected,
        ):
            raise ValueError("native_host_wait_receipt_mismatch")
        return receipt

    @property
    def proposal_producers(
        self,
    ) -> tuple[NativeHttpBindingProducer | NativeCodeBindingProducer, ...]:
        with self._registration:
            self._require_live()
            return tuple(self._producers)

    def register_proposals(self, *, producer: NativeHttpBindingProducer | NativeCodeBindingProducer) -> None:
        from services.dify_builder.native_testing.sandbox.qualification import (
            NativeCodeBindingProducer,
        )

        # Creation-site structural retention only. The later stream owner calls
        # each real approval_proposals() after quiescence, outside these locks.
        if (
            type(producer) not in (NativeHttpBindingProducer, NativeCodeBindingProducer)
            or producer.association.ref != self.lifetime.ref
            or producer.journal is not self._journal
        ):
            raise ValueError("native_host_http_producer_invalid")
        with self._registration:
            self._require_live()
            if not any(item is producer for item in self._producers):
                self._producers.append(producer)

    def bind_release(self, *, release: Callable[[], None]) -> None:
        with self._registration:
            self._require_live()
            if not callable(release) or self._release is not None:
                raise ValueError("native_host_release_rebound")
            self._release = release

    def retire(self) -> None:
        # Public lifetime contract: payload retirement occurs ONLY after its
        # successful exactly-once consume_cleanup, never on an absent registry.
        with self._registration:
            if self._retired:
                raise ValueError("native_host_launch_retired")
            try:
                _ = self.lifetime.context
            except ValueError as error:
                if str(error) != "native_host_payload_retired":
                    raise
            else:
                raise ValueError("native_host_cleanup_unconsumed")
            self._retired = True
            self._stop_settlement = None
            release, self._release = self._release, None
            self._cancellation_fence = None
            self._resume_bindings = self._resume_lifecycle = self._resume_history = None
            self._generation_bindings = None
            self._engine_bindings = None
            self._journal = self._checkpoints = self._authorization = None
            self._fence_pending = self._stop_sealer = None
            for calls in self._calls:
                calls._adapter = None
            self._calls.clear()
            if self._channel is not None:
                self._channel._channel = None
            self._channel = None
            if self._layer is not None:
                self._layer._hooks.clear()
                self._layer._execution_context = None
            self._layer = None
            self.boundary_owner._unknown("native_host_retired")
            self.boundary_owner._records.clear()
            self.boundary_owner._accepted.clear()
            self._producers.clear()
            self._runtimes.clear()
            self._prepared.clear()
            self._controls_seen.clear()
            self._wait_snapshot = None
            self._observation = None
            self._observation_state = None
            self._worker = None
        if release is not None:
            release()  # No writer/registration/admission lock; never retried.

    @property
    def generation_bindings(self) -> NativeHostGenerationBindings:
        with self._registration:
            if self._generation_bindings is None:
                raise ValueError("native_host_generation_unbound")
            return self._generation_bindings

    def bind_generation(
        self,
        *,
        entity: WorkflowAppGenerateEntity,
        queue: WorkflowAppQueueManager,
        response_filter: ResponseStreamFilter,
        workflow_repository: SQLAlchemyWorkflowExecutionRepository,
        node_repository: SQLAlchemyWorkflowNodeExecutionRepository,
    ) -> None:
        from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager

        context = self.lifetime.context
        if (
            type(entity) is not WorkflowAppGenerateEntity
            or not isinstance(queue, WorkflowAppQueueManager)
            or type(response_filter) is not ResponseStreamFilter
            or type(workflow_repository) is not SQLAlchemyWorkflowExecutionRepository
            or type(node_repository) is not SQLAlchemyWorkflowNodeExecutionRepository
            or entity.native_test_required is not True
            or entity.native_test_ref != context.ref
            or entity.builder_execution is not None
            or context.native_run_id is None
            or (
                entity.app_config.tenant_id,
                entity.app_config.app_id,
                entity.app_config.workflow_id,
                entity.user_id,
                entity.workflow_execution_id,
                entity.call_depth,
            )
            != (
                context.tenant_id,
                context.app_id,
                context.workflow_id,
                context.actor_id,
                context.native_run_id,
                context.call_depth,
            )
            or (queue._task_id, queue._user_id) != (entity.task_id, context.actor_id)
            or (workflow_repository._tenant_id, workflow_repository._app_id, workflow_repository._creator_user_id)
            != (context.tenant_id, context.app_id, context.actor_id)
            or (node_repository._tenant_id, node_repository._app_id, node_repository._creator_user_id)
            != (context.tenant_id, context.app_id, context.actor_id)
        ):
            raise ValueError("native_host_generation_identity_invalid")
        with self._registration:
            self._require_live()
            if self._generation_bindings is not None:
                raise ValueError("native_host_generation_rebound")
            self._generation_bindings = NativeHostGenerationBindings(
                entity, queue, response_filter, workflow_repository, node_repository
            )

    def restore_claimed_resume(self, *, lifecycle, expected_payload):
        """Reconstruct once through the actual same-store C03 claimed selector."""
        from services.dify_builder.native_testing.runtime import restore_claimed_host

        with self._registration:
            self._require_live()
            if self._resume_attempted or self._generation_bindings is not None:
                raise ValueError("native_resume_replayed")
            self._resume_attempted = True
        # Checkpoint/private IO and public reconstruction run outside host locks.
        bindings = restore_claimed_host(host=self, lifecycle=lifecycle, expected_payload=expected_payload)
        with self._registration:
            self._require_live()
            if self.lifetime.unknown or self._generation_bindings is not None:
                raise ValueError("native_resume_unavailable")
            self._resume_bindings, self._resume_lifecycle = bindings, lifecycle
        return bindings

    @property
    def resume_bindings(self):
        self._require_live()
        if self._resume_bindings is None:
            raise ValueError("native_resume_unavailable")
        return self._resume_bindings

    def require_resume_bindings(self, *, entity, runtime_state, response_filter):
        bindings = self.resume_bindings
        if (
            entity is not bindings.entity
            or runtime_state is not bindings.runtime_state
            or response_filter is not bindings.response_filter
        ):
            raise ValueError("native_resume_identity_mismatch")
        lifecycle = self._resume_lifecycle
        context = self.lifetime.context
        if lifecycle is None or lifecycle.store.load_context(ref=context.ref) != context:
            raise ValueError("native_resume_unavailable")
        if (
            lifecycle.claimed_resume_checkpoint(
                ref=context.ref, generation=context.generation, dispatch_id=self.lifetime.dispatch_id
            )
            != bindings.checkpoint
        ):
            raise ValueError("native_resume_unavailable")
        self._require_live()
        return bindings

    def require_resume_projection_bindings(self, *, entity, runtime_state, response_filter):
        """Diagnostic projection only; never used by resumed execution dispatch."""
        with self._evidence_reads.read():
            if self.boundary_owner.status != "STOP_RECORDED":
                return self.require_resume_bindings(
                    entity=entity, runtime_state=runtime_state, response_filter=response_filter
                )
            bindings = self.resume_bindings
            if (
                entity is not bindings.entity
                or runtime_state is not bindings.runtime_state
                or response_filter is not bindings.response_filter
                or self._stop_settlement is None
            ):
                raise ValueError("native_resume_identity_mismatch")
            self._stop_settlement.require_resume(bindings=bindings)
            return bindings

    def bind_resume_history(self, *, workflow_repository, node_repository):
        from services.dify_builder.native_testing.runtime import load_resume_history

        if self._resume_history is not None or self._generation_bindings is not None:
            raise ValueError("native_resume_history_rebound")
        history = load_resume_history(
            host=self, workflow_repository=workflow_repository, node_repository=node_repository
        )
        with self._registration:
            self._require_live()
            if self._resume_history is not None or self._generation_bindings is not None:
                raise ValueError("native_resume_history_rebound")
            self._resume_history = history
        return history

    def diagnostic_event(self, *, event):
        """Detach only the official zero-price HTTP container diagnostic field."""
        from decimal import Decimal

        from core.app.entities import queue_entities as queue
        from graphon.engine_events import (
            NodeRunIterationSucceededEvent,
            NodeRunLoopSucceededEvent,
            NodeRunSucceededEvent,
        )
        from graphon.engine_events.base import NodeEvent
        from graphon.enums import WorkflowNodeExecutionMetadataKey as Metadata
        from services.dify_builder.native_testing.observation_owner import (
            _stored_profile,
        )
        from services.dify_builder.native_testing.observation_privacy import (
            NativeHttpObservationPolicy,
        )
        from services.dify_builder.native_testing.sandbox.qualification import (
            NativeCodeBindingResolver,
        )

        result = event.node_run_result if isinstance(event, NodeEvent) else None
        metadata = (
            event.metadata
            if isinstance(
                event,
                (
                    NodeRunIterationSucceededEvent,
                    NodeRunLoopSucceededEvent,
                    queue.QueueIterationCompletedEvent,
                    queue.QueueLoopCompletedEvent,
                ),
            )
            else None
        )
        result_metadata = result.metadata if result is not None else None
        execution_metadata = event.execution_metadata if isinstance(event, queue.QueueNodeSucceededEvent) else None
        sources = [value for value in (metadata, result_metadata, execution_metadata) if type(value) is dict]
        if not any(type(value.get(Metadata.TOTAL_PRICE)) is Decimal for value in sources):
            return event
        guard = self.native_observation
        with guard.persistence_scope():
            engine = self.engine_bindings
            context = self.lifetime.context
            if self._journal is None:
                raise ValueError("native_journal_unavailable")
            state = self._journal._state
            from services.dify_builder.native_testing.state_store import (
                NativeExecutionStateStore,
            )

            if type(state) is not NativeExecutionStateStore:
                raise ValueError("native_state_unavailable")
            profile, _ = _stored_profile(state, context)
            resolver = state.loader.resolver
            options = (
                {"code_qualification": resolver.qualification} if type(resolver) is NativeCodeBindingResolver else {}
            )
            NativeHttpObservationPolicy.qualify(context=context, profile=profile, **options)
            native_types = (NodeRunIterationSucceededEvent, NodeRunLoopSucceededEvent, NodeRunSucceededEvent)
            queue_types = (
                queue.QueueIterationCompletedEvent,
                queue.QueueLoopCompletedEvent,
                queue.QueueNodeSucceededEvent,
            )
            if type(event) not in (*native_types, *queue_types):
                guard.fail()
            node = engine.entry.graph_engine.graph.nodes.get(event.node_id)
            execution_id = event.id if type(event) in native_types else event.node_execution_id
            if (
                not isinstance(node, (LoopNode, IterationNode))
                or node.execution_id != execution_id
                or node.node_type != event.node_type
                or node.runtime_state is not engine.runtime_state
                or not isinstance(node, _NativeControlBoundary)
                or node._native_control_owner is not self.boundary_owner
                or node._native_control_sink is not self.control_sink
            ):
                guard.fail()
            updates: dict[str, object] = {}
            for name, value in (
                ("metadata", metadata),
                ("node_run_result", result_metadata),
                ("execution_metadata", execution_metadata),
            ):
                if type(value) is dict and type(value.get(Metadata.TOTAL_PRICE)) is Decimal:
                    price = value[Metadata.TOTAL_PRICE]
                    if not isinstance(price, Decimal) or not price.is_finite() or price != 0:
                        guard.fail()
                    copied = {**dict(value), Metadata.TOTAL_PRICE: 0}
                    if name == "node_run_result":
                        if result is None:
                            guard.fail()
                        updates[name] = result.model_copy(update={"metadata": copied})
                    else:
                        updates[name] = copied
            return event.model_copy(update=updates)

    def require_resume_projection(self, *, guard, queue, entity=None, workflow_run_id=None):
        restored = self.resume_bindings
        self.require_resume_projection_bindings(
            entity=restored.entity, runtime_state=restored.runtime_state, response_filter=restored.response_filter
        )
        generation = self.generation_bindings
        history = self._resume_history
        if (
            guard is not self.native_observation
            or queue is not generation.queue
            or queue.native_host is not self
            or queue.native_observation is not guard
            or generation.entity is not restored.entity
            or (entity is not None and entity is not restored.entity)
            or generation.response_filter is not restored.response_filter
            or self.engine_bindings.runtime_state is not restored.runtime_state
            or history is None
            or history[0] is not generation.workflow_repository
            or history[1] is not generation.node_repository
            or history[2].id_ != self.lifetime.context.native_run_id
            or (workflow_run_id is not None and workflow_run_id != history[2].id_)
        ):
            raise ValueError("native_resume_projection_unavailable")

    def start_worker(self, *, worker: Thread) -> None:
        # No external caller .start gap: lifetime owns the actual start attempt.
        _ = self.generation_bindings
        self.lifetime.register_thread(thread=worker, role="worker")
        with self._registration:
            self._worker = worker
        self.lifetime.start_thread(thread=worker)

    def worker_finished(
        self, *, worker: Thread, exit_kind: Literal["returned", "policy_refused", "stopped", "failed"]
    ) -> None:
        if exit_kind not in ("returned", "policy_refused", "stopped", "failed"):
            raise ValueError("native_host_worker_exit_invalid")
        self.lifetime.thread_finished(thread=worker)
        with self._registration:
            self._exit_kind = exit_kind
        if exit_kind == "failed":
            self._unknown()

    def bind_cancellation_fence(self, *, fence):
        from services.dify_builder.native_testing.runtime import DifyNativeCancellationFence

        if (
            type(fence) is not DifyNativeCancellationFence
            or fence.delivery.ref != self.lifetime.ref
            or fence.delivery.dispatch_id != self.lifetime.dispatch_id
            or fence.delivery.generation != self.lifetime.generation
        ):
            raise ValueError("native_cancellation_owner_mismatch")
        with self._registration:
            if self._cancellation_fence is not None:
                raise ValueError("native_cancellation_owner_rebound")
            self._cancellation_fence = fence

    def wrap_commands(self, *, channel: CommandChannel) -> CommandChannel:
        try:
            valid = callable(channel.fetch_commands) and callable(channel.send_command)
        except AttributeError:
            valid = False
        if not valid:
            raise ValueError("native_host_command_channel_invalid")
        with self._registration:
            if self._channel is not None:
                raise ValueError("native_host_command_channel_rebound")
            self._channel = _HostCommandChannel(host=self, channel=channel)
            return self._channel

    @property
    def settlement_deadline(self) -> float | None:
        with self._registration:
            return self._deadline

    @property
    def http_timeout_snapshots(self) -> tuple[HttpTimeout, ...]:
        with self._registration:
            return tuple(self._prepared.values())

    def register_http_request(self, *, ref: NativeTestContextRef, binding: PreparedHttpBinding) -> None:
        # Journal/context checks may invoke an RPC; never hold registration lock.
        if (
            ref != self.lifetime.ref
            or type(binding) is not PreparedHttpBinding
            or type(binding.request) is not PreparedHttpRequest
            or binding.intent.kind != "http"
            or binding.intent.key.invocation_id != ref.invocation_id
        ):
            raise ValueError("native_host_http_binding_invalid")
        with self._registration:
            self._require_live()
            journal = self._journal
            if journal is None:
                raise ValueError("native_host_launch_retired")
        journal.resolve_cursor(ref=ref, key=binding.intent.key)
        timeout = _timeout(binding.request.timeout)
        key = operation_digest(binding.intent.key)
        with self._registration:
            self._require_live()
            previous = self._prepared.get(key)
            if previous is not None and previous != timeout:
                raise ValueError("native_host_http_timeout_drift")
            self._prepared[key] = timeout

    def bind_node_runtime(self, *, node: Node) -> None:
        """Observe actual marked native root/frame state, never a caller list."""
        if (
            not isinstance(node, Node)
            or not isinstance(node, _NativeControlBoundary)
            or node._native_control_owner is not self.boundary_owner
            or node._native_control_sink is not self.control_sink
        ):
            raise ValueError("native_host_node_required")
        runtime = node.runtime_state
        with self._registration:
            self._require_live()
            if not any(item is runtime for item in self._runtimes):
                self.lifetime.bind_runtime(runtime_state=runtime)
                self._runtimes.append(runtime)

    @contextmanager
    def _logical_node_scope(self, *, node: Node) -> Generator[None]:
        self.bind_node_runtime(node=node)
        with self.lifetime.node_scope(node=node, phase="run"):
            yield

    @contextmanager
    def node_scope(self, *, node: Node, phase: Literal["run", "resume_container"]) -> Generator[None]:
        self.bind_node_runtime(node=node)
        manager = self.lifetime.node_scope(node=node, phase=phase)
        actual = _HookScope(node, current_thread(), node.execution_id, manager)
        with self._registration:
            self._physical_phases.append(actual)
        try:
            with manager:
                yield
        finally:
            with self._registration:
                self._physical_phases.remove(actual)

    def _candidate_deadline(self) -> float:
        if self._deadline is not None:
            return self._deadline
        allowance = max(
            (sum(self._baseline), *(sum(item) for item in self._active_http.values()), *self._active_code.values())
        )
        return monotonic() + allowance

    def confirm_never_started(self) -> None:
        """Delegate actual startup-failure proof; release stays after cleanup."""
        self.lifetime.confirm_never_started()

    def request_close(self, *, reason: CloseReason) -> None:
        with self._registration:
            if self._retired:
                return  # Existing workflow-owner finally may close again.
            try:
                _ = self.lifetime.context
            except ValueError as error:
                if str(error) != "native_host_payload_retired":
                    raise
                return  # Physical consumption is not a new release/SQL ACK.
            if reason == "exhausted":
                self._stream_exhausted = True
            else:
                self._interrupted = True
            deadline = self._candidate_deadline()
            self.lifetime.request_close(reason=reason, deadline=deadline)
            self._deadline = deadline

    def _record_control(self, record: NativeControlRecord) -> None:
        with self._registration:
            if any(item is record for item in self._controls_seen):
                raise ValueError("native_host_control_replayed")
            if not any(item is record for item in self.boundary_owner.records):
                raise ValueError("native_host_control_not_recorded")
            deadline = self._candidate_deadline()
            self.lifetime.record_control(record=record, deadline=deadline)
            self._deadline = deadline
            self._controls_seen.append(record)

    def _unknown(self) -> None:
        self.boundary_owner._unknown("native_host_control_unknown")
        # Old/consumed verifier remains inert; never upgrade by IDs.
        with suppress(ValueError):
            self.lifetime.mark_unknown()

    def make_calls(
        self,
        *,
        state: NativeStatePort,
        authorization: ScalarAuthorizationPort,
        journal: NodeOperationJournal,
        max_result_bytes: int,
    ) -> HostBoundScalarCalls:
        self._require_live()
        if journal is not self._journal or authorization is not self._authorization:
            raise ValueError("native_host_scalar_owner_mismatch")
        calls = HostBoundScalarCalls(
            host=self,
            adapter=NativeCallAdapter(
                state=state, authorization=authorization, journal=journal, max_result_bytes=max_result_bytes
            ),
        )
        with self._registration:
            self._calls.append(calls)
        return calls


class DifyNativeControlSink:
    """Typed exact-scope control, acknowledged only by mandatory durable owners."""

    def __init__(self, host: NativeHostLaunch) -> None:
        self._host = host

    def record_control(self, *, record: NativeControlRecord) -> NativeControlAccepted | NativeControlRefused:
        host = self._host
        try:
            if type(record) is not NativeControlRecord:
                raise ValueError("native_host_control_invalid")
            control = record.control
            if type(control) is NativeApprovalWait:
                ApprovalWait(pending_operation_id=control.pending_operation_id, wait_reason=control.wait_reason)
            elif type(control) is NativePolicyStop:
                PolicyStop(reason_code=control.reason_code)
            else:
                raise ValueError("native_host_control_invalid")
            # Arms the lifetime BEFORE admission RPC/mutex can block this sink.
            host._record_control(record)
        except BaseException:
            host._unknown()
            return NativeControlRefused()
        try:
            if type(control) is NativePolicyStop:
                if host._deadline is None:
                    raise ValueError("native_host_control_late")
                host._evidence_reads.begin_stop(record=record, deadline=host._deadline)
            with host._admission:
                if host.lifetime.unknown or host._deadline is None or monotonic() > host._deadline:
                    raise ValueError("native_host_control_late")
                if isinstance(control, NativeApprovalWait):
                    if host._fence_pending is None:
                        raise ValueError("native_host_launch_retired")
                    result = host._fence_pending(
                        ref=host.lifetime.ref,
                        pending_operation_ids=(control.pending_operation_id,),
                        expected_generation=host.lifetime.generation,
                    )
                else:
                    if host._stop_sealer is None:
                        raise ValueError("native_host_launch_retired")
                    result = host._stop_sealer.seal_stop(
                        ref=host.lifetime.ref,
                        expected_generation=host.lifetime.generation,
                        dispatch_id=host.lifetime.dispatch_id,
                        reason_code=control.reason_code,
                    )
                if result is not None:
                    raise ValueError("native_host_control_ack_invalid")
                if host.lifetime.unknown or host._deadline is None or monotonic() > host._deadline:
                    raise ValueError("native_host_control_late")
            if type(control) is NativePolicyStop:
                # No SQL/private reads or callbacks under registration locks.
                settlement = NativeStopSettlement(host=host, record=record)
                with host._registration:
                    if host._stop_settlement is not None or host.lifetime.unknown:
                        raise ValueError("native_stop_settlement_replayed")
                    host._stop_settlement = settlement
                host._evidence_reads.finish_stop(record=record, acknowledged=True)
            return NativeControlAccepted(record=record)
        except BaseException:
            host._unknown()
            if type(control) is NativePolicyStop:
                host._evidence_reads.finish_stop(record=record, acknowledged=False)
            return NativeControlRefused()


class HostBoundScalarCalls:
    """Reuse the real adapter/ledger; ticket starts before any admission RPC."""

    def __init__(self, *, host: NativeHostLaunch, adapter: NativeCallAdapter) -> None:
        self._host = host
        self._adapter: NativeCallAdapter | None = adapter

    def call(
        self, *, ref: NativeTestContextRef, intent: EffectIntent, dispatch: Callable[[DispatchPermit], JsonValue]
    ) -> JsonValue:
        host = self._host
        if ref != host.lifetime.ref or intent.kind != "http":
            raise NativePolicyStop(ref=ref, reason_code="native_host_capability_unqualified")
        with host.lifetime.call_scope() as ticket:
            with host._registration:
                timeout = host._prepared.get(operation_digest(intent.key))
                if timeout is None:
                    raise NativePolicyStop(ref=ref, reason_code="native_host_http_binding_missing")
                host._active_http[ticket] = timeout
            held = False

            def owned_dispatch(permit: DispatchPermit) -> JsonValue:
                nonlocal held
                try:
                    with ticket.callback_scope():
                        if not host.boundary_owner.dispatch_admissible:
                            raise ValueError("native_host_callback_controlled")
                        host._admission.release()
                        held = False
                        return dispatch(permit)
                finally:
                    if held:
                        host._admission.release()
                        held = False

            try:
                host._admission.acquire()
                held = True
                adapter = self._adapter
                if adapter is None:
                    raise ValueError("native_host_launch_retired")
                return adapter.call(ref=ref, intent=intent, dispatch=owned_dispatch)
            finally:
                if held:
                    host._admission.release()
                with host._registration:
                    host._active_http.pop(ticket)


class HostBoundCodeCalls:
    """Explicit Code-only C02 wrapper; no profile or production caller is installed.

    The caller obtains its exact active ticket only inside the claimed callback.
    This allows the Code owner to register physical ownership before reservation.
    """

    def __init__(self, *, host: NativeHostLaunch, adapter: NativeCallAdapter, allowance: float):
        if type(allowance) not in (float, int) or not isfinite(allowance) or allowance <= 0:
            raise ValueError("native_code_budget_invalid")
        self._host, self._adapter, self._allowance = host, adapter, allowance
        self._callback = None

    def ticket(self, *, permit: DispatchPermit) -> NativeHostCallTicket:
        current = self._callback
        if current is None or current[0] is not permit or current[2] is not current_thread():
            raise ValueError("native_code_claimed_callback_required")
        return current[1]

    def call(
        self, *, ref: NativeTestContextRef, intent: EffectIntent, dispatch: Callable[[DispatchPermit], JsonValue]
    ) -> JsonValue:
        host = self._host
        if ref != host.lifetime.ref or intent.kind != "code" or self._callback is not None:
            raise NativePolicyStop(ref=ref, reason_code="native_host_capability_unqualified")
        with host.lifetime.call_scope() as ticket:
            with host._registration:
                host._active_code[ticket] = self._allowance
            held = False

            def owned_dispatch(permit):
                nonlocal held
                try:
                    with ticket.callback_scope():
                        if not host.boundary_owner.dispatch_admissible:
                            raise ValueError("native_host_callback_controlled")
                        self._callback = (permit, ticket, current_thread())
                        host._admission.release()
                        held = False
                        return dispatch(permit)
                finally:
                    self._callback = None
                    if held:
                        host._admission.release()
                        held = False

            try:
                host._admission.acquire()
                held = True
                return self._adapter.call(ref=ref, intent=intent, dispatch=owned_dispatch)
            finally:
                if held:
                    host._admission.release()
                with host._registration:
                    host._active_code.pop(ticket)
