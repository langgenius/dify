"""Initial trusted guard and native thread context wiring; no SQL/provider proof.

Actual profile/loader/store methods use the existing labeled SQL/object boundary
fixture. Graphon, Flask, context managers, logging filters and Threads are real.
"""

from __future__ import annotations

import importlib
import importlib.util
import io
import json
import logging
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from threading import current_thread
from time import monotonic
from typing import TypedDict, cast

import pytest
from flask import Flask, current_app, has_app_context
from sqlalchemy.orm import Session

from context.flask_app_context import capture_flask_context
from graphon.runtime import VariablePool
from libs import sensitive_http_telemetry as telemetry
from models.workflow import Workflow
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.host_execution import NativeHostLaunch
from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime, NativeHostLifetimeRegistry
from services.dify_builder.native_testing.http_binding import build_native_http_profile
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.workflow_run_agg import WorkflowRunAgg
from tests.unit_tests.services.dify_builder.native_testing.test_observation_owner import case as case  # noqa: PLC0414 - shared pytest fixture
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import SENTINEL
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import context as sample_context


def _refuse_protected_input(**_kwargs):
    raise AssertionError("protected input effect must not begin")


def contexts():
    name = "services.dify_builder.native_testing.context_runtime"
    assert importlib.util.find_spec(name) is not None, "bounded native execution context is missing"
    return importlib.import_module(name)


def protect_logs(monkeypatch):
    """Test-only application sink setup; production never installs/toggles filters."""
    from services.dify_builder.native_testing.context_runtime import NATIVE_LOG_EMITTERS
    from services.dify_builder.native_testing.observation_repository import _EMITTERS
    from tests.unit_tests.logging_helpers import protect_existing_log_routes

    protect_existing_log_routes(monkeypatch, emitters=telemetry._HTTP_LOGGERS + NATIVE_LOG_EMITTERS + _EMITTERS)
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.addFilter(telemetry.SensitiveHttpLogFilter())
    monkeypatch.setattr(logging.getLogger(), "handlers", [handler])
    monkeypatch.setattr(logging.getLogger(), "level", logging.DEBUG)
    return output


def component_guard(*, on_failure=lambda: None):
    """Actual structural policy/guard fixture, not persisted-profile attestation."""
    policy = NativeHttpObservationPolicy.qualify(context=sample_context(), profile=build_native_http_profile())
    return NativeObservationGuard(policy=policy, on_failure=on_failure)


def qualified_host(case):
    authorization = EffectAuthorizationService(case.store.loader)
    journal = NodeOperationJournal(state=case.store, authorization=authorization)
    life = NativeHostLifetime(context=case.context, dispatch_id="initial-observation")
    registry = NativeHostLifetimeRegistry()
    registry.activate(lifetime=life)  # Fixture handoff, no durable claim proof.
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
        DurablePorts,
        NoCheckpointLifecycle,
    )

    durable = DurablePorts()
    host = NativeHostLaunch(
        context=case.context,
        dispatch_id=life.dispatch_id,
        lifetime=life,
        journal=journal,
        checkpoints=NativeCheckpointBridge(state=case.store, lifecycle=NoCheckpointLifecycle()),
        fence_pending=durable.fence_pending,
        stop_sealer=durable,
        authorization=authorization,
        http_baseline=(1, 1, 1),
    )
    return host


def test_host_creates_one_actual_persisted_profile_guard_and_rechecks_current_owner(case, monkeypatch):
    protect_logs(monkeypatch)
    host = qualified_host(case)
    guard = host.bind_observation()
    assert type(guard) is NativeObservationGuard
    assert host.native_observation is guard
    assert case.reads >= 2
    case.local.generation += 1
    with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        _ = host.native_observation
    assert host.lifetime.unknown


def test_untrusted_profile_refuses_guard_and_marks_actual_host_unknown(case, monkeypatch):
    protect_logs(monkeypatch)
    host = qualified_host(case)
    case.request.context["profile"]["implementation_revision"] = "unqualified"
    with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        host.bind_observation()
    assert host.lifetime.unknown


