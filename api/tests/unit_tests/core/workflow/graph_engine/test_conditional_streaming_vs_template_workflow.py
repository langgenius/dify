"""
Test for streaming output workflow behavior.

This test validates that:
- When blocking == 1: No NodeRunStreamChunkEvent (flow through Template node)
- When blocking != 1: NodeRunStreamChunkEvent present (direct LLM to End output)
"""

from core.workflow.enums import NodeType
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from .test_table_runner import TableTestRunner


def test_streaming_output_with_blocking_equals_one():
    """
    Test workflow when blocking == 1 (LLM → Template → End).

    Template node doesn't produce streaming output, so no NodeRunStreamChunkEvent should be present.
    This test should FAIL according to requirements.
    """
    runner = TableTestRunner()

    # Load the workflow configuration
    fixture_data = runner.workflow_runner.load_fixture("conditional_streaming_vs_template_workflow")

    # Create graph from fixture with auto-mock enabled
    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        inputs={"query": "Hello, how are you?", "blocking": 1},
        use_mock_factory=True,
    )

    # Create and run the engine
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
    )

    # Execute the workflow
    events = list(engine.run())

    # Check for successful completion
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    # Check for streaming events
    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    stream_chunk_count = len(stream_chunk_events)

    # According to requirements, we expect exactly 3 streaming events from the End node
    # 1. User query
    # 2. Newline
    # 3. Template output (which contains the LLM response)
    assert stream_chunk_count == 3, f"Expected 3 streaming events when blocking=1, but got {stream_chunk_count}"

    first_chunk, second_chunk, third_chunk = stream_chunk_events[0], stream_chunk_events[1], stream_chunk_events[2]
    assert first_chunk.chunk == "Hello, how are you?", (
        f"Expected first chunk to be user input, but got {first_chunk.chunk}"
    )
    assert second_chunk.chunk == "\n", f"Expected second chunk to be newline, but got {second_chunk.chunk}"
    # Third chunk will be the template output with the mock LLM response
    assert isinstance(third_chunk.chunk, str), f"Expected third chunk to be string, but got {type(third_chunk.chunk)}"

    # Find indices of first LLM success event and first stream chunk event
    llm2_start_index = next(
        (i for i, e in enumerate(events) if isinstance(e, NodeRunSucceededEvent) and e.node_type == NodeType.LLM),
        -1,
    )
    first_chunk_index = next(
        (i for i, e in enumerate(events) if isinstance(e, NodeRunStreamChunkEvent)),
        -1,
    )

    assert first_chunk_index < llm2_start_index, (
        f"Expected first chunk before LLM2 start, but got {first_chunk_index} and {llm2_start_index}"
    )

    # Check that NodeRunStreamChunkEvent contains 'query' should has same id with Start NodeRunStartedEvent
    start_node_id = graph.root_node.id
    start_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_id == start_node_id]
    assert len(start_events) == 1, f"Expected 1 start event for node {start_node_id}, but got {len(start_events)}"
    start_event = start_events[0]
    query_chunk_events = [e for e in stream_chunk_events if e.chunk == "Hello, how are you?"]
    assert all(e.id == start_event.id for e in query_chunk_events), "Expected all query chunk events to have same id"

    # Check all Template's NodeRunStreamChunkEvent should has same id with Template's NodeRunStartedEvent
    start_events = [
        e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_type == NodeType.TEMPLATE_TRANSFORM
    ]
    template_chunk_events = [e for e in stream_chunk_events if e.node_type == NodeType.TEMPLATE_TRANSFORM]
    assert len(template_chunk_events) == 1, f"Expected 1 template chunk event, but got {len(template_chunk_events)}"
    assert all(e.id in [se.id for se in start_events] for e in template_chunk_events), (
        "Expected all Template chunk events to have same id with Template's NodeRunStartedEvent"
    )

    # Check that NodeRunStreamChunkEvent contains '\n' is from the End node
    end_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_type == NodeType.END]
    assert len(end_events) == 1, f"Expected 1 end event, but got {len(end_events)}"
    newline_chunk_events = [e for e in stream_chunk_events if e.chunk == "\n"]
    assert len(newline_chunk_events) == 1, f"Expected 1 newline chunk event, but got {len(newline_chunk_events)}"
    # The newline chunk should be from the End node (check node_id, not execution id)
    assert all(e.node_id == end_events[0].node_id for e in newline_chunk_events), (
        "Expected all newline chunk events to be from End node"
    )


