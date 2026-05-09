import sys
import time
from types import ModuleType, SimpleNamespace
from typing import Any

from pytest_mock import MockerFixture

import graphon.nodes.human_input.entities  # noqa: F401
from core.app.apps.advanced_chat import app_generator as adv_app_gen_module
from core.app.apps.workflow import app_generator as wf_app_gen_module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow import node_factory as node_factory_module
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.entities.base_node_data import BaseNodeData, RetryConfig
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import BuiltinNodeTypes, NodeType, WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.graph_engine import GraphEngine
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from graphon.node_events import NodeRunResult, PauseRequestedEvent
from graphon.nodes.base.entities import OutputVariableEntity
from graphon.nodes.base.node import Node
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params

if "core.ops.ops_trace_manager" not in sys.modules:
    ops_stub = ModuleType("core.ops.ops_trace_manager")

    class _StubTraceQueueManager:
        def __init__(self, *_, **__):
            pass

    ops_stub.TraceQueueManager = _StubTraceQueueManager
    sys.modules["core.ops.ops_trace_manager"] = ops_stub


class _StubToolNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.TOOL
    pause_on: bool = False


class _StubToolNode(Node[_StubToolNodeData]):
    node_type = BuiltinNodeTypes.TOOL

    @classmethod
    def version(cls) -> str:
        return "1"

    def __init__(
        self,
        node_id: str,
        data: _StubToolNodeData,
        *,
        graph_init_params,
        graph_runtime_state,
        **_kwargs: Any,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

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


def _patch_tool_node(mocker: MockerFixture):
    original_resolve_node_class = node_factory_module.resolve_workflow_node_class

    def _patched_resolve_node_class(*, node_type: NodeType, node_version: str) -> type[Node]:
        if node_type == BuiltinNodeTypes.TOOL:
            return _StubToolNode
        return original_resolve_node_class(node_type=node_type, node_version=node_version)

    mocker.patch.object(node_factory_module, "resolve_workflow_node_class", side_effect=_patched_resolve_node_class)


def _node_data(node_type: NodeType, data: BaseNodeData) -> dict[str, object]:
    node_data = data.model_dump()
    node_data["type"] = str(node_type)
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
        {"id": "start", "data": _node_data(BuiltinNodeTypes.START, start_data)},
        {"id": "tool_a", "data": _node_data(BuiltinNodeTypes.TOOL, tool_data_a)},
        {"id": "tool_b", "data": _node_data(BuiltinNodeTypes.TOOL, tool_data_b)},
        {"id": "tool_c", "data": _node_data(BuiltinNodeTypes.TOOL, tool_data_c)},
        {"id": "end", "data": _node_data(BuiltinNodeTypes.END, end_data)},
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
    params = build_test_graph_init_params(
        workflow_id="workflow",
        graph_config=graph_config,
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from="account",
        invoke_from="service-api",
        call_depth=0,
    )

    node_factory = DifyNodeFactory(
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    return Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")


def _build_runtime_state(run_id: str) -> GraphRuntimeState:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="user", app_id="app", workflow_id="workflow"),
        user_inputs={},
        conversation_variables=[],
    )
    variable_pool.add(("sys", "workflow_run_id"), run_id)
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


def test_workflow_app_pause_resume_matches_baseline(mocker: MockerFixture):
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


def test_advanced_chat_pause_resume_matches_baseline(mocker: MockerFixture):
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