def test_native_execution_context_restores_nested_reused_thread_context_and_flask(monkeypatch):
    output = protect_logs(monkeypatch)
    module = contexts()
    marker = ContextVar("native-observation-test-marker", default="ordinary-default")
    app = Flask("native-context-capture")
    guard = component_guard()
    monkeypatch.setattr(module, "capture_current_context", capture_flask_context)
    with app.app_context():
        marker.set("captured-native")
        with module.native_observation_scope(guard=guard):
            module.NativeGraphRuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=monotonic())
            execution_context = module.NativeExecutionContext(guard=guard)
    seen = []

    def reused():
        marker.set("ordinary-before")
        assert not has_app_context()
        with execution_context:
            assert current_app.name == app.name
            assert module.current_native_observation() is guard
            assert marker.get() == "captured-native"
            logging.getLogger("graphon.nodes.http_request.node").error(SENTINEL)
            with execution_context:
                assert telemetry._sensitive_http.get()
            assert telemetry._sensitive_http.get()
        assert not telemetry._sensitive_http.get()
        assert module.current_native_observation() is None
        assert marker.get() == "ordinary-before"
        assert not has_app_context()
        logging.getLogger("graphon.nodes.http_request.node").warning("ordinary-after-native")
        seen.append(current_thread())

    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(reused).result(2)
        pool.submit(reused).result(2)
    assert seen[0] is seen[1]
    assert SENTINEL not in output.getvalue()
    assert output.getvalue().count("ordinary-after-native") == 2


def test_public_subclass_snapshot_restore_uses_native_context_without_enabling_resume(monkeypatch):
    protect_logs(monkeypatch)
    module = contexts()
    guard = component_guard()
    with module.native_observation_scope(guard=guard):
        actual = module.NativeGraphRuntimeState(
            workflow_id="workflow", variable_pool=VariablePool(), start_at=monotonic()
        )
        restored = module.NativeGraphRuntimeState.from_snapshot(actual.dumps())
    assert type(restored) is module.NativeGraphRuntimeState
    with module.NativeExecutionContext(guard=guard):
        assert module.current_native_observation() is guard
    assert module.current_native_observation() is None


def test_native_exception_exit_restores_ordinary_thread_even_when_guard_fails(monkeypatch):
    protect_logs(monkeypatch)
    module = contexts()
    marker = ContextVar("native-exception-marker", default="ordinary")
    marker.set("captured")
    guard = component_guard()
    wrapped = module.NativeExecutionContext(guard=guard)

    def reused():
        marker.set("ordinary")

        def fail_wrapped():
            with wrapped:
                assert marker.get() == "captured"
                raise RuntimeError(SENTINEL)

        with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
            fail_wrapped()
        assert marker.get() == "ordinary"
        assert not telemetry._sensitive_http.get()
        assert module.current_native_observation() is None

    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(reused).result(2)


def bind_component_observation(case, monkeypatch):
    """Exact component guard with a labeled factory boundary; no profile proof."""
    from services.dify_builder.native_testing import observation_owner

    protect_logs(monkeypatch)
    monkeypatch.setattr(
        observation_owner,
        "create_http_observation_guard",
        lambda **kwargs: component_guard(on_failure=kwargs["on_failure"]),
    )
    return case.host.bind_observation()


