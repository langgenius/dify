"""Release migration behavior: real frame tasks and pure scoped factory validation."""

from copy import deepcopy
from unittest.mock import Mock

import pytest

from graphon.enums import NodeExecutionType
from graphon.nodes.container_effects import ContainerExecutionResult, ContainerNodeRunResult
from graphon.runtime import InitParams, RuntimeState, VariablePool
from graphon.runtime.execution import GraphExecution
from graphon.runtime.ready_queue import InMemoryReadyQueue, ResumeTask, StartTask


@pytest.fixture(autouse=True)
def no_network_io(monkeypatch):
    import socket

    connect = Mock(side_effect=AssertionError("network I/O is forbidden in migration contracts"))
    monkeypatch.setattr(socket.socket, "connect", connect)
    yield
    connect.assert_not_called()


def test_stop_queue_preserves_frame_and_invocation_tasks(monkeypatch):
    from core.app.apps.workflow.stop_aware_ready_queue import StopAwareReadyQueue

    monkeypatch.setattr("core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set", lambda _: False)
    queue = StopAwareReadyQueue(InMemoryReadyQueue(), task_id="task", graph_execution=GraphExecution(workflow_id="wf"))
    tasks = [
        StartTask(node_id="child", frame_id="frame"),
        ResumeTask(
            invocation_id="invocation",
            result=ContainerExecutionResult(metadata={}, steps=1, node_run_result=ContainerNodeRunResult()),
        ),
    ]
    for task in tasks:
        queue.put(task)
    assert queue.take_all() == tasks


def test_scoped_factory_validation_never_initializes_collaborators(monkeypatch):
    from core.workflow.node_factory import DifyNodeFactory

    # Construct the owner once, then prohibit all constructor re-entry during scoping.
    factory = object.__new__(DifyNodeFactory)
    factory.init_params = InitParams(
        workflow_id="wf", graph_config={"nodes": [], "edges": []}, run_context={}, call_depth=0
    )
    factory.runtime_state = RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="wf")
    factory._dify_context = Mock(builder_execution=None)
    factory._native_runtime = None
    factory.execution_recorder = object()
    factory._request_hmac_key = b"host-owned-secret"
    monkeypatch.setattr(DifyNodeFactory, "__init__", Mock(side_effect=AssertionError("runtime initialized")))
    original = deepcopy(factory.init_params.graph_config)
    config = {"nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}], "edges": []}
    scoped = factory.with_graph_config(config)
    assert scoped is not factory
    assert scoped.init_params is not factory.init_params
    assert factory.init_params.graph_config == original
    assert scoped.init_params.graph_config == config
    assert scoped.execution_recorder is factory.execution_recorder
    assert scoped._request_hmac_key is factory._request_hmac_key
    assert scoped.validate_node(config["nodes"][0]) == NodeExecutionType.ROOT
    with pytest.raises(ValueError):
        scoped.validate_node({"id": "bad", "data": {"type": "unknown-node", "title": "Bad"}})


def test_pause_event_defers_snapshot_until_outer_filter_flush():
    from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
    from core.app.layers.pause_state_persist_layer import PauseStatePersistenceLayer
    from graphon.engine.command import InMemoryChannel
    from graphon.engine.filter import ResponseStreamFilter
    from graphon.engine_events import GraphRunPausedEvent

    state = Mock()
    state.dumps.side_effect = AssertionError("snapshot while engine is active")
    layer = PauseStatePersistenceLayer(
        session_factory=Mock(),
        generate_entity=WorkflowAppGenerateEntity.model_construct(),
        state_owner_user_id="user",
        response_stream_filter=ResponseStreamFilter(),
    )
    layer.initialize(state, InMemoryChannel())
    layer.on_event(GraphRunPausedEvent())
    layer.on_graph_end(None)
    state.dumps.assert_not_called()


def test_ordinary_workflow_uses_official_engine_without_external_io():
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.workflow_entry import WorkflowEntry
    from graphon.engine_events import GraphRunSucceededEvent
    from graphon.graph import Graph
    from tests.workflow_test_utils import build_test_graph_init_params

    config = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [
            {"id": "start-end", "source": "start", "target": "end", "sourceHandle": "source", "targetHandle": "target"}
        ],
    }
    state = RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="wf")
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="wf", graph_config=config), runtime_state=state
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    assert graph is not None
    entry = WorkflowEntry(
        tenant_id="tenant",
        app_id="app",
        workflow_id="wf",
        graph_config=config,
        graph=graph,
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        variable_pool=state.variable_pool,
        runtime_state=state,
    )
    assert any(isinstance(event, GraphRunSucceededEvent) for event in entry.run())
    assert state.graph_execution.workflow_id == "wf"


