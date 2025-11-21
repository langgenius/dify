import time
from collections.abc import Generator, Mapping
from typing import Any

import core.workflow.nodes.human_input.entities  # noqa: F401
from core.workflow.entities import GraphInitParams
from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import NodeEventBase, NodeRunResult, PauseRequestedEvent
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig, VariableSelector
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


class _PausingNodeData(BaseNodeData):
    pass


class _PausingNode(Node):
    node_type = NodeType.TOOL

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = _PausingNodeData.model_validate(data)

    def _get_error_strategy(self):
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @staticmethod
    def _pause_generator(event: PauseRequestedEvent) -> Generator[NodeEventBase, None, None]:
        yield event

    def _run(self) -> NodeRunResult | Generator[NodeEventBase, None, None]:
        resumed_flag = self.graph_runtime_state.variable_pool.get((self.id, "resumed"))
        if resumed_flag is None:
            # mark as resumed and request pause
            self.graph_runtime_state.variable_pool.add((self.id, "resumed"), True)
            return self._pause_generator(PauseRequestedEvent(reason=SchedulingPause(message="test pause")))

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"value": "completed"},
        )


def _build_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="user", app_id="app", workflow_id="workflow"),
        user_inputs={},
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


def _build_pausing_graph(runtime_state: GraphRuntimeState) -> Graph:
    graph_config: dict[str, object] = {"nodes": [], "edges": []}
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

    start_data = StartNodeData(title="start", variables=[])
    start_node = StartNode(
        id="start",
        config={"id": "start", "data": start_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )
    start_node.init_node_data(start_data.model_dump())

    pause_data = _PausingNodeData(title="pausing")
    pause_node = _PausingNode(
        id="pausing",
        config={"id": "pausing", "data": pause_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )
    pause_node.init_node_data(pause_data.model_dump())

    end_data = EndNodeData(
        title="end",
        outputs=[
            VariableSelector(variable="result", value_selector=["pausing", "value"]),
        ],
        desc=None,
    )
    end_node = EndNode(
        id="end",
        config={"id": "end", "data": end_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )
    end_node.init_node_data(end_data.model_dump())

    return Graph.new().add_root(start_node).add_node(pause_node).add_node(end_node).build()


def _run_graph(graph: Graph, runtime_state: GraphRuntimeState) -> list[GraphEngineEvent]:
    engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=runtime_state,
        command_channel=InMemoryChannel(),
    )
    return list(engine.run())


def _node_successes(events: list[GraphEngineEvent]) -> list[str]:
    return [event.node_id for event in events if isinstance(event, NodeRunSucceededEvent)]


def _segment_value(variable_pool: VariablePool, selector: tuple[str, str]) -> Any:
    segment = variable_pool.get(selector)
    assert segment is not None
    return getattr(segment, "value", segment)


def test_engine_resume_restores_state_and_completion():
    # Baseline run without pausing
    baseline_state = _build_runtime_state()
    baseline_graph = _build_pausing_graph(baseline_state)
    baseline_state.variable_pool.add(("pausing", "resumed"), True)
    baseline_events = _run_graph(baseline_graph, baseline_state)
    assert isinstance(baseline_events[-1], GraphRunSucceededEvent)
    baseline_success_nodes = _node_successes(baseline_events)

    # Run with pause
    paused_state = _build_runtime_state()
    paused_graph = _build_pausing_graph(paused_state)
    paused_events = _run_graph(paused_graph, paused_state)
    assert isinstance(paused_events[-1], GraphRunPausedEvent)
    snapshot = paused_state.dumps()

    # Resume from snapshot
    resumed_state = GraphRuntimeState.from_snapshot(snapshot)
    resumed_graph = _build_pausing_graph(resumed_state)
    resumed_events = _run_graph(resumed_graph, resumed_state)
    assert isinstance(resumed_events[-1], GraphRunSucceededEvent)

    combined_success_nodes = _node_successes(paused_events) + _node_successes(resumed_events)
    assert combined_success_nodes == baseline_success_nodes

    assert baseline_state.outputs == resumed_state.outputs
    assert _segment_value(baseline_state.variable_pool, ("pausing", "resumed")) == _segment_value(
        resumed_state.variable_pool, ("pausing", "resumed")
    )
    assert _segment_value(baseline_state.variable_pool, ("pausing", "value")) == _segment_value(
        resumed_state.variable_pool, ("pausing", "value")
    )
    assert baseline_state.graph_execution.completed
    assert resumed_state.graph_execution.completed
