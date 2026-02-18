from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphRunSucceededEvent,
    NodeRunStreamChunkEvent,
)

from .test_table_runner import TableTestRunner


def test_tool_in_chatflow():
    runner = TableTestRunner()

    # Load the workflow configuration
    fixture_data = runner.workflow_runner.load_fixture("chatflow_time_tool_static_output_workflow")

    # Create graph from fixture with auto-mock enabled
    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query="1",
        use_mock_factory=True,
    )

    # Create and run the engine
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    events = list(engine.run())

    # Check for successful completion
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    # Check for streaming events
    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    stream_chunk_count = len(stream_chunk_events)

    assert stream_chunk_count == 1, f"Expected 1 streaming events, but got {stream_chunk_count}"
    assert stream_chunk_events[0].chunk == "hello, dify!", (
        f"Expected chunk to be 'hello, dify!', but got {stream_chunk_events[0].chunk}"
    )
