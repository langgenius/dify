from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.filters import GraphEventFilterContext, ResponseStreamFilter, filter_graph_events
from graphon.graph import Graph
from graphon.graph_events import (
    GraphEdgeSkippedEvent,
    GraphEdgeTakenEvent,
    GraphRunStartedEvent,
    NodeRunStreamChunkEvent,
)
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


def test_skipped_edge_unlocks_downstream_answer_stream() -> None:
    graph_init_params = build_test_graph_init_params(
        workflow_id="workflow-id",
        graph_config={"nodes": [], "edges": []},
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(system_variables={}, user_inputs={}),
        start_at=0.0,
    )
    start_node = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )
    intermediate_answer = AnswerNode(
        node_id="intermediate",
        data=AnswerNodeData(title="Intermediate", answer="Intermediate answer"),
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )
    answer_node = AnswerNode(
        node_id="answer",
        data=AnswerNodeData(title="Answer", answer="Fallback answer"),
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )
    graph = (
        Graph.new()
        .add_root(start_node)
        .add_node(intermediate_answer, from_node_id="start")
        .add_node(answer_node, from_node_id="intermediate")
        .build()
    )

    engine = MagicMock()
    engine.graph = graph
    engine.graph_runtime_state = runtime_state
    raw_events = [
        GraphRunStartedEvent(),
        GraphEdgeTakenEvent(
            edge_id="edge_0",
            source_node_id="start",
            target_node_id="intermediate",
        ),
        GraphEdgeSkippedEvent(
            edge_id="edge_1",
            source_node_id="intermediate",
            target_node_id="answer",
        ),
    ]
    engine.run.return_value = iter(raw_events)

    current_graphon_events = list(
        filter_graph_events(
            raw_events,
            context=GraphEventFilterContext.from_engine(engine),
            filters=[ResponseStreamFilter()],
        )
    )
    current_answer_chunks = [
        event.chunk
        for event in current_graphon_events
        if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "answer"
    ]
    assert not current_answer_chunks

    engine.run.return_value = iter(raw_events)
    events = list(iter_dify_graph_engine_events(engine))

    answer_chunks = [
        event.chunk for event in events if isinstance(event, NodeRunStreamChunkEvent) and event.node_id == "answer"
    ]
    assert "Fallback answer" in answer_chunks
