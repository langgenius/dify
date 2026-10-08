"""Regression tests for Answer nodes inside loop/iteration (#42547)."""

from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import GraphRunSucceededEvent, NodeRunLoopNextEvent, NodeRunSucceededEvent
from graphon.nodes import BuiltinNodeTypes
from tests.unit_tests.core.workflow.graph_engine.test_table_runner import TableTestRunner, WorkflowTestCase


def test_loop_with_inner_answer_completes_all_iterations_and_streams_outer_answer() -> None:
    runner = TableTestRunner(graph_engine_min_workers=1, graph_engine_max_workers=1)
    result = runner.run_test_case(
        WorkflowTestCase(
            fixture_path="loop_contains_answer.yml",
            query="hello",
            description="loop contains inner answer (#42547)",
        )
    )

    assert result.success, result.error
    assert result.events

    inner_answer_id = "1755204039754"
    outer_answer_id = "1755203915300"

    inner_successes = [
        event
        for event in result.events
        if isinstance(event, NodeRunSucceededEvent)
        and event.node_type == BuiltinNodeTypes.ANSWER
        and event.node_id == inner_answer_id
    ]
    assert len(inner_successes) >= 2, "loop should run more than one iteration before break"

    loop_next_events = [event for event in result.events if isinstance(event, NodeRunLoopNextEvent)]
    assert loop_next_events, "loop should advance to a next iteration"

    success_events = [event for event in result.events if isinstance(event, GraphRunSucceededEvent)]
    assert success_events
    final_answer = success_events[-1].outputs.get("answer")
    assert isinstance(final_answer, str)
    assert "hello + 2" in final_answer

    from graphon.graph_events import NodeRunStreamChunkEvent

    stream_chunks = [event for event in result.events if isinstance(event, NodeRunStreamChunkEvent)]
    assert stream_chunks
    streamed_text = "".join(event.chunk for event in stream_chunks)
    assert "hello + 2" in streamed_text.replace("\n", " ")


def test_dify_response_stream_filter_skips_container_scoped_answer_nodes() -> None:
    from core.workflow.response_stream_filter import DifyResponseStreamFilter, is_response_node_inside_loop_or_iteration
    from tests.unit_tests.core.workflow.graph_engine.test_table_runner import WorkflowRunner

    workflow_runner = WorkflowRunner()
    fixture = workflow_runner.load_fixture("loop_contains_answer.yml")
    graph, graph_runtime_state = workflow_runner.create_graph_from_fixture(fixture, query="hello")

    assert is_response_node_inside_loop_or_iteration(graph, "1755204039754")
    assert not is_response_node_inside_loop_or_iteration(graph, "1755203915300")

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(min_workers=1, max_workers=1),
    )
    response_filter = DifyResponseStreamFilter()
    from graphon.filters import GraphEventFilterContext

    response_filter.initialize(GraphEventFilterContext.from_engine(engine))

    assert "1755204039754" not in response_filter._response_nodes
    assert "1755203915300" in response_filter._response_nodes
    assert response_filter._pass_unmatched_chunks is True