def test_explicit_file_scope_is_reentrant_and_restores_previous_adapter():
    from core.app.workflow.file_runtime import DifyWorkflowFileRuntime, bind_dify_workflow_file_runtime
    from graphon.file.runtime import peek_workflow_file_runtime

    previous = peek_workflow_file_runtime()
    with bind_dify_workflow_file_runtime():
        first = peek_workflow_file_runtime()
        assert isinstance(first, DifyWorkflowFileRuntime)
        with bind_dify_workflow_file_runtime():
            assert peek_workflow_file_runtime() is not first
        assert peek_workflow_file_runtime() is first
    assert peek_workflow_file_runtime() is previous


def test_pause_barrier_flushes_before_persisting_and_exposing_pause():
    from graphon.engine_events import GraphRunPausedEvent, GraphRunStartedEvent
    from services.workflow.execution_lifecycle import settled_workflow_events

    order = []

    def filtered_events():
        yield GraphRunStartedEvent()
        yield GraphRunPausedEvent()
        order.append("flush")

    stream = settled_workflow_events(filtered_events(), pause_callbacks=[lambda: order.append("persist")])
    next(stream)
    assert order == []
    assert isinstance(next(stream), GraphRunPausedEvent)
    assert order == ["flush", "persist"]


def test_pause_barrier_storage_failure_never_exposes_resumable_pause():
    from graphon.engine_events import GraphRunPausedEvent
    from services.workflow.execution_lifecycle import settled_workflow_events

    def failure():
        raise OSError("storage unavailable")

    with pytest.raises(OSError, match="storage unavailable"):
        list(settled_workflow_events([GraphRunPausedEvent()], pause_callbacks=[failure]))


def test_nested_ancestry_uses_actual_direct_container_and_retains_occurrence_id():
    from datetime import UTC, datetime

    from graphon.engine_events import NodeRunSucceededEvent
    from services.workflow.event_ancestry import WorkflowEventAncestry

    ancestry = WorkflowEventAncestry(
        {
            "nodes": [
                {"id": "outer", "data": {"type": "iteration", "container_id": ""}},
                {"id": "inner", "data": {"type": "loop", "container_id": "outer"}},
                {"id": "child", "data": {"type": "end", "container_id": "inner"}},
            ]
        }
    )
    first = NodeRunSucceededEvent(
        id="occurrence-a", node_id="child", node_type="end", container_id="inner", start_at=datetime.now(UTC)
    )
    second = first.model_copy(update={"id": "occurrence-b"})
    projected = ancestry.resolve(first.container_id)
    assert projected.iteration_id == "outer"
    assert projected.loop_id == "inner"
    assert ancestry.resolve(second.container_id) == projected
    assert first.id != second.id
    assert ancestry.resolve("").iteration_id is None


def test_real_engine_pause_snapshot_follows_quiescence_and_outer_filter_flush():
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
    from core.app.layers.pause_state_persist_layer import PauseStatePersistenceLayer
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.workflow_entry import WorkflowEntry
    from graphon.engine.command import PauseCommand
    from graphon.engine.filter import ResponseStreamFilter
    from graphon.engine.layer import Layer
    from graphon.engine_events import GraphRunPausedEvent
    from graphon.graph import Graph
    from tests.workflow_test_utils import build_test_graph_init_params

    config = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [
            {"id": "start-end", "source": "start", "target": "end", "sourceHandle": "source", "targetHandle": "target"}
        ],
    }
    order = []

    class PauseBeforeWorkers(Layer):
        def on_graph_start(self):
            self.command_channel.send_command(PauseCommand(reason="test"))

        def on_graph_end(self, _error):
            order.append("quiescent")

    class FlushRecorder(ResponseStreamFilter):
        def flush(self):
            result = list(super().flush())
            order.append("flush")
            return result

    state = RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="wf")
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="wf", graph_config=config), runtime_state=state
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    response_filter = FlushRecorder()
    entry = WorkflowEntry(
        tenant_id="tenant",
        app_id="app",
        workflow_id="wf",
        graph_config=config,
        graph=graph,
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        variable_pool=state.variable_pool,
        runtime_state=state,
        response_stream_filter=response_filter,
    )
    entry.add_layer(PauseBeforeWorkers())
    snapshots = []

    class SnapshotProbe(PauseStatePersistenceLayer):
        def persist_paused_state(self):
            assert order == ["quiescent", "flush"]
            snapshots.append((self.runtime_state.dumps(), response_filter.dumps()))
            order.append("persist")

    probe = object.__new__(SnapshotProbe)
    Layer.__init__(probe)
    probe._paused_event = None
    entry.add_layer(probe)
    events = list(entry.run())
    assert isinstance(events[-1], GraphRunPausedEvent)
    assert order == ["quiescent", "flush", "persist"]
    assert len(snapshots) == 1
    assert entry.graph_engine.file_runtime is not None

    # Rebuild from the exact emitted snapshot and bind a fresh host adapter on resume.
    restored = RuntimeState.from_snapshot(snapshots[0][0])
    restored_filter = ResponseStreamFilter()
    restored_filter.loads(snapshots[0][1])
    restored_factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="wf", graph_config=config), runtime_state=restored
    )
    restored_graph = Graph.init(graph_config=config, node_factory=restored_factory, root_node_id="start")
    resumed = WorkflowEntry(
        tenant_id="tenant",
        app_id="app",
        workflow_id="wf",
        graph_config=config,
        graph=restored_graph,
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        variable_pool=restored.variable_pool,
        runtime_state=restored,
        response_stream_filter=restored_filter,
    )
    seen_adapters = []

    class ObserveFiles(Layer):
        def on_node_run_start(self, _node):
            from graphon.file.runtime import peek_workflow_file_runtime

            seen_adapters.append(peek_workflow_file_runtime())

    resumed.add_layer(ObserveFiles())
    from graphon.engine_events import GraphRunSucceededEvent

    assert isinstance(list(resumed.run())[-1], GraphRunSucceededEvent)
    assert resumed.graph_engine.file_runtime is not entry.graph_engine.file_runtime
    assert seen_adapters
    assert all(adapter is resumed.graph_engine.file_runtime for adapter in seen_adapters)


