"""Actual launch/Graphon/journal/scalar composition; labeled C02/C03/cache doubles.

No SQL execution, provider I/O, production DI, or durable stop sealer is claimed.
"""

from __future__ import annotations

import importlib
import importlib.util
from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Barrier, Event, Thread, current_thread
from time import monotonic, sleep
from types import ModuleType
from typing import TYPE_CHECKING, cast, override

import pytest

from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events.node import NodeRunStartedEvent
from graphon.nodes.container_effects import IterationFrameRequest
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    JsonValue,
    NativeTestContextRef,
    WaitingReceipt,
)
from services.dify_builder.native_testing.control import (
    NativeApprovalWait,
    NativeControlAccepted,
    NativeControlRecord,
    NativeControlRefused,
    NativePolicyStop,
)
from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime, NativeHostLifetimeRegistry
from services.dify_builder.native_testing.http_adapter import PreparedHttpBinding, PreparedHttpRequest
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import (
    INPUT,
    PATH,
    REF,
    Authorization,
    State,
)
from tests.unit_tests.services.dify_builder.native_testing.test_control import (
    Observations,
    bound_guard,
    make_native,
    observed_iteration_config,
    permit,
)

if TYPE_CHECKING:
    from services.dify_builder.native_testing.host_execution import DurableNativeStopSealer, NativeHostLaunch
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore


def host_module() -> ModuleType:
    name = "services.dify_builder.native_testing.host_execution"
    assert importlib.util.find_spec(name) is not None, "host launch composition is missing"
    return importlib.import_module(name)


class NoCheckpointLifecycle:
    def pause(self, *, ref, checkpoint, pending_operation_ids, expected_generation) -> WaitingReceipt:
        _ = ref, checkpoint, pending_operation_ids, expected_generation
        raise AssertionError("launch phase must never commit waiting")


@dataclass
class DurablePorts:
    """C03 fence/stop commit stand-ins: capture exact arguments, no SQL proof."""

    fences: list[tuple[NativeTestContextRef, tuple[str, ...], int]] = field(default_factory=list)
    stops: list[tuple[NativeTestContextRef, int, str, str]] = field(default_factory=list)
    error: BaseException | None = None
    result: object = None
    entered: Event | None = None
    release: Event | None = None
    on_fence: Callable[[], None] | None = None

    def fence_pending(
        self, *, ref: NativeTestContextRef, pending_operation_ids: tuple[str, ...], expected_generation: int
    ) -> None:
        self.fences.append((ref, pending_operation_ids, expected_generation))
        if self.on_fence is not None:
            self.on_fence()
        if self.entered is not None:
            self.entered.set()
        if self.release is not None:
            self.release.wait(2)
        if self.error is not None:
            raise self.error
        return cast(None, self.result)

    def seal_stop(
        self, *, ref: NativeTestContextRef, expected_generation: int, dispatch_id: str, reason_code: str
    ) -> None:
        self.stops.append((ref, expected_generation, dispatch_id, reason_code))
        if self.error is not None:
            raise self.error
        return cast(None, self.result)


class LaunchCase:
    def __init__(self, *, baseline: tuple[float | int, ...] = (0.02, 0.02, 0.02), activate: bool = True) -> None:
        module = host_module()
        self.events = []
        self.state = State(self.events)
        self.state.context = self.state.context.model_copy(update={"workflow_id": "control-unit"})
        self.authorization = Authorization(self.events)
        self.journal = NodeOperationJournal(state=self.state, authorization=self.authorization)
        self.cursor = self.journal.open(ref=REF, occurrence_path=PATH)
        self.cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
        self.registry = NativeHostLifetimeRegistry()
        self.lifetime = NativeHostLifetime(context=self.state.context, dispatch_id="dispatch")
        if activate:
            self.registry.activate(lifetime=self.lifetime)
        self.ports = DurablePorts()
        self.host: NativeHostLaunch = module.NativeHostLaunch(
            context=self.state.context,
            dispatch_id="dispatch",
            lifetime=self.lifetime,
            journal=self.journal,
            checkpoints=NativeCheckpointBridge(state=self.state, lifecycle=NoCheckpointLifecycle()),
            fence_pending=self.ports.fence_pending,
            stop_sealer=self.ports,
            authorization=self.authorization,
            http_baseline=baseline,
        )

    def prepared(self, *, timeout: tuple[float | int, ...] = (0.02, 0.02, 0.02)) -> PreparedHttpBinding:
        from services.dify_builder.execution_contracts import canonical_digest
        from services.dify_builder.native_testing.contracts import EffectIntent

        intent = EffectIntent(
            key=self.cursor.next_key(),
            kind="http",
            resource_ref="endpoint",
            implementation_revision="v1",
            account_ref="account",
            target="https://example.invalid/synthetic",
            parameters={"value": True},
            input_digest=canonical_digest(INPUT),
            capability_digest="c" * 64,
        )
        request = PreparedHttpRequest(
            method="GET",
            url="https://example.invalid/synthetic",
            headers=(),
            content=b"",
            _semantic=b"{}",
            timeout=timeout,
            ssl_verify=True,
            follow_redirects=False,
        )
        binding = PreparedHttpBinding(request=request, intent=intent)
        self.host.register_http_request(ref=REF, binding=binding)
        return binding

    def calls(self):
        return self.host.make_calls(
            state=self.state, authorization=self.authorization, journal=self.journal, max_result_bytes=4096
        )

    def own_node(self):
        from dataclasses import replace

        from tests.unit_tests.services.dify_builder.native_testing.test_control import Effects, Sink

        _, factory = make_native(decision=permit(), ownership=cast(Observations, self.host))
        factory = replace(
            factory,
            owner=self.host.boundary_owner,
            sink=cast(Sink, self.host.control_sink),
            effects=Effects(self.host.boundary_owner, permit()),
        )
        node = bound_guard(factory)
        self.host.bind_node_runtime(node=node)
        return node