@pytest.mark.parametrize("feature", ["tts", "files", "trace", "hitl"])
def test_initial_preflight_refuses_unqualified_routes_before_worker(monkeypatch, feature):

    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase
    from tests.unit_tests.services.dify_builder.native_testing.test_host_generation_wiring import generate_fixture

    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    bind_component_observation(case, monkeypatch)
    entity = arguments["application_generate_entity"]
    arguments["workflow"] = Workflow(features="{}")
    if feature == "tts":
        arguments["workflow"].features = json.dumps({"text_to_speech": {"enabled": True}})
    elif feature == "files":
        entity.files = [object()]
    elif feature == "trace":
        entity.extras["external_trace_id"] = SENTINEL
    else:
        entity.single_iteration_run = {"node_id": SENTINEL, "inputs": {}}
    monkeypatch.setattr(
        generator, "_generate_worker", lambda **_kwargs: pytest.fail("worker launched before preflight")
    )
    with Flask(__name__).app_context(), pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        generator._generate(**arguments, native_host=case.host)
    assert case.lifetime.unknown


def test_actual_generate_passes_same_guard_to_queue_and_pipeline_before_worker(monkeypatch):
    from threading import Event

    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase
    from tests.unit_tests.services.dify_builder.native_testing.test_host_generation_wiring import generate_fixture

    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    guard = bind_component_observation(case, monkeypatch)
    arguments["workflow"] = Workflow(features="{}")
    seen = []
    done = Event()

    def worker(**kwargs):
        try:
            assert kwargs["queue_manager"].native_observation is guard
            seen.append("worker")
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")
            done.set()

    def response(**kwargs):
        assert kwargs["native_observation"] is guard
        assert kwargs["queue_manager"].native_observation is guard
        seen.append("pipeline")
        yield {"fixture": "response"}

    monkeypatch.setattr(generator, "_generate_worker", worker)
    monkeypatch.setattr(generator, "_handle_response", response)
    with Flask(__name__).app_context():
        source = generator._generate(**arguments, native_host=case.host)
        assert list(source) == [{"fixture": "response"}]
    assert done.wait(2)
    assert set(seen) == {"worker", "pipeline"}


class _SupportedNode(TypedDict):
    id: str
    data: dict[str, object]


class _SupportedGraph(TypedDict):
    nodes: list[_SupportedNode]
    edges: list[dict[str, str]]


def supported_graph(kind):
    """Only the profile's actual Start/HTTP/End and Loop/Iteration classes."""
    from copy import deepcopy

    graph = cast(_SupportedGraph, deepcopy(sample_context().graph))
    if kind == "root":
        return graph
    http = next(n for n in graph["nodes"] if n["id"] == "http")
    http["data"][kind + "_id"] = "container"
    graph["nodes"] = [
        graph["nodes"][0],
        {
            "id": "container",
            "data": {
                "type": kind,
                "start_node_id": "body-start",
                **(
                    {
                        "iterator_selector": ["start", "items"],
                        "output_selector": ["http", "body"],
                        "is_parallel": True,
                        "parallel_nums": 2,
                        "flatten_output": True,
                    }
                    if kind == "iteration"
                    else {"loop_count": 1, "break_conditions": [], "logical_operator": "and"}
                ),
            },
        },
        {"id": "body-start", "data": {"type": kind + "-start", kind + "_id": "container"}},
        http,
        {"id": "end", "data": {"type": "end", "outputs": []}},
    ]
    graph["edges"] = [
        {"source": "start", "target": "container"},
        {"source": "body-start", "target": "http"},
        {"source": "container", "target": "end"},
    ]
    return graph


