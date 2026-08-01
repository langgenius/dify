"""Regression coverage for answer nodes inside iteration/loop containers (#38867).

Answer nodes inside a container run in a child graph, so the parent
ResponseStreamFilter can never activate their streaming sessions. The child
engine must synthesize their stream chunks and the parent filter must pass the
forwarded chunks through, otherwise the inner answer never reaches the client.
"""

from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import (
    GraphRunSucceededEvent,
    NodeRunStreamChunkEvent,
)

from .test_table_runner import TableTestRunner, _TableTestChildEngineBuilder


def _run_fixture(fixture_name: str, query: str) -> list[object]:
    runner = TableTestRunner()
    fixture_data = runner.workflow_runner.load_fixture(fixture_name)
    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query=query,
    )
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
        child_engine_builder=_TableTestChildEngineBuilder(use_mock_factory=False, mock_config=None),
    )
    return list(iter_dify_graph_engine_events(engine))


def test_answer_in_iteration_streams_each_item():
    events = _run_fixture("iteration_contains_answer", query="hi")

    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    streamed_answer = "".join(event.chunk for event in stream_chunk_events)
    assert streamed_answer == "apple\nbanana\ndone"

    # The inner answer chunks are forwarded by the iteration container
    in_iteration_chunks = [e for e in stream_chunk_events if e.in_iteration_id == "iteration_node"]
    assert "".join(event.chunk for event in in_iteration_chunks) == "apple\nbanana\n"


def test_answer_in_loop_streams_each_round():
    events = _run_fixture("loop_contains_answer", query="hi")

    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    streamed_answer = "".join(event.chunk for event in stream_chunk_events)
    assert streamed_answer == "1\n2\nhi + 2"
    assert success_events[-1].outputs["answer"] == "1\n2\nhi + 2"