def record(case: LaunchCase, node, *, stop: bool = False) -> NativeControlRecord:
    control = (
        NativePolicyStop(ref=REF, reason_code="outcome_unknown")
        if stop
        else NativeApprovalWait(ref=REF, pending_operation_id="pending", wait_reason="approval")
    )
    value = NativeControlRecord(
        control=control, node_id=node.id, native_execution_id=node.execution_id, carrier_ref="carrier"
    )
    case.host.boundary_owner._begin(value)
    return value


def test_launch_requires_exact_context_and_mandatory_durable_stop_port() -> None:
    case = LaunchCase()
    assert case.host.boundary_owner.ref is case.state.context.ref
    assert case.host.lifetime is case.lifetime
    with pytest.raises(ValueError):
        case.host.make_calls(
            state=case.state,
            authorization=case.authorization,
            journal=NodeOperationJournal(state=case.state, authorization=case.authorization),
            max_result_bytes=4096,
        )


def test_scalar_completion_replays_real_journal_without_extra_claim_or_key() -> None:
    case = LaunchCase()
    binding = case.prepared()
    calls = case.calls()
    dispatched: list[str] = []

    def physical(permit: DispatchPermit) -> JsonValue:
        dispatched.append(permit.operation_id)
        return {"typed": [False, 2, "2", None]}

    assert calls.call(ref=REF, intent=binding.intent, dispatch=physical) == {"typed": [False, 2, "2", None]}
    assert calls.call(ref=REF, intent=binding.intent, dispatch=physical) == {"typed": [False, 2, "2", None]}
    assert dispatched == ["operation-0"]
    assert len(case.authorization.claimed) == 1
    assert case.cursor.snapshot().operation_keys == (binding.intent.key,)
    assert case.cursor.snapshot().result_refs == ("result-0",)


@pytest.mark.parametrize(
    "timeout", [(0, 1, 1), (1, float("inf"), 1), (1, float("nan"), 1), (True, 1, 1), (1, 2), (1, 2, 3, None)]
)
def test_nonfinite_or_nonpositive_http_baseline_is_refused(timeout: tuple) -> None:
    with pytest.raises(ValueError):
        LaunchCase(baseline=timeout)


def test_actual_prepared_timeout_snapshot_contributes_to_max_sum_and_fixed_deadline() -> None:
    case = LaunchCase(baseline=(1, 2, 3))
    binding = case.prepared(timeout=(2, 3, 4, 5))
    assert case.host.http_timeout_snapshots == ((2, 3, 4, 5),)
    entered, release = Event(), Event()
    errors: list[BaseException] = []

    def physical(_permit: DispatchPermit) -> JsonValue:
        entered.set()
        release.wait(2)
        return None

    def call() -> None:
        try:
            case.calls().call(ref=REF, intent=binding.intent, dispatch=physical)
        except BaseException as exc:
            errors.append(exc)

    thread = Thread(target=call)
    thread.start()
    try:
        assert entered.wait(1)
        before = monotonic()
        case.host.request_close(reason="cancel")
        deadline = case.host.settlement_deadline
        assert deadline is not None
        assert before + 14 <= deadline <= monotonic() + 14
        case.host.request_close(reason="consumer_closed")
        assert case.host.settlement_deadline == deadline
    finally:
        release.set()
        thread.join(2)
    assert errors == []


