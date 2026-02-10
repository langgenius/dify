import sys
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

API_DIR = str(Path(__file__).resolve().parents[5])
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

import core.workflow.nodes.human_input.entities  # noqa: F401
from core.app.apps.advanced_chat import app_generator as adv_app_gen_module
from core.app.apps.workflow import app_generator as wf_app_gen_module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.workflow.entities import GraphInitParams
from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.entities.workflow_start_reason import WorkflowStartReason
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import NodeRunResult, PauseRequestedEvent
from core.workflow.nodes.base.entities import BaseNodeData, OutputVariableEntity, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable

if "core.ops.ops_trace_manager" not in sys.modules:
    ops_stub = ModuleType("core.ops.ops_trace_manager")

    class _StubTraceQueueManager:
        def __init__(self, *_, **__):
            pass

    ops_stub.TraceQueueManager = _StubTraceQueueManager
    sys.modules["core.ops.ops_trace_manager"] = ops_stub


class _StubToolNodeData(BaseNodeData):
    pause_on: bool = False


class _StubToolNode(Node[_StubToolNodeData]):
    node_type = NodeType.TOOL

    @classmethod
    def version(cls) -> str:
        return "1"

    def init_node_data(self, data):
        self._node_data = _StubToolNodeData.model_validate(data)

    def _get_error_strategy(self):
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self):
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    def _run(self):
        if self.node_data.pause_on:
            yield PauseRequestedEvent(reason=SchedulingPause(message="test pause"))
            return

        result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"value": f"{self.id}-done"},
        )
        yield self._convert_node_run_result_to_graph_node_event(result)


def _patch_tool_node(mocker):
    original_create_node = DifyNodeFactory.create_node

    def _patched_create_node(self, node_config: dict[str, object]) -> Node:
        node_data = node_config.get("data", {})
        if isinstance(node_data, dict) and node_data.get("type") == NodeType.TOOL.value:
            return _StubToolNode(
                id=str(node_config["id"]),
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
            )
        return original_create_node(self, node_config)

    mocker.patch.object(DifyNodeFactory, "create_node", _patched_create_node)


def _node_data(node_type: NodeType, data: BaseNodeData) -> dict[str, object]:
    node_data = data.model_dump()
    node_data["type"] = node_type.value
    return node_data


def _build_graph_config(*, pause_on: str | None) -> dict[str, object]:
    start_data = StartNodeData(title="start", variables=[])
    tool_data_a = _StubToolNodeData(title="tool", pause_on=pause_on == "tool_a")
    tool_data_b = _StubToolNodeData(title="tool", pause_on=pause_on == "tool_b")
    tool_data_c = _StubToolNodeData(title="tool", pause_on=pause_on == "tool_c")
    end_data = EndNodeData(
        title="end",
        outputs=[OutputVariableEntity(variable="result", value_selector=["tool_c", "value"])],
        desc=None,
    )

    nodes = [
        {"id": "start", "data": _node_data(NodeType.START, start_data)},
        {"id": "tool_a", "data": _node_data(NodeType.TOOL, tool_data_a)},
        {"id": "tool_b", "data": _node_data(NodeType.TOOL, tool_data_b)},
        {"id": "tool_c", "data": _node_data(NodeType.TOOL, tool_data_c)},
        {"id": "end", "data": _node_data(NodeType.END, end_data)},
    ]
    edges = [
        {"source": "start", "target": "tool_a"},
        {"source": "tool_a", "target": "tool_b"},
        {"source": "tool_b", "target": "tool_c"},
        {"source": "tool_c", "target": "end"},
    ]
    return {"nodes": nodes, "edges": edges}


def _build_graph(runtime_state: GraphRuntimeState, *, pause_on: str | None) -> Graph:
    graph_config = _build_graph_config(pause_on=pause_on)
    params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from="account",
        invoke_from="service-api",
        call_depth=0,
    )

    node_factory = DifyNodeFactory(
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    return Graph.init(graph_config=graph_config, node_factory=node_factory)


def _build_runtime_state(run_id: str) -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="user", app_id="app", workflow_id="workflow"),
        user_inputs={},
        conversation_variables=[],
    )
    variable_pool.system_variables.workflow_execution_id = run_id
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


def _run_with_optional_pause(runtime_state: GraphRuntimeState, *, pause_on: str | None) -> list[GraphEngineEvent]:
    command_channel = InMemoryChannel()
    graph = _build_graph(runtime_state, pause_on=pause_on)
    engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=runtime_state,
        command_channel=command_channel,
    )

    events: list[GraphEngineEvent] = []
    for event in engine.run():
        events.append(event)
    return events