def supported_engine(*, kind, mode, monkeypatch, commands=None, graph=None):
    from dataclasses import dataclass

    import httpx

    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.workflow.node_runtime import DifyFileReferenceFactory
    from graphon.engine import Engine
    from graphon.engine.command import InMemoryChannel
    from graphon.entities.base_node_data import BaseNodeData
    from graphon.graph import Graph
    from graphon.nodes.base.node import Node
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.http_request.node import HttpRequestNode
    from graphon.nodes.iteration.iteration_node import IterationNode
    from graphon.nodes.iteration.iteration_start_node import IterationStartNode
    from graphon.nodes.loop.loop_node import LoopNode
    from graphon.nodes.loop.loop_start_node import LoopStartNode
    from graphon.nodes.start.start_node import StartNode
    from graphon.runtime import InitParams, RuntimeState
    from runtime_contracts.builder.native.contracts import ApprovalWait
    from services.dify_builder.native_testing.control import (
        BoundaryOwnerState,
        NativeControlBridge,
        marked_native_node_class,
    )
    from services.dify_builder.native_testing.http_binding import (
        RefusingNativeHttpFiles,
        describe_http_resource,
        native_http_config,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_control import Sink

    graph = graph or supported_graph(kind)
    context = sample_context()
    manifest = tuple(
        describe_http_resource(
            node_id=n["id"],
            raw=n["data"],
            workflow_revision=context.graph_revision,
            app_id=context.app_id,
            workflow_id=context.workflow_id,
        )
        for n in graph["nodes"]
        if n["data"]["type"] == "http-request"
    )
    context = context.model_copy(update={"graph": graph, "resource_manifest": manifest})
    from services.dify_builder.native_testing import observation_owner
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase

    host = LaunchCase().host
    guard = NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(context=context, profile=build_native_http_profile()),
        on_failure=host.mark_unknown,
    )
    # Only the trusted factory's SQL/profile boundary is doubled in this native
    # dispatcher witness. The dedicated case tests run the real owner.
    monkeypatch.setattr(observation_owner, "create_http_observation_guard", lambda **_kwargs: guard)
    assert host.bind_observation() is guard
    module = contexts()
    with module.native_observation_scope(guard=guard):
        runtime = module.NativeGraphRuntimeState(
            workflow_id="supported-native", variable_pool=VariablePool(), start_at=monotonic()
        )
    runtime.variable_pool.add(("start", "items"), [SENTINEL, SENTINEL])
    owner = BoundaryOwnerState(ref=context.ref)
    sink = Sink(owner)
    entered = []

    class Client:
        max_retries_exceeded_error = TimeoutError
        request_error = httpx.RequestError

        def request(self, *args, **kwargs):
            del args, kwargs
            assert module.current_native_observation() is guard
            assert telemetry._sensitive_http.get()
            entered.append(current_thread())
            logging.getLogger("graphon.nodes.http_request.node").warning(SENTINEL)
            if mode == "pause":
                NativeControlBridge.resolve(ref=context.ref, decision=ApprovalWait(pending_operation_id=SENTINEL))
            if mode == "failed":
                raise httpx.RequestError(SENTINEL)
            return httpx.Response(200, content=b"ok", request=httpx.Request("POST", "https://example.com"))

        get = head = post = put = delete = patch = request

    file_references = DifyFileReferenceFactory(
        DifyRunContext(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            user_id=context.actor_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        )
    )
    originals = (StartNode, EndNode, HttpRequestNode, IterationNode, IterationStartNode, LoopNode, LoopStartNode)

    @dataclass
    class Factory:
        runtime: RuntimeState

        def with_runtime_state(self, graph_runtime_state):
            return Factory(graph_runtime_state)

        def with_graph_config(self, graph_config):
            del graph_config
            return self

        def validate_node(self, node_config):
            raw = node_config["data"].model_dump(mode="python", exclude_unset=True)
            original = next(cls for cls in originals if cls.node_type == raw["type"])
            original.validate_node_data(raw)
            return original.execution_type

        def create_node(self, node_config):
            node_config = {**node_config, "data": node_config["data"].model_dump(mode="python", exclude_unset=True)}
            original = next(cls for cls in originals if cls.node_type == node_config["data"]["type"])
            cls = marked_native_node_class(original, marked=True)
            kwargs = {}
            if original is HttpRequestNode:
                kwargs = {
                    "http_request_config": native_http_config(),
                    "http_client": Client(),
                    "file_manager": RefusingNativeHttpFiles(),
                    "tool_file_manager_factory": lambda: None,
                    "file_reference_factory": file_references,
                }
            return cast(Callable[..., Node[BaseNodeData]], cls)(
                node_id=node_config["id"],
                data=cls.validate_node_data(node_config["data"]),
                init_params=InitParams(
                    workflow_id="supported-native", graph_config=graph, run_context={}, call_depth=0
                ),
                runtime_state=self.runtime,
                native_control_owner=owner,
                native_control_sink=sink,
                **kwargs,
            )

    actual = Graph.init(graph_config=graph, node_factory=Factory(runtime), root_node_id="start")
    engine = Engine(
        graph=actual,
        runtime_state=runtime,
        command_channel=host.wrap_commands(channel=commands or InMemoryChannel()),
    )
    from graphon.engine.layer import Layer

    captured_context = module.NativeExecutionContext(guard=guard)

    class NativeContextLayer(Layer):
        def node_run_context(self, node, *, parent_execution_id=None):
            del node, parent_execution_id
            return captured_context.enter()

    engine.add_layer(NativeContextLayer())
    return module, guard, engine, runtime, entered, host


