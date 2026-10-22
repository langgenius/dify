"""Unit coverage for Dify's in-memory ResponseStreamFilter boundary behavior."""

from core.workflow.system_variables import default_system_variables
from core.workflow.workflow_entry import (
    _SkippedEdgeAwareResponseStreamFilter,
    iter_dify_graph_engine_events,
)
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine.filter import EngineEventFilterContext, ResponseStreamFilter, filter_engine_events
from graphon.engine_events import (
    GraphEdgeSkippedEvent,
    GraphEdgeTakenEvent,
    GraphRunSucceededEvent,
    NodeRunStreamChunkEvent,
)
from graphon.graph import Graph
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import RuntimeState, VariablePool
from tests.unit_tests.core.workflow.graph_engine.test_mock_config import MockConfig, MockConfigBuilder
from tests.unit_tests.core.workflow.graph_engine.test_table_runner import WorkflowRunner
from tests.workflow_test_utils import build_test_graph_init_params


def _build_issue_170_mock_config() -> tuple[WorkflowRunner, MockConfig]:
    runner = WorkflowRunner()
    mock_config = (
        MockConfigBuilder()
        .with_node_output(
            "llm",
            {
                "text": "Quiet Night Thought",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            },
        )
        .with_node_output(
            "dufu",
            {
                "text": "Spring View",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            },
        )
        .build()
    )

    return runner, mock_config


def test_dify_response_stream_filter_handles_issue_170_shape() -> None:
    runner, mock_config = _build_issue_170_mock_config()
    fixture_data = runner.load_fixture("response_stream_filter_issue_170_workflow")
    graph, graph_runtime_state = runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query="1",
        use_mock_factory=True,
        mock_config=mock_config,
    )

    expected_answer = "# Du Fu\n\nSpring View\n\n# Li Bai\n\nQuiet Night Thought"

    engine = Engine(
        graph=graph,
        runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
    )
    events = list(iter_dify_graph_engine_events(engine))

    stream_chunk_events = [event for event in events if isinstance(event, NodeRunStreamChunkEvent)]
    success_events = [event for event in events if isinstance(event, GraphRunSucceededEvent)]

    assert success_events
    assert stream_chunk_events
    actual_answer = "".join(event.chunk for event in stream_chunk_events)
    assert actual_answer.strip() == expected_answer
    assert stream_chunk_events[-1].is_final is True
    final_answer = success_events[-1].outputs["answer"]
    assert isinstance(final_answer, str)
    assert final_answer.strip() == expected_answer
    assert actual_answer.strip() == final_answer.strip()


def test_skipped_edge_unblocks_response_stream_without_rewriting_event() -> None:
    graph_runtime_state = RuntimeState(
        variable_pool=VariablePool.from_bootstrap(system_variables=default_system_variables(), user_inputs={}),
        start_at=0.0,
        workflow_id="workflow-id",
    )
    graph_init_params = build_test_graph_init_params(
        workflow_id="workflow-id",
        graph_config={"nodes": [], "edges": []},
    )
    start_node = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        init_params=graph_init_params,
        runtime_state=graph_runtime_state,
    )
    intermediate_answer = AnswerNode(
        node_id="intermediate",
        data=AnswerNodeData(title="Intermediate", answer="Intermediate answer"),
        init_params=graph_init_params,
        runtime_state=graph_runtime_state,
    )
    fallback_answer = AnswerNode(
        node_id="fallback",
        data=AnswerNodeData(title="Fallback", answer="Fallback answer"),
        init_params=graph_init_params,
        runtime_state=graph_runtime_state,
    )
    graph = (
        Graph.new()
        .add_root(start_node)
        .add_node(intermediate_answer, from_node_id="start")
        .add_node(fallback_answer, from_node_id="intermediate")
        .build()
    )
    engine = Engine(
        graph=graph,
        runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
    )
    raw_events = list(engine.run())

    skipped_edge_id = "edge_1"
    edge_to_skip = next(
        event for event in raw_events if isinstance(event, GraphEdgeTakenEvent) and event.edge_id == skipped_edge_id
    )
    skipped_edge = GraphEdgeSkippedEvent(**edge_to_skip.model_dump())
    events_with_skipped_edge = [skipped_edge if event is edge_to_skip else event for event in raw_events]
    context = EngineEventFilterContext.from_engine(engine)

    unadapted_events = list(
        filter_engine_events(
            events_with_skipped_edge,
            context=context,
            filters=[ResponseStreamFilter()],
        )
    )
    unadapted_chunks = [event.chunk for event in unadapted_events if isinstance(event, NodeRunStreamChunkEvent)]
    assert "Intermediate answer" in "".join(unadapted_chunks)
    assert "Fallback answer" not in "".join(unadapted_chunks)

    adapted_events = list(
        filter_engine_events(
            events_with_skipped_edge,
            context=context,
            filters=[_SkippedEdgeAwareResponseStreamFilter(ResponseStreamFilter())],
        )
    )

    streamed_chunks = [event for event in adapted_events if isinstance(event, NodeRunStreamChunkEvent)]
    assert streamed_chunks
    assert "Intermediate answer" in "".join(event.chunk for event in streamed_chunks)
    assert "Fallback answer" in "".join(event.chunk for event in streamed_chunks)
    assert any(
        isinstance(event, GraphEdgeSkippedEvent) and event.edge_id == skipped_edge_id for event in adapted_events
    )
    assert not any(
        isinstance(event, GraphEdgeTakenEvent) and event.edge_id == skipped_edge_id for event in adapted_events
    )