@pytest.mark.parametrize("stop", [False, True])
def test_typed_control_is_accepted_only_after_exact_durable_port_ack(stop: bool) -> None:
    case = LaunchCase()
    node = case.own_node()
    with case.host.node_scope(node=node, phase="run"):
        value = record(case, node, stop=stop)
        result = case.host.control_sink.record_control(record=value)
        assert type(result) is NativeControlAccepted
        assert result.record is value
    if stop:
        assert case.ports.stops == [(REF, 0, "dispatch", "outcome_unknown")]
        assert case.ports.fences == []
    else:
        assert case.ports.fences == [(REF, ("pending",), 0)]
        assert case.ports.stops == []


@pytest.mark.parametrize("failure", ["non-none", "lost-ack"])
def test_ambiguous_fence_never_retries_or_accepts(failure: str) -> None:
    case = LaunchCase()
    case.ports.result = False if failure == "non-none" else None
    case.ports.error = RuntimeError("lost acknowledgement") if failure == "lost-ack" else None
    node = case.own_node()
    with case.host.node_scope(node=node, phase="run"):
        value = record(case, node)
        assert type(case.host.control_sink.record_control(record=value)) is NativeControlRefused
        assert type(case.host.control_sink.record_control(record=value)) is NativeControlRefused
    assert case.lifetime.unknown
    assert len(case.ports.fences) == 1


def test_registered_callback_releases_admission_mutex_before_real_io() -> None:
    case = LaunchCase()
    binding = case.prepared()
    control_done, release = Event(), Event()
    errors: list[BaseException] = []
    node = case.own_node()

    def control() -> None:
        try:
            with case.host.node_scope(node=node, phase="run"):
                value = record(case, node)
                assert type(case.host.control_sink.record_control(record=value)) is NativeControlAccepted
        except BaseException as exc:
            errors.append(exc)
        finally:
            control_done.set()

    def physical(_permit: DispatchPermit) -> JsonValue:
        thread = Thread(target=control)
        thread.start()
        try:
            assert control_done.wait(0.3), "physical IO must not hold admission mutex"
        finally:
            release.set()
            thread.join(2)
        return None

    assert case.calls().call(ref=REF, intent=binding.intent, dispatch=physical) is None
    assert errors == []


def generation_objects(case: LaunchCase, monkeypatch: pytest.MonkeyPatch):
    from sqlalchemy.orm import sessionmaker

    from core.app.app_config.entities import WorkflowUIBasedAppConfig
    from core.app.apps import base_app_queue_manager
    from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from graphon.filters import ResponseStreamFilter
    from models.account import Account
    from models.model import AppMode

    # Only Redis ownership-cache side effect is replaced. Queue, entities and
    # synchronous repositories run their actual constructors; no SQL is invoked.
    monkeypatch.setattr(base_app_queue_manager.redis_client, "setex", lambda *_args: None)
    context = case.state.context
    assert context.native_run_id is not None
    entity = WorkflowAppGenerateEntity(
        task_id="task",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            workflow_id=context.workflow_id,
            app_mode=AppMode.WORKFLOW,
        ),
        inputs=INPUT,
        files=[],
        user_id=context.actor_id,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id=context.native_run_id,
        native_test_required=True,
        native_test_ref=context.ref,
    )
    queue = WorkflowAppQueueManager(
        task_id=entity.task_id, user_id=context.actor_id, invoke_from=InvokeFrom.DEBUGGER, app_mode="workflow"
    )
    user = Account(name="Synthetic actor", email="synthetic@example.invalid")
    user.id = context.actor_id
    factory = sessionmaker()
    workflow_repo = SQLAlchemyWorkflowExecutionRepository(factory, context.tenant_id, user, context.app_id, None)
    node_repo = SQLAlchemyWorkflowNodeExecutionRepository(factory, context.tenant_id, user, context.app_id, None)
    return entity, queue, ResponseStreamFilter(), workflow_repo, node_repo


def bind_generation(case: LaunchCase, monkeypatch: pytest.MonkeyPatch):
    entity, queue, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    case.host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    return entity, queue, response_filter, workflow_repo, node_repo


def test_generation_binds_exact_actual_instances_and_refuses_rebinding_or_foreign_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = LaunchCase()
    entity, queue, response_filter, workflow_repo, node_repo = bind_generation(case, monkeypatch)
    actual = case.host.generation_bindings
    assert actual.entity is entity
    assert actual.queue is queue
    assert actual.response_filter is response_filter
    assert actual.workflow_repository is workflow_repo
    assert actual.node_repository is node_repo
    with pytest.raises(ValueError):
        case.host.bind_generation(
            entity=entity,
            queue=queue,
            response_filter=response_filter,
            workflow_repository=workflow_repo,
            node_repository=node_repo,
        )
    other = LaunchCase()
    entity.workflow_execution_id = "foreign-run"
    with pytest.raises(ValueError):
        other.host.bind_generation(
            entity=entity,
            queue=queue,
            response_filter=response_filter,
            workflow_repository=workflow_repo,
            node_repository=node_repo,
        )