def test_streaming_output_with_blocking_not_equals_one():
    """
    Test workflow when blocking != 1 (LLM → End directly).

    End node should produce streaming output with NodeRunStreamChunkEvent.
    This test should PASS according to requirements.
    """
    runner = TableTestRunner()

    # Load the workflow configuration
    fixture_data = runner.workflow_runner.load_fixture("conditional_streaming_vs_template_workflow")

    # Create graph from fixture with auto-mock enabled
    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        inputs={"query": "Hello, how are you?", "blocking": 2},
        use_mock_factory=True,
    )

    # Create and run the engine
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
    )

    # Execute the workflow
    events = list(engine.run())

    # Check for successful completion
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    # Check for streaming events - expecting streaming events
    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    stream_chunk_count = len(stream_chunk_events)

    # This assertion should PASS according to requirements
    assert stream_chunk_count > 0, f"Expected streaming events when blocking!=1, but got {stream_chunk_count}"

    # We should have at least 2 chunks (query and newline)
    assert stream_chunk_count >= 2, f"Expected at least 2 streaming events, but got {stream_chunk_count}"

    first_chunk, second_chunk = stream_chunk_events[0], stream_chunk_events[1]
    assert first_chunk.chunk == "Hello, how are you?", (
        f"Expected first chunk to be user input, but got {first_chunk.chunk}"
    )
    assert second_chunk.chunk == "\n", f"Expected second chunk to be newline, but got {second_chunk.chunk}"

    # Find indices of first LLM success event and first stream chunk event
    llm2_start_index = next(
        (i for i, e in enumerate(events) if isinstance(e, NodeRunSucceededEvent) and e.node_type == NodeType.LLM),
        -1,
    )
    first_chunk_index = next(
        (i for i, e in enumerate(events) if isinstance(e, NodeRunStreamChunkEvent)),
        -1,
    )

    assert first_chunk_index < llm2_start_index, (
        f"Expected first chunk before LLM2 start, but got {first_chunk_index} and {llm2_start_index}"
    )

    # With auto-mock, the LLM will produce mock responses - just verify we have streaming chunks
    # and they are strings
    for chunk_event in stream_chunk_events[2:]:
        assert isinstance(chunk_event.chunk, str), f"Expected chunk to be string, but got {type(chunk_event.chunk)}"

    # Check that NodeRunStreamChunkEvent contains 'query' should has same id with Start NodeRunStartedEvent
    start_node_id = graph.root_node.id
    start_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_id == start_node_id]
    assert len(start_events) == 1, f"Expected 1 start event for node {start_node_id}, but got {len(start_events)}"
    start_event = start_events[0]
    query_chunk_events = [e for e in stream_chunk_events if e.chunk == "Hello, how are you?"]
    assert all(e.id == start_event.id for e in query_chunk_events), "Expected all query chunk events to have same id"

    # Check all LLM's NodeRunStreamChunkEvent should be from LLM nodes
    start_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_type == NodeType.LLM]
    llm_chunk_events = [e for e in stream_chunk_events if e.node_type == NodeType.LLM]
    llm_node_ids = {se.node_id for se in start_events}
    assert all(e.node_id in llm_node_ids for e in llm_chunk_events), (
        "Expected all LLM chunk events to be from LLM nodes"
    )

    # Check that NodeRunStreamChunkEvent contains '\n' is from the End node
    end_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_type == NodeType.END]
    assert len(end_events) == 1, f"Expected 1 end event, but got {len(end_events)}"
    newline_chunk_events = [e for e in stream_chunk_events if e.chunk == "\n"]
    assert len(newline_chunk_events) == 1, f"Expected 1 newline chunk event, but got {len(newline_chunk_events)}"
    # The newline chunk should be from the End node (check node_id, not execution id)
    assert all(e.node_id == end_events[0].node_id for e in newline_chunk_events), (
        "Expected all newline chunk events to be from End node"
    )