@pytest.mark.parametrize("kind", ["root", "loop", "iteration"])
@pytest.mark.parametrize("mode", ["failed", "pause"])
def test_actual_supported_root_loop_parallel_iteration_context_and_dispatcher_canaries(monkeypatch, kind, mode):
    from graphon.engine_events.graph import GraphRunFailedEvent, GraphRunPausedEvent

    output = protect_logs(monkeypatch)
    module, guard, engine, runtime, entered, host = supported_engine(kind=kind, mode=mode, monkeypatch=monkeypatch)
    events = []
    with module.native_observation_scope(guard=guard):
        if mode == "failed":
            with pytest.raises(RuntimeError) as caught:
                events.extend(engine.run())
            assert caught.value is runtime.graph_execution.error
        else:
            events.extend(engine.run())
    assert entered
    assert all(thread is not current_thread() for thread in entered)
    assert isinstance(events[-1], GraphRunPausedEvent if mode == "pause" else GraphRunFailedEvent)
    assert runtime.graph_execution.paused == (mode == "pause")
    assert SENTINEL not in output.getvalue()
    assert len(host._dispatcher_log_leases) == 1  # Repeated polls retain one lease.
    for lease in host._dispatcher_log_leases:
        assert not lease.thread.is_alive()
        lease.release_after_exit()  # This component fixture has no capacity ACK.
    assert not telemetry._sensitive_http.get()
    logging.getLogger("graphon.graph_engine.orchestration.dispatcher").warning("ordinary-after-dispatch")
    assert "ordinary-after-dispatch" in output.getvalue()


def test_actual_supported_loop_dispatcher_condition_error_is_protected(monkeypatch):
    """Actual missing-selector failure logged on the separate dispatcher."""
    output = protect_logs(monkeypatch)
    graph = supported_graph("loop")
    graph["nodes"][1]["data"]["break_conditions"] = [
        {
            "id": "condition",
            "variable_selector": ["start", SENTINEL],
            "varType": "string",
            "comparison_operator": "is",
            "value": SENTINEL,
        }
    ]
    module, guard, engine, runtime, entered, host = supported_engine(
        kind="loop", mode="success", monkeypatch=monkeypatch, graph=graph
    )

    with module.native_observation_scope(guard=guard):
        with pytest.raises(RuntimeError) as caught:
            list(engine.run())
        assert caught.value is runtime.graph_execution.error
    assert entered
    assert runtime.graph_execution.error is not None
    assert SENTINEL in str(runtime.graph_execution.error)
    assert SENTINEL not in output.getvalue()
    for lease in host._dispatcher_log_leases:
        assert not lease.thread.is_alive()
        lease.release_after_exit()


