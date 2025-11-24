import time
from typing import Any
from unittest.mock import MagicMock

from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserAction
from core.workflow.nodes.human_input.human_input_node import HumanInputNode
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.repositories.human_input_form_repository import (
    FormSubmission,
    HumanInputFormEntity,
    HumanInputFormRepository,
)
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


def _build_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable(
            user_id="user",
            app_id="app",
            workflow_id="workflow",
            workflow_execution_id="test-execution-id",
        ),
        user_inputs={},
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


def _mock_form_repository_with_submission(action_id: str) -> HumanInputFormRepository:
    submission = MagicMock(spec=FormSubmission)
    submission.selected_action_id = action_id
    submission.form_data.return_value = {}
    repo = MagicMock(spec=HumanInputFormRepository)
    repo.get_form_submission.return_value = submission
    form_entity = MagicMock(spec=HumanInputFormEntity)
    form_entity.id = "test-form-id"
    form_entity.web_app_token = "test-form-token"
    form_entity.recipients = []
    repo.get_form.return_value = form_entity
    return repo


def _mock_form_repository_without_submission() -> HumanInputFormRepository:
    repo = MagicMock(spec=HumanInputFormRepository)
    repo.get_form_submission.return_value = None
    form_entity = MagicMock(spec=HumanInputFormEntity)
    form_entity.id = "test-form-id"
    form_entity.web_app_token = "test-form-token"
    form_entity.recipients = []
    repo.create_form.return_value = form_entity
    repo.get_form.return_value = None
    return repo


def _build_human_input_graph(
    runtime_state: GraphRuntimeState,
    form_repository: HumanInputFormRepository,
) -> Graph:
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

    human_data = HumanInputNodeData(
        title="human",
        form_content="Awaiting human input",
        inputs=[],
        user_actions=[
            UserAction(id="continue", title="Continue"),
        ],
    )
    human_node = HumanInputNode(
        id="human",
        config={"id": "human", "data": human_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
        form_repository=form_repository,
    )
    human_node.init_node_data(human_data.model_dump())

    end_data = EndNodeData(
        title="end",
        outputs=[
            VariableSelector(variable="result", value_selector=["human", "action_id"]),
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

    return (
        Graph.new()
        .add_root(start_node)
        .add_node(human_node)
        .add_node(end_node, from_node_id="human", source_handle="continue")
        .build()
    )


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
    baseline_repo = _mock_form_repository_with_submission(action_id="continue")
    baseline_graph = _build_human_input_graph(baseline_state, baseline_repo)
    baseline_events = _run_graph(baseline_graph, baseline_state)
    assert isinstance(baseline_events[-1], GraphRunSucceededEvent)
    baseline_success_nodes = _node_successes(baseline_events)

    # Run with pause
    paused_state = _build_runtime_state()
    pause_repo = _mock_form_repository_without_submission()
    paused_graph = _build_human_input_graph(paused_state, pause_repo)
    paused_events = _run_graph(paused_graph, paused_state)
    assert isinstance(paused_events[-1], GraphRunPausedEvent)
    snapshot = paused_state.dumps()

    # Resume from snapshot
    resumed_state = GraphRuntimeState.from_snapshot(snapshot)
    resume_repo = _mock_form_repository_with_submission(action_id="continue")
    resumed_graph = _build_human_input_graph(resumed_state, resume_repo)
    resumed_events = _run_graph(resumed_graph, resumed_state)
    assert isinstance(resumed_events[-1], GraphRunSucceededEvent)

    combined_success_nodes = _node_successes(paused_events) + _node_successes(resumed_events)
    assert combined_success_nodes == baseline_success_nodes

    assert baseline_state.outputs == resumed_state.outputs
    assert _segment_value(baseline_state.variable_pool, ("human", "action_id")) == _segment_value(
        resumed_state.variable_pool, ("human", "action_id")
    )
    assert baseline_state.graph_execution.completed
    assert resumed_state.graph_execution.completed