def _node_successes(events: list[GraphEngineEvent]) -> list[str]:
    return [evt.node_id for evt in events if isinstance(evt, NodeRunSucceededEvent)]


def test_workflow_app_pause_resume_matches_baseline(mocker):
    _patch_tool_node(mocker)

    baseline_state = _build_runtime_state("baseline")
    baseline_events = _run_with_optional_pause(baseline_state, pause_on=None)
    assert isinstance(baseline_events[-1], GraphRunSucceededEvent)
    baseline_nodes = _node_successes(baseline_events)
    baseline_outputs = baseline_state.outputs

    paused_state = _build_runtime_state("paused-run")
    paused_events = _run_with_optional_pause(paused_state, pause_on="tool_a")
    assert isinstance(paused_events[-1], GraphRunPausedEvent)
    paused_nodes = _node_successes(paused_events)
    snapshot = paused_state.dumps()

    resumed_state = GraphRuntimeState.from_snapshot(snapshot)

    generator = wf_app_gen_module.WorkflowAppGenerator()

    def _fake_generate(**kwargs):
        state: GraphRuntimeState = kwargs["graph_runtime_state"]
        events = _run_with_optional_pause(state, pause_on=None)
        return _node_successes(events)

    mocker.patch.object(generator, "_generate", side_effect=_fake_generate)

    resumed_nodes = generator.resume(
        app_model=SimpleNamespace(mode="workflow"),
        workflow=SimpleNamespace(),
        user=SimpleNamespace(),
        application_generate_entity=SimpleNamespace(stream=False, invoke_from=InvokeFrom.SERVICE_API),
        graph_runtime_state=resumed_state,
        workflow_execution_repository=SimpleNamespace(),
        workflow_node_execution_repository=SimpleNamespace(),
    )

    assert paused_nodes + resumed_nodes == baseline_nodes
    assert resumed_state.outputs == baseline_outputs


def test_advanced_chat_pause_resume_matches_baseline(mocker):
    _patch_tool_node(mocker)

    baseline_state = _build_runtime_state("adv-baseline")
    baseline_events = _run_with_optional_pause(baseline_state, pause_on=None)
    assert isinstance(baseline_events[-1], GraphRunSucceededEvent)
    baseline_nodes = _node_successes(baseline_events)
    baseline_outputs = baseline_state.outputs

    paused_state = _build_runtime_state("adv-paused")
    paused_events = _run_with_optional_pause(paused_state, pause_on="tool_a")
    assert isinstance(paused_events[-1], GraphRunPausedEvent)
    paused_nodes = _node_successes(paused_events)
    snapshot = paused_state.dumps()

    resumed_state = GraphRuntimeState.from_snapshot(snapshot)

    generator = adv_app_gen_module.AdvancedChatAppGenerator()

    def _fake_generate(**kwargs):
        state: GraphRuntimeState = kwargs["graph_runtime_state"]
        events = _run_with_optional_pause(state, pause_on=None)
        return _node_successes(events)

    mocker.patch.object(generator, "_generate", side_effect=_fake_generate)

    resumed_nodes = generator.resume(
        app_model=SimpleNamespace(mode="workflow"),
        workflow=SimpleNamespace(),
        user=SimpleNamespace(),
        conversation=SimpleNamespace(id="conv"),
        message=SimpleNamespace(id="msg"),
        application_generate_entity=SimpleNamespace(stream=False, invoke_from=InvokeFrom.SERVICE_API),
        workflow_execution_repository=SimpleNamespace(),
        workflow_node_execution_repository=SimpleNamespace(),
        graph_runtime_state=resumed_state,
    )

    assert paused_nodes + resumed_nodes == baseline_nodes
    assert resumed_state.outputs == baseline_outputs


def test_resume_emits_resumption_start_reason(mocker) -> None:
    _patch_tool_node(mocker)

    paused_state = _build_runtime_state("resume-reason")
    paused_events = _run_with_optional_pause(paused_state, pause_on="tool_a")
    initial_start = next(event for event in paused_events if isinstance(event, GraphRunStartedEvent))
    assert initial_start.reason == WorkflowStartReason.INITIAL

    resumed_state = GraphRuntimeState.from_snapshot(paused_state.dumps())
    resumed_events = _run_with_optional_pause(resumed_state, pause_on=None)
    resume_start = next(event for event in resumed_events if isinstance(event, GraphRunStartedEvent))
    assert resume_start.reason == WorkflowStartReason.RESUMPTION