def test_actual_initial_entry_rejects_persisted_profile_before_input_effect(case, monkeypatch, mocker):

    from core.app.entities.app_invoke_entities import InvokeFrom
    from models.account import Account
    from models.model import App
    from models.workflow import Workflow
    from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge
    from services.workflow_runtime.workflow_generator import WorkflowAppGenerator

    protect_logs(monkeypatch)
    host = qualified_host(case)
    prepare = mocker.spy(sys.modules[__name__], "_refuse_protected_input")
    bridge = NativeRuntimeBridge(
        state=case.store,
        collaborators=_refuse_protected_input,
        boundary_owner=host.boundary_owner,
        control_sink=host.control_sink,
        node_arguments=_refuse_protected_input,
        prepare_inputs=prepare,
    )
    context = case.context
    from services.dify_builder.native_testing import observation_owner

    actual_factory = observation_owner.create_http_observation_guard

    def changed_profile(**kwargs):
        case.request.context["profile"]["implementation_revision"] = "unqualified"
        return actual_factory(**kwargs)

    monkeypatch.setattr(observation_owner, "create_http_observation_guard", changed_profile)
    account = Account(name="Native actor", email="native@example.test")
    account.id = context.actor_id
    with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run).generate(
            app_model=App(id=context.app_id, tenant_id=context.tenant_id),
            workflow=Workflow(id=context.workflow_id, graph=json.dumps(context.graph), features="{}"),
            user=account,
            args={"inputs": context.inputs},
            streaming=True,
            call_depth=0,
            workflow_run_id=context.native_run_id,
            invoke_from=InvokeFrom.DEBUGGER,
            native_test_required=True,
            native_test_ref=context.ref,
            native_runtime=bridge,
            native_host=host,
        )
    prepare.assert_not_called()
    assert host.lifetime.unknown


def test_actual_handle_response_builds_same_guard_pipeline_and_converter(monkeypatch):
    from services.workflow_runtime.workflow_generator import WorkflowAppGenerator
    from services.workflow_runtime.workflow_pipeline import WorkflowAppGenerateTaskPipeline
    from tests.unit_tests.services.dify_builder.native_testing.test_observation_stream import account, make_pipeline

    guard = component_guard()
    fixture, queue, saver = make_pipeline(guard, monkeypatch)
    seen = []

    def process(actual):
        assert actual._native_observation is guard
        assert actual._workflow_response_converter._native_observation is guard
        assert actual._base_task_pipeline.queue_manager.native_observation is guard
        seen.append(actual)
        return iter(())

    monkeypatch.setattr(WorkflowAppGenerateTaskPipeline, "process", process)
    WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)._handle_response(
        application_generate_entity=fixture._application_generate_entity,
        workflow=fixture._workflow,
        queue_manager=queue,
        user=account(),
        stream=True,
        draft_var_saver_factory=saver,
        native_observation=guard,
    )
    assert len(seen) == 1
    assert saver.calls == []


def test_same_guard_rechecks_exact_state_without_holding_host_lock(case, monkeypatch):
    from threading import Thread

    protect_logs(monkeypatch)
    host = qualified_host(case)
    original = case.store.load_context
    locks = []

    def load(*, ref):
        acquired = []

        def inspect():
            with host._registration:
                acquired.append(True)

        thread = Thread(target=inspect)
        thread.start()
        thread.join(1)
        assert acquired == [True]
        locks.append(True)
        return original(ref=ref)

    monkeypatch.setattr(case.store, "load_context", load)
    guard = host.bind_observation()
    assert host.native_observation is guard
    assert locks
    assert host._journal is not None
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    other_state = NativeExecutionStateStore(case.store.loader)
    monkeypatch.setattr(other_state, "load_context", lambda **_kwargs: case.context)
    host._journal._state = other_state
    with pytest.raises(NativeObservationError):
        _ = host.native_observation
    assert host.lifetime.unknown