def test_host_context_does_not_replace_engine_file_adapter_on_any_segment():
    from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
    from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime
    from services.workflow.execution_lifecycle import WorkflowExecutionContextLayer

    # Request context is captured before the engine (or resumed engine) chooses its adapter.
    layer = WorkflowExecutionContextLayer()
    for _ in range(2):
        adapter = DifyWorkflowFileRuntime(file_access_controller=Mock())
        with use_workflow_file_runtime(adapter):
            with layer.node_run_context(Mock()):
                assert peek_workflow_file_runtime() is adapter


def test_historical_v2_loop_snapshot_resumes_with_dify_scoped_factory(monkeypatch):
    import json
    from pathlib import Path

    from core.workflow.node_factory import DifyNodeFactory
    from graphon.engine import Engine
    from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
    from graphon.graph import Graph
    from graphon.nodes.human_input.entities import Completed
    from graphon.variables.segments import StringSegment
    from tests.workflow_test_utils import build_test_graph_init_params

    snapshot = (
        Path(__file__)
        .with_name("fixtures")
        .joinpath("graphon_history/runtime_state_v2_1d0f32c_paused_loop.json")
        .read_text()
    )
    assert json.loads(snapshot)["container_frames"]
    config = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {
                "id": "loop",
                "data": {
                    "type": "loop",
                    "title": "Three rounds",
                    "loop_count": 3,
                    "start_node_id": "loop-start",
                    "break_conditions": [],
                    "logical_operator": "and",
                    "loop_variables": [
                        {"label": "seed", "var_type": "string", "value_type": "constant", "value": "fixed"}
                    ],
                },
            },
            {"id": "loop-start", "data": {"type": "loop-start", "loop_id": "loop"}},
            {"id": "human-input", "data": {"type": "human-input", "title": "Approve loop round", "loop_id": "loop"}},
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "outputs": [
                        {"variable": "rounds", "value_selector": ["loop", "loop_round"]},
                        {"variable": "seed", "value_selector": ["loop", "seed"]},
                    ],
                },
            },
        ],
        "edges": [
            {"id": "start-to-loop", "source": "start", "target": "loop"},
            {"id": "loop-start-to-human-input", "source": "loop-start", "target": "human-input"},
            {"id": "loop-to-end", "source": "loop", "target": "end"},
        ],
    }
    observed = []

    def complete(context):
        observed.append(context.node_id)
        return Completed(selected_handle="source", inputs={}, outputs={"answer": StringSegment(value="approved")})

    monkeypatch.setattr(DifyNodeFactory, "_build_human_input_callback", lambda *_args, **_kwargs: complete)
    state = RuntimeState.from_snapshot(snapshot)
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="workflow", graph_config=config), runtime_state=state
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    events = list(Engine(graph=graph, runtime_state=state, workers=2).run())
    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert events[-1].outputs == {"rounds": 3, "seed": "fixed"}
    children = [
        event for event in events if isinstance(event, NodeRunSucceededEvent) and event.node_id == "human-input"
    ]
    assert observed == ["human-input", "human-input"]
    assert [event.container_id for event in children] == ["loop", "loop"]
    assert len({event.id for event in children}) == 2
    assert json.loads(state.dumps())["version"] == "3.0"


