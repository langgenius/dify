import time

from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunPauseRequestedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.human_input import HumanInputNode
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable

from .test_table_runner import TableTestRunner, WorkflowTestCase


def _build_human_input_graph() -> tuple[Graph, GraphRuntimeState]:
    graph_config: dict[str, object] = {"nodes": [], "edges": []}
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="user", app_id="app", workflow_id="workflow"),
        user_inputs={},
        conversation_variables=[],
    )
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    start_config = {"id": "start", "data": StartNodeData(title="Start", variables=[]).model_dump()}
    start_node = StartNode(
        id=start_config["id"],
        config=start_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    start_node.init_node_data(start_config["data"])

    human_data = HumanInputNodeData(
        title="Human Input",
        required_variables=["human.input_ready"],
        pause_reason="Awaiting human input",
    )
    human_config = {"id": "human", "data": human_data.model_dump()}
    human_node = HumanInputNode(
        id=human_config["id"],
        config=human_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    human_node.init_node_data(human_config["data"])

    end_data = EndNodeData(title="End", outputs=[], desc=None)
    end_config = {"id": "end", "data": end_data.model_dump()}
    end_node = EndNode(
        id=end_config["id"],
        config=end_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    end_node.init_node_data(end_config["data"])

    graph = Graph.new().add_root(start_node).add_node(human_node).add_node(end_node).build()
    return graph, graph_runtime_state


def test_human_input_node_pause_and_resume():
    runner = TableTestRunner()
    expected_sequence: list[type] = [
        GraphRunStartedEvent,
        NodeRunStartedEvent,
        NodeRunSucceededEvent,
        NodeRunStartedEvent,
        NodeRunPauseRequestedEvent,
        GraphRunPausedEvent,
    ]

    test_case = WorkflowTestCase(
        expected_outputs={},
        description="HumanInput node pauses execution",
        expected_event_sequence=expected_sequence,
        graph_factory=_build_human_input_graph,
    )

    result = runner.run_test_case(test_case)

    assert result.success
    pause_events = [event for event in result.events if isinstance(event, NodeRunPauseRequestedEvent)]
    assert len(pause_events) == 1
    assert pause_events[0].reason == "Awaiting human input"

    graph_runtime_state = result.graph_runtime_state
    graph = result.graph
    assert graph_runtime_state is not None
    assert graph is not None

    # Prepare runtime state for resume
    graph_runtime_state.variable_pool.add(("human", "input_ready"), True)
    graph_runtime_state.graph_execution.pause_reason = None

    resume_engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        min_workers=runner.graph_engine_min_workers,
        max_workers=runner.graph_engine_max_workers,
        scale_up_threshold=runner.graph_engine_scale_up_threshold,
        scale_down_idle_time=runner.graph_engine_scale_down_idle_time,
    )

    resume_events = list(resume_engine.run())

    resume_event_types = [type(event) for event in resume_events]
    assert resume_event_types == [
        GraphRunStartedEvent,
        NodeRunStartedEvent,
        NodeRunSucceededEvent,
        NodeRunStartedEvent,
        NodeRunSucceededEvent,
        GraphRunSucceededEvent,
    ]

    started_nodes = [event.node_id for event in resume_events if isinstance(event, NodeRunStartedEvent)]
    assert started_nodes == ["human", "end"]
