import datetime
import time
from typing import Any
from unittest.mock import MagicMock

from core.workflow.entities import GraphInitParams
from core.workflow.entities.workflow_start_reason import WorkflowStartReason
from core.workflow.graph import Graph
from core.workflow.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_events.graph import GraphRunStartedEvent
from core.workflow.nodes.base.entities import OutputVariableEntity
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserAction
from core.workflow.nodes.human_input.human_input_node import HumanInputNode
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.repositories.human_input_form_repository import (
    HumanInputFormEntity,
    HumanInputFormRepository,
)
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from libs.datetime_utils import naive_utc_now


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
    repo = MagicMock(spec=HumanInputFormRepository)
    form_entity = MagicMock(spec=HumanInputFormEntity)
    form_entity.id = "test-form-id"
    form_entity.web_app_token = "test-form-token"
    form_entity.recipients = []
    form_entity.rendered_content = "rendered"
    form_entity.submitted = True
    form_entity.selected_action_id = action_id
    form_entity.submitted_data = {}
    form_entity.expiration_time = naive_utc_now() + datetime.timedelta(days=1)
    repo.get_form.return_value = form_entity
    return repo


def _mock_form_repository_without_submission() -> HumanInputFormRepository:
    repo = MagicMock(spec=HumanInputFormRepository)
    form_entity = MagicMock(spec=HumanInputFormEntity)
    form_entity.id = "test-form-id"
    form_entity.web_app_token = "test-form-token"
    form_entity.recipients = []
    form_entity.rendered_content = "rendered"
    form_entity.submitted = False
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

    end_data = EndNodeData(
        title="end",
        outputs=[
            OutputVariableEntity(variable="result", value_selector=["human", "action_id"]),
        ],
        desc=None,
    )
    end_node = EndNode(
        id="end",
        config={"id": "end", "data": end_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

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


def _node_start_event(events: list[GraphEngineEvent], node_id: str) -> NodeRunStartedEvent | None:
    for event in events:
        if isinstance(event, NodeRunStartedEvent) and event.node_id == node_id:
            return event
    return None


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
    assert baseline_events
    first_paused_event = baseline_events[0]
    assert isinstance(first_paused_event, GraphRunStartedEvent)
    assert first_paused_event.reason is WorkflowStartReason.INITIAL
    assert isinstance(baseline_events[-1], GraphRunSucceededEvent)
    baseline_success_nodes = _node_successes(baseline_events)

    # Run with pause
    paused_state = _build_runtime_state()
    pause_repo = _mock_form_repository_without_submission()
    paused_graph = _build_human_input_graph(paused_state, pause_repo)
    paused_events = _run_graph(paused_graph, paused_state)
    assert paused_events
    first_paused_event = paused_events[0]
    assert isinstance(first_paused_event, GraphRunStartedEvent)
    assert first_paused_event.reason is WorkflowStartReason.INITIAL
    assert isinstance(paused_events[-1], GraphRunPausedEvent)
    snapshot = paused_state.dumps()

    # Resume from snapshot
    resumed_state = GraphRuntimeState.from_snapshot(snapshot)
    resume_repo = _mock_form_repository_with_submission(action_id="continue")
    resumed_graph = _build_human_input_graph(resumed_state, resume_repo)
    resumed_events = _run_graph(resumed_graph, resumed_state)
    assert resumed_events
    first_resumed_event = resumed_events[0]
    assert isinstance(first_resumed_event, GraphRunStartedEvent)
    assert first_resumed_event.reason is WorkflowStartReason.RESUMPTION
    assert isinstance(resumed_events[-1], GraphRunSucceededEvent)

    combined_success_nodes = _node_successes(paused_events) + _node_successes(resumed_events)
    assert combined_success_nodes == baseline_success_nodes

    paused_human_started = _node_start_event(paused_events, "human")
    resumed_human_started = _node_start_event(resumed_events, "human")
    assert paused_human_started is not None
    assert resumed_human_started is not None
    assert paused_human_started.id == resumed_human_started.id

    assert baseline_state.outputs == resumed_state.outputs
    assert _segment_value(baseline_state.variable_pool, ("human", "__action_id")) == _segment_value(
        resumed_state.variable_pool, ("human", "__action_id")
    )
    assert baseline_state.graph_execution.completed
    assert resumed_state.graph_execution.completed