def test_historical_v1_response_filter_bytes_are_accepted_without_rewriting():
    import hashlib
    import json
    from pathlib import Path

    from graphon.engine.filter import ResponseStreamFilter

    directory = Path(__file__).with_name("fixtures") / "graphon_history"
    manifest = json.loads((directory / "PROVENANCE.json").read_text())
    for name, receipt in manifest["fixtures"].items():
        data = (directory / name).read_bytes()
        assert hashlib.sha256(data).hexdigest() == receipt["sha256"]
        if name.startswith("response_stream_filter"):
            response_filter = ResponseStreamFilter()
            response_filter.loads(data.decode())
            with pytest.raises(RuntimeError, match="must be initialized before serialization"):
                response_filter.dumps()


def test_historical_v1_filter_binds_original_edge_position_to_public_id():
    import json
    from pathlib import Path

    from core.workflow.node_factory import DifyNodeFactory
    from graphon.engine import Engine
    from graphon.engine.filter import EngineEventFilterContext, ResponseStreamFilter
    from graphon.graph import Graph
    from tests.workflow_test_utils import build_test_graph_init_params

    config = {
        "nodes": [
            {"id": "source", "data": {"type": "start", "variables": []}},
            {"id": "answer", "data": {"type": "answer", "answer": "{{#source.answer#}}"}},
        ],
        "edges": [{"id": "public-response-edge", "source": "source", "target": "answer"}],
    }
    state = RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="wf")
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="wf", graph_config=config), runtime_state=state
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="source")
    response_filter = ResponseStreamFilter()
    response_filter.loads(
        Path(__file__)
        .with_name("fixtures")
        .joinpath("graphon_history/response_stream_filter_v1_c3870df_simple.json")
        .read_text()
    )
    response_filter.initialize(EngineEventFilterContext.from_engine(Engine(graph=graph, runtime_state=state)))
    migrated = json.loads(response_filter.dumps())
    assert migrated["version"] == "2.0"
    assert migrated["paths_map"] == {"answer": [["public-response-edge"]]}


def test_legacy_v1_child_tasks_fail_closed_without_fabricating_frames():
    """Explicit v1 format contract; this constructed payload is not a historical fixture."""
    import json

    from core.workflow.node_factory import DifyNodeFactory
    from graphon.engine import Engine
    from graphon.graph import Graph
    from graphon.model_runtime.entities.llm_entities import LLMUsage
    from tests.workflow_test_utils import build_test_graph_init_params

    payload = {
        "version": "1.0",
        "start_at": 0,
        "total_tokens": 0,
        "node_run_steps": 0,
        "llm_usage": LLMUsage.empty_usage().model_dump(mode="json"),
        "outputs": {},
        "variable_pool": {"variable_dictionary": {}},
        "ready_queue": json.dumps({"type": "InMemoryReadyQueue", "version": "1.0", "items": []}),
        "graph_execution": json.dumps(
            {
                "type": "GraphExecution",
                "version": "1.0",
                "workflow_id": "wf",
                "started": True,
                "completed": False,
                "aborted": False,
                "paused": True,
                "pause_reasons": [],
                "error": None,
                "exceptions_count": 0,
                "node_executions": [],
            }
        ),
        "paused_nodes": ["child-without-frame"],
        "deferred_nodes": [],
        "graph_state": {
            "nodes": {"start": "unknown", "end": "unknown", "child-without-frame": "unknown"},
            "edges": {"edge_0": "unknown"},
        },
    }
    config = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {"id": "end", "data": {"type": "end", "outputs": []}},
        ],
        "edges": [{"id": "public-edge", "source": "start", "target": "end"}],
    }
    state = RuntimeState.from_snapshot(json.dumps(payload))
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="wf", graph_config=config), runtime_state=state
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    with pytest.raises(RuntimeError, match="child-frame tasks that cannot be restored without frame state"):
        Engine(graph=graph, runtime_state=state)
    assert state.take_deferred_ready_tasks() == [StartTask(frame_id="root", node_id="child-without-frame")]


def test_single_node_execution_binds_an_explicit_file_adapter(monkeypatch):
    from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.workflow_entry import WorkflowEntry
    from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime
    from graphon.node_events import NodeRunResult
    from tests.workflow_test_utils import build_test_graph_init_params

    config = {"nodes": [{"id": "start", "data": {"type": "start", "variables": []}}], "edges": []}
    state = RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="wf")
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="wf", graph_config=config), runtime_state=state
    )
    node = factory.create_node(config["nodes"][0])
    adapters = []

    def run():
        adapters.append(peek_workflow_file_runtime())
        return NodeRunResult()

    monkeypatch.setattr(node, "_run", run)
    with use_workflow_file_runtime(None):
        list(WorkflowEntry._run_node_with_layers(node, tenant_id="tenant"))
        assert peek_workflow_file_runtime() is None
    assert len(adapters) == 1
    assert isinstance(adapters[0], DifyWorkflowFileRuntime)
