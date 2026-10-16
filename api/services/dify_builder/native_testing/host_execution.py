"""Private Dify launch ownership; no production wiring or durable authority.

The admitted server owner supplies the actual lifetime and mandatory C03 fence
and stop sealer. NativeCallAdapter and the existing journal retain all C02/C03
scalar authority. This module neither creates another ledger nor commits waits.
"""

from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from math import isfinite
from threading import Lock, RLock, Thread, current_thread
from time import monotonic
from typing import Literal, Protocol, override

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.workflow_entry import WorkflowEntry
from graphon.filters import ResponseStreamFilter
from graphon.graph_engine.command_channels import CommandChannel
from graphon.graph_engine.entities.commands import GraphEngineCommand
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events.base import GraphEngineEvent, GraphNodeEventBase
from graphon.nodes.base.node import Node
from graphon.runtime.graph_runtime_state import GraphRuntimeState
from services.dify_builder.native_testing.call_adapter import NativeCallAdapter, ScalarAuthorizationPort
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectIntent,
    JsonValue,
    NativeTestContextRef,
    PolicyStop,
    operation_digest,
)
from services.dify_builder.native_testing.control import (
    BoundaryOwnerState,
    NativeApprovalWait,
    NativeControlAccepted,
    NativeControlRecord,
    NativeControlRefused,
    NativePolicyStop,
)
from services.dify_builder.native_testing.host_lifetime import CloseReason, NativeHostCallTicket, NativeHostLifetime
from services.dify_builder.native_testing.http_adapter import PreparedHttpBinding, PreparedHttpRequest
from services.dify_builder.native_testing.http_binding import NativeHttpBindingProducer
from services.dify_builder.native_testing.operation_journal import JournalAuthorizationPort, NodeOperationJournal
from services.dify_builder.native_testing.runtime_contracts import NativeStatePort, ResolvedNativeTestContext

HttpTimeout = tuple[float | int, ...]


class HostAuthorizationPort(JournalAuthorizationPort, ScalarAuthorizationPort, Protocol):
    """The SAME existing C02 authorization owner, no new authority methods."""


class NativePendingFence(Protocol):
    def __call__(
        self, *, ref: NativeTestContextRef, pending_operation_ids: tuple[str, ...], expected_generation: int
    ) -> None: ...


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
    queue: AppQueueManager
    response_filter: ResponseStreamFilter
    workflow_repository: SQLAlchemyWorkflowExecutionRepository
    node_repository: SQLAlchemyWorkflowNodeExecutionRepository


class _HostCommandChannel:
    def __init__(self, *, host: NativeHostLaunch, channel: CommandChannel) -> None:
        self._host = host
        self._channel: CommandChannel | None = channel

    def fetch_commands(self) -> list[GraphEngineCommand]:
        if self._channel is None:
            raise ValueError("native_host_launch_retired")
        self._host.lifetime.observe_dispatcher()
        return self._channel.fetch_commands()

    def send_command(self, command: GraphEngineCommand) -> None:
        if self._channel is None:
            raise ValueError("native_host_launch_retired")
        self._channel.send_command(command)


@dataclass(frozen=True, slots=True)
class NativeHostEngineBindings:
    entry: WorkflowEntry
    runtime_state: GraphRuntimeState
    response_filter: ResponseStreamFilter
    commands: CommandChannel


@dataclass(eq=False, slots=True)
class _HookScope:
    node: Node
    thread: Thread
    execution_id: str
    context: AbstractContextManager[None]