def test_actual_dispatcher_command_reason_and_fetch_exception_protected_before_delegation(monkeypatch):
    from graphon.engine.command import InMemoryChannel, PauseCommand
    from graphon.engine_events.graph import GraphRunPausedEvent

    output = protect_logs(monkeypatch)
    channel = InMemoryChannel()
    channel.send_command(PauseCommand(reason=SENTINEL))
    module, guard, engine, runtime, entered, host = supported_engine(
        kind="root", mode="success", monkeypatch=monkeypatch, commands=channel
    )
    with module.native_observation_scope(guard=guard):
        events = list(engine.run())
    assert isinstance(events[-1], GraphRunPausedEvent)
    assert SENTINEL not in output.getvalue()
    assert len(host._dispatcher_log_leases) == 1
    lease = host._dispatcher_log_leases[0]
    assert not lease.thread.is_alive()
    lease.release_after_exit()


def test_actual_native_worker_adapter_restores_reused_thread_after_exception(monkeypatch):
    import contextvars

    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase

    case = LaunchCase()
    guard = bind_component_observation(case, monkeypatch)
    module = contexts()
    app = Flask("actual-native-worker-scope")
    marker = ContextVar("actual-worker-marker", default="ordinary")
    with app.app_context():
        marker.set("captured-worker")
        captured = contextvars.copy_context()

    def reused(fail):
        marker.set("ordinary")

        def work():
            with module.native_flask_worker_scope(host=case.host, flask_app=app, context_vars=captured):
                assert current_app.name == app.name
                assert marker.get() == "captured-worker"
                assert module.current_native_observation() is guard
                if fail:
                    raise RuntimeError(SENTINEL)

        if fail:
            with pytest.raises(NativeObservationError):
                work()
        else:
            work()
        assert marker.get() == "ordinary"
        assert not has_app_context()
        assert not telemetry._sensitive_http.get()
        assert module.current_native_observation() is None

    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(reused, False).result(2)
        pool.submit(reused, True).result(2)


def test_host_retains_unknown_live_dispatcher_logging_lease_until_actual_exit(monkeypatch):
    from threading import Event, Thread

    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase

    case = LaunchCase(baseline=(0.02, 0.02, 0.02))
    bind_component_observation(case, monkeypatch)
    output = protect_logs(monkeypatch)
    entered, finish = Event(), Event()

    class Channel:
        def fetch_commands(self):
            entered.set()
            assert finish.wait(3)
            logging.getLogger("graphon.graph_engine.error_handler").error(SENTINEL)
            return []

        def send_command(self, command):
            pass  # Labeled command-only fixture; no native graph/effect runs here.

    channel = case.host.wrap_commands(channel=Channel())
    dispatcher = Thread(target=channel.fetch_commands)
    dispatcher.start()
    try:
        assert entered.wait(2)
        assert len(case.host._dispatcher_log_leases) == 1
        assert case.host._dispatcher_log_leases[0].thread is dispatcher
        case.host.request_close(reason="failed")
        assert case.lifetime.settle() == "unknown"
        with pytest.raises(NativeObservationError):
            case.host.release_dispatcher_logs()
        assert dispatcher.is_alive()
        assert len(case.host._dispatcher_log_leases) == 1
        logging.getLogger("graphon").warning("ordinary-while-unknown")
    finally:
        finish.set()
        dispatcher.join(2)
    assert not dispatcher.is_alive()
    assert SENTINEL not in output.getvalue()
    assert "ordinary-while-unknown" in output.getvalue()
    case.host._dispatcher_log_leases[0].release_after_exit()  # Teardown only; no capacity ACK.


