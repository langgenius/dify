"""
Test for streaming output workflow behavior.

This test validates that:
- When blocking == 1: No NodeRunStreamChunkEvent (flow through Template node)
- When blocking != 1: NodeRunStreamChunkEvent present (direct LLM to End output)
"""

import time
from unittest.mock import patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import NodeRunResult, StreamCompletedEvent
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom

from .test_table_runner import TableTestRunner


def create_llm_generator_with_streaming(chunks: list[str], engine: GraphEngine):
    """Create a generator that simulates LLM streaming output"""

    def llm_generator(self):
        # Use a deterministic execution ID for testing
        # The actual execution ID will be set by the Worker when it creates the NodeRunStartedEvent
        # For streaming events from the node itself, we should use a consistent ID
        execution_id = f"llm-exec-{self.id}"

        for i, chunk in enumerate(chunks):
            yield NodeRunStreamChunkEvent(
                id=execution_id,
                node_id=self.id,
                node_type=self.node_type,
                selector=[self.id, "text"],
                chunk=chunk,
                is_final=i == len(chunks) - 1,
                # Legacy fields for compatibility
                chunk_content=chunk,
                from_variable_selector=[self.id, "text"],
            )

        # Complete response
        full_text = "".join(chunks)
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"text": full_text},
            )
        )

    return llm_generator


def create_test_graph_engine(graph_config: dict, user_inputs: dict | None = None):
    """Helper method to create a graph engine instance for testing"""
    # Create graph initialization parameters
    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable(
            user_id="test_user",
            files=[],
        ),
        user_inputs=user_inputs or {},
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(init_params, graph_runtime_state)
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    return GraphEngine(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        graph=graph,
        graph_config=graph_config,
        graph_runtime_state=graph_runtime_state,
        max_execution_steps=500,
        max_execution_time=30,
        command_channel=InMemoryChannel(),
    )


def test_streaming_output_with_blocking_equals_one():
    """
    Test workflow when blocking == 1 (LLM → Template → End).

    Template node doesn't produce streaming output, so no NodeRunStreamChunkEvent should be present.
    This test should FAIL according to requirements.
    """
    runner = TableTestRunner()

    # Load the workflow configuration
    fixture_data = runner.workflow_runner.load_fixture("conditional_streaming_vs_template_workflow")
    graph_config = fixture_data.get("workflow", {}).get("graph", {})

    # Create engine with blocking=1
    user_inputs = {"query": "Hello, how are you?", "blocking": 1}
    engine = create_test_graph_engine(graph_config, user_inputs)

    # Simulate streaming chunks
    chunks = ["Hello", ", ", "this", " ", "is", " ", "streaming", " ", "response"]
    # Mock the LLM node to return streaming output
    llm_generator = create_llm_generator_with_streaming(chunks, engine)

    # Execute with mocked LLM
    with patch.object(LLMNode, "_run", new=llm_generator):
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
    assert first_chunk.chunk == user_inputs["query"], (
        f"Expected first chunk to be user input, but got {first_chunk.chunk}"
    )
    assert second_chunk.chunk == "\n", f"Expected second chunk to be newline, but got {second_chunk.chunk}"
    assert third_chunk.chunk == "".join(chunks), f"Expected third chunk to be LLM response, but got {third_chunk.chunk}"

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
    start_node_id = engine.graph.root_node.id
    start_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_id == start_node_id]
    assert len(start_events) == 1, f"Expected 1 start event for node {start_node_id}, but got {len(start_events)}"
    start_event = start_events[0]
    query_chunk_events = [e for e in stream_chunk_events if e.chunk == user_inputs["query"]]
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
    graph_config = fixture_data.get("workflow", {}).get("graph", {})

    # Create engine with blocking=2
    user_inputs = {"query": "Hello, how are you?", "blocking": 2}
    engine = create_test_graph_engine(graph_config, user_inputs)

    # Simulate streaming chunks
    chunks = ["Hello", ", ", "this", " ", "is", " ", "streaming", " ", "response"]
    # Mock the LLM node to return streaming output
    llm_generator = create_llm_generator_with_streaming(chunks, engine)

    # Execute with mocked LLM
    with patch.object(LLMNode, "_run", new=llm_generator):
        events = list(engine.run())

    # Check for successful completion
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    # Check for streaming events - expecting streaming events
    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    stream_chunk_count = len(stream_chunk_events)

    first_chunk, second_chunk = stream_chunk_events[0], stream_chunk_events[1]

    # This assertion should PASS according to requirements
    assert stream_chunk_count > 0, f"Expected streaming events when blocking!=1, but got {stream_chunk_count}"
    assert first_chunk.chunk == user_inputs["query"], (
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

    for get, expect in zip(stream_chunk_events[2:], chunks):
        assert get.chunk == expect, f"Expected chunk {get.chunk} to be {expect}"

    # Check that NodeRunStreamChunkEvent contains 'query' should has same id with Start NodeRunStartedEvent
    start_node_id = engine.graph.root_node.id
    start_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_id == start_node_id]
    assert len(start_events) == 1, f"Expected 1 start event for node {start_node_id}, but got {len(start_events)}"
    start_event = start_events[0]
    query_chunk_events = [e for e in stream_chunk_events if e.chunk == user_inputs["query"]]
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