class _HostObservationLayer(GraphEngineLayer):
    """Install FIRST via public GraphEngine.layer; observe hooks only."""

    def __init__(self, host: NativeHostLaunch) -> None:
        super().__init__()
        self._host = host
        self._hooks: list[_HookScope] = []

    @override
    def on_graph_start(self) -> None:
        if self._host._engine_bindings is None:
            self._host._unknown()

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        pass

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        if self._hooks:
            self._host._unknown()

    @override
    def on_node_run_start(self, node: Node) -> None:
        try:
            scope = self._host.node_scope(node=node, phase="run")
            scope.__enter__()
            with self._host._registration:
                self._hooks.append(_HookScope(node, current_thread(), node.execution_id, scope))
        except BaseException:
            self._host._unknown()
            node.graph_runtime_state.graph_execution.abort("native_host_observation_failed")

    @override
    def on_node_run_end(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        with self._host._registration:
            scope = next(
                (
                    item
                    for item in self._hooks
                    if item.node is node and item.thread is current_thread() and item.execution_id == node.execution_id
                ),
                None,
            )
            if scope is not None:
                self._hooks.remove(scope)
        # Native resume_container skips its start hook; the existing concrete
        # boundary's node_scope still owns that work through actual closure.
        if scope is not None:
            try:
                scope.context.__exit__(
                    type(error) if error is not None else None,
                    error,
                    error.__traceback__ if error is not None else None,
                )
            except BaseException:
                self._host._unknown()


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
            or not callable(getattr(stop_sealer, "seal_stop", None))
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
        self._runtimes: list[GraphRuntimeState] = []
        self._controls_seen: list[NativeControlRecord] = []
        self._calls: list[HostBoundScalarCalls] = []
        self._generation_bindings: NativeHostGenerationBindings | None = None
        self._channel: _HostCommandChannel | None = None
        self._exit_kind: str | None = None
        self._engine_bindings: NativeHostEngineBindings | None = None
        self._layer: _HostObservationLayer | None = _HostObservationLayer(self)
        self._producers: list[NativeHttpBindingProducer] = []
        self._release: Callable[[], None] | None = None
        self._retired = False
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
        runtime_state: GraphRuntimeState,
        response_filter: ResponseStreamFilter,
        commands: CommandChannel,
    ) -> None:
        generation = self.generation_bindings
        if (
            type(entry) is not WorkflowEntry
            or entry.graph_engine.graph_runtime_state is not runtime_state
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

    def observation_layer(self) -> GraphEngineLayer:
        with self._registration:
            self._require_live()
            if self._layer is None:
                raise ValueError("native_host_launch_retired")
            return self._layer

    @property
    def proposal_producers(self) -> tuple[NativeHttpBindingProducer, ...]:
        with self._registration:
            self._require_live()
            return tuple(self._producers)

    def register_proposals(self, *, producer: NativeHttpBindingProducer) -> None:
        # Creation-site structural retention only. The later stream owner calls
        # each real approval_proposals() after quiescence, outside these locks.
        if (
            type(producer) is not NativeHttpBindingProducer
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
            release, self._release = self._release, None
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
            self._layer = None
            self.boundary_owner._unknown("native_host_retired")
            self.boundary_owner._records.clear()
            self.boundary_owner._accepted.clear()
            self._producers.clear()
            self._runtimes.clear()
            self._prepared.clear()
            self._controls_seen.clear()
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
        queue: AppQueueManager,
        response_filter: ResponseStreamFilter,
        workflow_repository: SQLAlchemyWorkflowExecutionRepository,
        node_repository: SQLAlchemyWorkflowNodeExecutionRepository,
    ) -> None:
        context = self.lifetime.context
        if (
            type(entity) is not WorkflowAppGenerateEntity
            or not isinstance(queue, AppQueueManager)
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

    def start_worker(self, *, worker: Thread) -> None:
        # No external caller .start gap: lifetime owns the actual start attempt.
        _ = self.generation_bindings
        self.lifetime.register_thread(thread=worker, role="worker")
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

    def wrap_commands(self, *, channel: CommandChannel) -> CommandChannel:
        if not callable(getattr(channel, "fetch_commands", None)) or not callable(
            getattr(channel, "send_command", None)
        ):
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
            or getattr(node, "_native_control_owner", None) is not self.boundary_owner
            or getattr(node, "_native_control_sink", None) is not self.control_sink
        ):
            raise ValueError("native_host_node_required")
        runtime = node.graph_runtime_state
        with self._registration:
            self._require_live()
            if not any(item is runtime for item in self._runtimes):
                self.lifetime.bind_runtime(runtime_state=runtime)
                self._runtimes.append(runtime)

    @contextmanager
    def node_scope(self, *, node: Node, phase: Literal["run", "resume_container"]) -> Generator[None]:
        self.bind_node_runtime(node=node)
        with self.lifetime.node_scope(node=node, phase=phase):
            yield

    def _candidate_deadline(self) -> float:
        if self._deadline is not None:
            return self._deadline
        allowance = max((sum(self._baseline), *(sum(item) for item in self._active_http.values())))
        return monotonic() + allowance

    def request_close(self, *, reason: CloseReason) -> None:
        with self._registration:
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
        try:
            self.lifetime.mark_unknown()
        except ValueError:
            pass  # Old/consumed verifier remains inert; never upgrade by IDs.

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
            return NativeControlAccepted(record=record)
        except BaseException:
            host._unknown()
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