@pytest.mark.parametrize("kind", ["validation", "value", "unexpected"])
def test_actual_worker_replaces_raw_error_before_queue_error_model_and_logging(monkeypatch, kind):
    import contextvars
    from contextlib import nullcontext
    from threading import Thread

    from pydantic import BaseModel, ValidationError

    from graphon.variable_loader import DUMMY_VARIABLE_LOADER
    from services.workflow_runtime import workflow_generator as module
    from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase, generation_objects
    from tests.unit_tests.services.dify_builder.native_testing.test_host_generation_wiring import runtime_for

    case = LaunchCase()
    guard = bind_component_observation(case, monkeypatch)
    output = protect_logs(monkeypatch)
    entity, _, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    queue = WorkflowAppQueueManager(
        task_id=entity.task_id,
        user_id=entity.user_id,
        invoke_from=entity.invoke_from,
        app_mode="workflow",
        native_observation=guard,
    )
    case.host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    workflow = Workflow(graph=json.dumps(case.state.context.graph))
    session = Session()
    monkeypatch.setattr(session, "scalar", lambda _query: workflow)
    monkeypatch.setattr(module.session_factory, "create_session", lambda: session)
    published = []
    actual_publish = queue.publish_error

    def publish(error, pub_from):
        assert type(error) is NativeObservationError
        published.append(error)
        return actual_publish(error, pub_from)

    class InvalidInput(BaseModel):
        value: int

    errors: list[Exception] = []
    if kind == "validation":
        try:
            InvalidInput.model_validate({"value": SENTINEL})
        except ValidationError as error:
            errors.append(error)
    else:
        errors.append(ValueError(SENTINEL) if kind == "value" else RuntimeError(SENTINEL))

    class RunnerPort:
        def __init__(self, **kwargs):
            pass

        def run(self):
            raise errors[0]

    monkeypatch.setattr(module, "WorkflowAppRunner", RunnerPort)
    monkeypatch.setattr(module, "active_workflow_task", lambda _task: nullcontext())
    monkeypatch.setattr(queue, "publish_error", publish)
    app = Flask(__name__)
    with app.app_context():
        worker = Thread(
            target=module.WorkflowAppGenerator(execution_driver=lambda runner, *_args: runner.run())._generate_worker,
            kwargs={
                "flask_app": app,
                "application_generate_entity": entity,
                "queue_manager": queue,
                "context": contextvars.copy_context(),
                "variable_loader": DUMMY_VARIABLE_LOADER,
                "workflow_execution_repository": workflow_repo,
                "workflow_node_execution_repository": node_repo,
                "response_stream_filter": response_filter,
                "native_runtime": runtime_for(case),
                "native_host": case.host,
            },
        )
        case.host.start_worker(worker=worker)
    worker.join(2)
    assert not worker.is_alive()
    assert len(published) == 1
    assert SENTINEL not in str(queue._q.get_nowait())
    assert SENTINEL not in output.getvalue()
    assert case.lifetime.unknown


@pytest.mark.parametrize("case", ["start_end", "literal_http"], indirect=True)
def test_initial_host_binds_current_profile_without_native_activity(case, monkeypatch):
    """Actual pre-claim observation composition, labeled owner/object doubles."""
    protect_logs(monkeypatch)
    authorization = EffectAuthorizationService(case.store.loader)
    lifetime = NativeHostLifetime(context=case.context, dispatch_id="initial-observation")
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
        DurablePorts,
        NoCheckpointLifecycle,
    )

    durable = DurablePorts()

    host = NativeHostLaunch(
        context=case.context,
        dispatch_id=lifetime.dispatch_id,
        lifetime=lifetime,
        journal=NodeOperationJournal(state=case.store, authorization=authorization),
        checkpoints=NativeCheckpointBridge(state=case.store, lifecycle=NoCheckpointLifecycle()),
        fence_pending=durable.fence_pending,
        stop_sealer=DurablePorts(),
        authorization=authorization,
        http_baseline=(1, 1, 1),
    )
    assert lifetime._registry is None
    guard = host.bind_observation()
    assert host.bind_observation() is guard
    assert host.native_observation is guard
    assert not host.lifetime.unknown
    assert not host.lifetime._threads
    assert not host.lifetime._node_scopes
    from models.dify_builder_native_tests import NativeTestScope

    case.rows[NativeTestScope][0].cancelled = True
    with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        _ = host.native_observation
    assert host.boundary_owner.status == "UNKNOWN_NONRESUMABLE"
    assert lifetime._registry is None  # Failed observation grants no acquisition.