def test_owned_start_refusal_and_actual_start_exception_are_retained(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase(activate=False)
    bind_generation(case, monkeypatch)
    ran = Event()
    thread = Thread(target=ran.set)
    with pytest.raises(ValueError):
        case.host.start_worker(worker=thread)
    assert thread.ident is None
    assert not ran.is_set()
    case.registry.activate(lifetime=case.lifetime)

    class FailedStart(Thread):
        @override
        def start(self) -> None:
            raise RuntimeError("actual startup failed")

    failed = FailedStart()
    with pytest.raises(RuntimeError, match="actual startup failed"):
        case.host.start_worker(worker=failed)
    case.host.request_close(reason="failed")
    assert case.lifetime.settle() == "settled"
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")


def test_worker_finally_callback_never_substitutes_for_actual_thread_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    bind_generation(case, monkeypatch)
    finished, release = Event(), Event()

    def run() -> None:
        case.host.worker_finished(worker=current_thread(), exit_kind="returned")
        finished.set()
        release.wait(2)

    thread = Thread(target=run)
    case.host.start_worker(worker=thread)
    try:
        assert finished.wait(1)
        case.host.request_close(reason="cancel")
        assert case.lifetime.settle() == "unknown"
        assert thread.is_alive()
        with pytest.raises(ValueError):
            case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
    finally:
        release.set()
        thread.join(2)
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
    assert case.lifetime.unknown


def test_command_wrapper_delegates_actual_channel_and_retains_polling_dispatcher() -> None:
    from graphon.graph_engine.entities.commands import AbortCommand

    case = LaunchCase()
    channel = InMemoryChannel()
    wrapper = case.host.wrap_commands(channel=channel)
    command = AbortCommand(reason="stop")
    wrapper.send_command(command)
    results = []

    def dispatch() -> None:
        results.extend(wrapper.fetch_commands())

    dispatcher = Thread(target=dispatch)
    dispatcher.start()
    dispatcher.join(1)
    assert results == [command]
    assert wrapper.fetch_commands is not channel.fetch_commands
    with pytest.raises(ValueError):
        case.host.wrap_commands(channel=InMemoryChannel())


def native_entry(case: LaunchCase, monkeypatch: pytest.MonkeyPatch, *, iteration: bool = False, bind: bool = True):
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
    from core.workflow.workflow_entry import WorkflowEntry
    from graphon.graph import Graph
    from graphon.graph_engine import GraphEngine
    from graphon.runtime import GraphRuntimeState, VariablePool
    from tests.unit_tests.services.dify_builder.native_testing.test_control import Effects, Factory, Sink, basic

    _, _, response_filter, _, _ = bind_generation(case, monkeypatch)
    runtime = GraphRuntimeState(variable_pool=VariablePool(), start_at=monotonic())
    runtime.variable_pool.add(("start", "items"), ["a", "b"])
    config = observed_iteration_config() if iteration else basic()
    factory = Factory(
        config=config,
        runtime=runtime,
        owner=case.host.boundary_owner,
        sink=cast(Sink, case.host.control_sink),
        effects=Effects(case.host.boundary_owner, permit()),
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    commands = case.host.wrap_commands(channel=InMemoryChannel())
    context = case.state.context
    entry = WorkflowEntry(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
        graph_config=config,
        graph=graph,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        variable_pool=runtime.variable_pool,
        graph_runtime_state=runtime,
        command_channel=commands,
        response_stream_filter=response_filter,
    )
    # Real entry constructor ran. Use a fresh public engine to make host layer
    # literally FIRST; upcoming Dify DI must do that inside WorkflowEntry itself.
    entry.graph_engine = GraphEngine(
        workflow_id=context.workflow_id, graph=graph, graph_runtime_state=runtime, command_channel=commands
    )
    entry.graph_engine.layer(case.host.observation_layer())
    if bind:
        case.host.bind_engine(entry=entry, runtime_state=runtime, response_filter=response_filter, commands=commands)
    return entry, factory


def test_engine_retains_actual_entry_filter_runtime_channel_and_rejects_rebind(monkeypatch: pytest.MonkeyPatch) -> None:
    from graphon.filters import ResponseStreamFilter

    case = LaunchCase()
    entry, factory = native_entry(case, monkeypatch)
    actual = case.host.engine_bindings
    assert actual.entry is entry
    assert actual.runtime_state is factory.runtime
    assert actual.response_filter is case.host.generation_bindings.response_filter
    assert actual.commands is entry.command_channel
    with pytest.raises(ValueError):
        case.host.bind_engine(
            entry=entry,
            runtime_state=factory.runtime,
            response_filter=ResponseStreamFilter(),
            commands=entry.command_channel,
        )


def test_first_real_native_hook_is_owned_before_later_start_hook_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    from graphon.graph_engine.layers import GraphEngineLayer

    case = LaunchCase()
    entry, factory = native_entry(case, monkeypatch)
    entered, release = Event(), Event()
    errors: list[BaseException] = []

    class LaterHook(GraphEngineLayer):
        def on_graph_start(self) -> None:
            pass

        def on_graph_end(self, error) -> None:
            pass

        def on_event(self, event) -> None:
            pass

        @override
        def on_node_run_start(self, node) -> None:
            if node.id == "guard":
                entered.set()
                release.wait(2)

    entry.graph_engine.layer(LaterHook())

    def run() -> None:
        try:
            list(entry.graph_engine.run())
        except BaseException as exc:
            errors.append(exc)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    worker = Thread(target=run)
    case.host.start_worker(worker=worker)
    try:
        assert entered.wait(1)
        scopes = [scope for scope in case.lifetime.active_node_scopes if scope.node.id == "guard"]
        assert len(scopes) == 1
        assert scopes[0].node is entry.graph_engine.graph.nodes["guard"]
        assert scopes[0].runtime_state is factory.runtime
        assert scopes[0].thread is not worker
        assert scopes[0].thread.is_alive()
        case.host.request_close(reason="cancel")
        assert case.lifetime.settle() == "unknown"
        assert case.lifetime.active_node_scopes
    finally:
        release.set()
        worker.join(2)
    assert errors == []
    assert case.lifetime.active_node_scopes == ()
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")


def test_actual_native_resume_container_scope_is_retained_across_its_yield(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    entry, factory = native_entry(case, monkeypatch, iteration=True)
    container = entry.graph_engine.graph.nodes["container"]
    container.bind_execution_id("actual-resume")
    initial = list(container.run())
    frame = next(event for event in initial if isinstance(event, IterationFrameRequest))
    started_at = next(event.start_at for event in initial if isinstance(event, NodeRunStartedEvent))
    stream = container.resume_container(result=frame, started_at=started_at)
    entered, release = Event(), Event()

    def run() -> None:
        try:
            next(stream)
            entered.set()
            release.wait(2)
        finally:
            stream.close()
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    worker = Thread(target=run)
    case.host.start_worker(worker=worker)
    try:
        assert entered.wait(1)
        (scope,) = case.lifetime.active_node_scopes
        assert scope.node is container
        assert scope.runtime_state is factory.runtime
        assert scope.thread is worker
        assert scope.phase == "resume_container"
        case.host.request_close(reason="consumer_closed")
        assert case.lifetime.settle() == "unknown"
    finally:
        release.set()
        worker.join(2)
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")


def test_launch_identity_is_not_replaceable_and_retirement_requires_real_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = LaunchCase()
    bind_generation(case, monkeypatch)
    with pytest.raises(AttributeError):
        case.host.lifetime = NativeHostLifetime(context=case.state.context, dispatch_id="dispatch")  # pyrefly: ignore[read-only] - mutation witness
    released: list[str] = []
    case.host.bind_release(release=lambda: released.append("released"))
    with pytest.raises(ValueError):
        case.host.retire()
    assert released == []

    def run() -> None:
        case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    thread = Thread(target=run)
    case.host.start_worker(worker=thread)
    thread.join(1)
    case.host.request_close(reason="exhausted")
    assert case.lifetime.settle() == "settled"
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
    case.host.retire()
    assert released == ["released"]
    with pytest.raises(ValueError):
        case.host.retire()
    assert released == ["released"]


def test_foreign_boundary_owner_node_cannot_be_adopted_by_launch() -> None:
    case = LaunchCase()
    _, factory = make_native(decision=permit(), ownership=cast(Observations, case.host))
    foreign = bound_guard(factory)
    with pytest.raises(ValueError):
        case.host.bind_node_runtime(node=foreign)


@pytest.mark.parametrize("coordinator", [False, True])
def test_late_fence_acknowledgement_never_restores_control_acceptance(
    coordinator: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = LaunchCase()
    bind_generation(case, monkeypatch)
    node = case.own_node()
    entered, release = Event(), Event()
    case.ports.entered, case.ports.release = entered, release
    results = []

    def run() -> None:
        try:
            with case.host.node_scope(node=node, phase="run"):
                results.append(case.host.control_sink.record_control(record=record(case, node)))
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    thread = Thread(target=run)
    case.host.start_worker(worker=thread)
    try:
        assert entered.wait(1)
        if coordinator:
            assert case.lifetime.settle() == "unknown"
        else:
            sleep(0.08)
        assert thread.is_alive()
    finally:
        release.set()
        thread.join(2)
    assert len(results) == 1
    assert type(results[0]) is NativeControlRefused
    assert case.lifetime.unknown
    assert len(case.ports.fences) == 1
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")


@pytest.mark.parametrize("gate", ["before", "claim"])
def test_control_arms_before_stuck_admission_and_refuses_late_physical_entry(
    gate: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = LaunchCase(baseline=(0.05, 0.05, 0.05))
    bind_generation(case, monkeypatch)
    binding = case.prepared()
    node = case.own_node()
    rpc_entered, release_rpc, control_started = Event(), Event(), Event()
    outcomes: list[BaseException] = []
    physical: list[str] = []
    controls = []

    def blocked_rpc() -> None:
        rpc_entered.set()
        release_rpc.wait(2)

    if gate == "before":
        case.authorization.before_hook = blocked_rpc
    else:
        case.authorization.claim_hook = blocked_rpc

    def run() -> None:
        try:
            case.calls().call(
                ref=REF,
                intent=binding.intent,
                dispatch=lambda dispatch_permit: physical.append(dispatch_permit.operation_id),
            )
        except BaseException as exc:
            outcomes.append(exc)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    def control() -> None:
        with case.host.node_scope(node=node, phase="run"):
            value = record(case, node)
            control_started.set()
            controls.append(case.host.control_sink.record_control(record=value))

    thread = Thread(target=run)
    case.host.start_worker(worker=thread)
    control_thread = Thread(target=control)
    try:
        assert rpc_entered.wait(1)
        control_thread.start()
        assert control_started.wait(1)
        sleep(0.02)
        assert len(case.lifetime.control_records) == 1
        assert case.host.settlement_deadline is not None
        assert case.ports.fences == []
        assert case.lifetime.settle() == "unknown"
        assert thread.is_alive()
        assert control_thread.is_alive()
        assert physical == []
    finally:
        release_rpc.set()
        thread.join(2)
        if control_thread.ident is not None:
            control_thread.join(2)
    assert physical == []
    assert len(outcomes) == 1
    assert type(outcomes[0]) is NativePolicyStop
    assert case.authorization.outcomes == {0: ("unknown", None)}
    assert set(case.authorization.permits) == {0}
    assert case.authorization.claimed == {0}
    assert len(controls) == 1
    assert type(controls[0]) is NativeControlRefused
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")


def test_late_common_wait_and_completed_replay_reach_real_adapter_and_journal() -> None:
    waiting = LaunchCase()
    binding = waiting.prepared()
    node = waiting.own_node()
    waiting.ports.on_fence = lambda: waiting.authorization.decisions.__setitem__(
        0, ApprovalWait(pending_operation_id="pending")
    )
    with waiting.host.node_scope(node=node, phase="run"):
        assert type(waiting.host.control_sink.record_control(record=record(waiting, node))) is NativeControlAccepted
    for _ in range(2):
        with pytest.raises(NativeApprovalWait) as caught:
            waiting.calls().call(
                ref=REF, intent=binding.intent, dispatch=lambda _permit: pytest.fail("coalesced wait cannot dispatch")
            )
        assert caught.value.pending_operation_id == "pending"
    assert waiting.authorization.permits == {}
    assert waiting.authorization.claimed == set()
    assert waiting.cursor.snapshot().operation_keys == (binding.intent.key,)
    assert waiting.cursor.snapshot().result_refs == ()

    completed = LaunchCase()
    binding = completed.prepared()
    assert completed.calls().call(ref=REF, intent=binding.intent, dispatch=lambda _permit: "done") == "done"
    node = completed.own_node()
    with completed.host.node_scope(node=node, phase="run"):
        assert type(completed.host.control_sink.record_control(record=record(completed, node))) is NativeControlAccepted
    assert (
        completed.calls().call(
            ref=REF, intent=binding.intent, dispatch=lambda _permit: pytest.fail("completed replay cannot dispatch")
        )
        == "done"
    )
    assert completed.authorization.claimed == {0}


def test_result_storage_keeps_ticket_and_capacity_owned_after_callback_returns(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    bind_generation(case, monkeypatch)
    binding = case.prepared()
    storing, release = Event(), Event()
    results = []
    errors: list[BaseException] = []

    def store() -> None:
        storing.set()
        release.wait(2)

    case.state.store_hook = store

    def run() -> None:
        try:
            results.append(
                case.calls().call(ref=REF, intent=binding.intent, dispatch=lambda _permit: "closed callback")
            )
        except BaseException as exc:
            errors.append(exc)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    thread = Thread(target=run)
    case.host.start_worker(worker=thread)
    try:
        assert storing.wait(1)
        case.host.request_close(reason="cancel")
        assert case.lifetime.settle() == "unknown"
        with pytest.raises(ValueError):
            case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
    finally:
        release.set()
        thread.join(2)
    assert results == ["closed callback"]
    assert errors == []
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
    assert case.lifetime.unknown


def test_real_producer_registration_retains_exact_instance_without_fabricating_proposals() -> None:
    from services.dify_builder.native_testing.http_binding import NativeHttpBindingProducer
    from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation

    case = LaunchCase()
    node = case.own_node()
    # Structural registration only: these labeled unused loader/bridge/store
    # values never run resolution, SQL, preparation or proposal production.
    association = NativeNodePreparation(
        bridge=cast("NativeRuntimeBridge", object()),
        ref=REF,
        node_id=node.id,
        node_class=type(node),
        runtime_state=node.graph_runtime_state,
    )
    producer = NativeHttpBindingProducer(
        association=association,
        loader=cast("OwnedNativeTestLoader", object()),
        state_store=cast("NativeExecutionStateStore", case.state),
        journal=case.journal,
    )
    case.host.register_proposals(producer=producer)
    case.host.register_proposals(producer=producer)
    assert case.host.proposal_producers == (producer,)
    assert case.host.proposal_producers[0] is producer


def test_launch_retirement_releases_layer_and_real_control_traceback_payloads(monkeypatch: pytest.MonkeyPatch) -> None:
    import gc
    import weakref

    def completed():
        case = LaunchCase(baseline=(1, 1, 1))
        entry, factory = native_entry(case, monkeypatch)
        factory.effects.decision = ApprovalWait(pending_operation_id="pending")
        node = entry.graph_engine.graph.nodes["guard"]
        node.bind_execution_id("actual-control-gc")
        calls = case.calls()
        refs = [
            weakref.ref(value)
            for value in [
                case.state,
                case.state.context,
                case.journal,
                factory.runtime,
                node,
                entry,
                case.host.observation_layer(),
            ]
        ]

        def run() -> None:
            try:
                list(node.run())  # Real native boundary, sink and control traceback.
            finally:
                case.host.worker_finished(worker=current_thread(), exit_kind="returned")

        worker = Thread(target=run)
        case.host.start_worker(worker=worker)
        worker.join(1)
        assert not worker.is_alive()
        assert case.host.boundary_owner.status == "WAIT_RECORDED"
        assert case.lifetime.settle() == "settled"
        case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
        case.host.retire()
        case.registry.dispose()
        return case.host, calls, refs

    host, calls, refs = completed()
    gc.collect()
    assert all(value() is None for value in refs), "retired launch retains layer/runtime/control traceback payload"
    assert not host.boundary_owner.dispatch_admissible
    with pytest.raises(ValueError):
        host.observation_layer()
    with pytest.raises(ValueError):
        calls.call(ref=REF, intent=LaunchCase().prepared().intent, dispatch=lambda _permit: None)


def test_mandatory_stop_owner_and_exact_resolved_context_are_required() -> None:
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

    case = LaunchCase()

    def construct(*, context, stop_sealer):
        return NativeHostLaunch(
            context=context,
            stop_sealer=stop_sealer,
            dispatch_id="dispatch",
            lifetime=case.lifetime,
            journal=case.journal,
            checkpoints=NativeCheckpointBridge(state=case.state, lifecycle=NoCheckpointLifecycle()),
            fence_pending=case.ports.fence_pending,
            authorization=case.authorization,
            http_baseline=(1, 1, 1),
        )

    # Explicit invalid port, not a production fallback/default.
    with pytest.raises(ValueError, match="native_host_explicit_owners_required"):
        construct(context=case.state.context, stop_sealer=cast("DurableNativeStopSealer", None))
    with pytest.raises(ValueError, match="native_host_explicit_owners_required"):
        construct(context=case.state.context.model_copy(), stop_sealer=case.ports)


def test_first_engine_binding_rejects_foreign_filter_and_actual_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    from graphon.filters import ResponseStreamFilter
    from graphon.runtime import GraphRuntimeState, VariablePool

    case = LaunchCase()
    entry, factory = native_entry(case, monkeypatch, bind=False)
    own_filter = case.host.generation_bindings.response_filter
    with pytest.raises(ValueError, match="native_host_engine_identity_invalid"):
        case.host.bind_engine(
            entry=entry,
            runtime_state=factory.runtime,
            response_filter=ResponseStreamFilter(),
            commands=entry.command_channel,
        )
    foreign_runtime = GraphRuntimeState(variable_pool=VariablePool(), start_at=monotonic())
    with pytest.raises(ValueError, match="native_host_engine_identity_invalid"):
        case.host.bind_engine(
            entry=entry, runtime_state=foreign_runtime, response_filter=own_filter, commands=entry.command_channel
        )
    case.host.bind_engine(
        entry=entry, runtime_state=factory.runtime, response_filter=own_filter, commands=entry.command_channel
    )


def test_prepared_http_requires_finite_actual_tuple_and_rejects_same_operation_drift() -> None:
    from dataclasses import replace

    case = LaunchCase()
    binding = case.prepared(timeout=(1, 2, 3, 4))
    for timeout in [(1, 0, 1), (1, float("inf"), 1), (True, 1, 1)]:
        invalid = replace(binding, request=replace(binding.request, timeout=timeout))
        with pytest.raises(ValueError, match="native_host_http_timeout_unqualified"):
            case.host.register_http_request(ref=REF, binding=invalid)
    drift = replace(binding, request=replace(binding.request, timeout=(1, 2, 3)))
    with pytest.raises(ValueError, match="native_host_http_timeout_drift"):
        case.host.register_http_request(ref=REF, binding=drift)
    assert case.host.http_timeout_snapshots == ((1, 2, 3, 4),)
    unclassified = binding.intent.model_copy(update={"kind": "unclassified"})
    with pytest.raises(NativePolicyStop):
        case.calls().call(ref=REF, intent=unclassified, dispatch=lambda _permit: None)
    assert case.authorization.claimed == set()


def test_elapsed_ordinary_work_has_no_deadline_and_independent_work_keeps_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = LaunchCase(baseline=(0.02, 0.02, 0.02))
    bind_generation(case, monkeypatch)
    entered = Barrier(2)
    release, independent_release, independent_done = Event(), Event(), Event()

    def run() -> None:
        try:
            entered.wait(1)
            release.wait(2)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    def independent() -> None:
        independent_release.wait(2)
        independent_done.set()

    worker, ordinary = Thread(target=run), Thread(target=independent)
    ordinary.start()
    case.host.start_worker(worker=worker)
    try:
        entered.wait(1)
        sleep(0.08)  # Already exceeds B, but ordinary execution has no control timer.
        assert case.host.settlement_deadline is None
        assert not case.lifetime.unknown
        before = monotonic()
        case.host.request_close(reason="consumer_closed")
        deadline = case.host.settlement_deadline
        assert deadline is not None
        assert deadline >= before + 0.06
        independent_release.set()
        assert independent_done.wait(1)
    finally:
        release.set()
        independent_release.set()
        worker.join(2)
        ordinary.join(2)
    assert not worker.is_alive()
    assert not ordinary.is_alive()


def test_prestart_launch_releases_actual_bound_resource_once_only_after_exact_cleanup() -> None:
    case = LaunchCase()
    released: list[str] = []
    case.host.bind_release(release=lambda: released.append("actual rate resource"))
    case.host.request_close(reason="failed")
    with pytest.raises(ValueError, match="native_host_cleanup_incomplete"):
        case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
    with pytest.raises(ValueError, match="native_host_cleanup_unconsumed"):
        case.host.retire()
    assert released == []
    assert case.host.confirm_never_started() is None
    assert case.lifetime.settle() == "settled"
    assert released == []  # Proof and physical settle grant no early release.
    with pytest.raises(ValueError):
        case.lifetime.consume_cleanup(ref=REF, generation=99, dispatch_id="dispatch")
    with pytest.raises(ValueError):
        case.host.retire()
    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
    # Actual C03 record is outside this no-SQL witness; the real caller must
    # record cleanup before retiring. This asserts only this host's ordering.
    assert released == []
    case.host.retire()
    assert released == ["actual rate resource"]
    with pytest.raises(ValueError):
        case.host.retire()
    with pytest.raises(ValueError):
        case.host.confirm_never_started()
    assert released == ["actual rate resource"]
    case.registry.dispose()


def test_prestart_launch_delegate_cannot_certify_bound_actual_native_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    native_entry(case, monkeypatch)
    case.host.request_close(reason="failed")
    with pytest.raises(ValueError):
        case.host.confirm_never_started()
    with pytest.raises(ValueError, match="native_host_cleanup_incomplete"):
        case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id="dispatch")
