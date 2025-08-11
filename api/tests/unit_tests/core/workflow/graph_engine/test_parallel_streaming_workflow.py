"""
Test for parallel streaming workflow behavior.

This test validates that:
- LLM 1 always speaks English
- LLM 2 always speaks Chinese
- 2 LLMs run parallel, but LLM 2 will output before LLM 1
- All chunks should be sent before Answer Node started
"""

import time
from unittest.mock import patch
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.events import (
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.node_events import NodeRunResult, StreamCompletedEvent
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom

from .test_graph_engine import TableTestRunner


def create_llm_generator_with_delay(chunks: list[str], delay: float = 0.1):
    """Create a generator that simulates LLM streaming output with delay"""

    def llm_generator(self):
        for i, chunk in enumerate(chunks):
            time.sleep(delay)  # Simulate network delay
            yield NodeRunStreamChunkEvent(
                id=str(uuid4()),
                node_id=self.node_id,
                node_type=self.node_type,
                selector=[self.node_id, "text"],
                chunk=chunk,
                is_final=i == len(chunks) - 1,
                # Legacy fields for compatibility
                chunk_content=chunk,
                from_variable_selector=[self.node_id, "text"],
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


def test_parallel_streaming_workflow():
    """
    Test parallel streaming workflow to verify:
    1. All chunks from LLM 2 are output before LLM 1
    2. At least one chunk from LLM 2 is output before LLM 1 completes (Success)
    3. At least one chunk from LLM 1 is output before LLM 2 completes (EXPECTED TO FAIL)
    4. All chunks are output before End begins
    5. The final output content matches the order defined in the Answer

    Test setup:
    - LLM 1 outputs English (slower)
    - LLM 2 outputs Chinese (faster)
    - Both run in parallel

    This test is expected to FAIL because chunks are currently buffered
    until after node completion instead of streaming during execution.
    """
    runner = TableTestRunner()

    # Load the workflow configuration
    fixture_data = runner.workflow_runner.load_fixture("test_parallel_streaming")
    workflow_config = fixture_data.get("workflow", {})
    graph_config = workflow_config.get("graph", {})

    # Create graph initialization parameters
    init_params = GraphInitParams(
        tenant_id="test_tenant",
        app_id="test_app",
        workflow_id="test_workflow",
        graph_config=graph_config,
        user_id="test_user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
    )

    # Create variable pool with system variables
    system_variables = SystemVariable(
        user_id=init_params.user_id,
        app_id=init_params.app_id,
        workflow_id=init_params.workflow_id,
        files=[],
        query="Tell me about yourself",  # User query
    )
    variable_pool = VariablePool(
        system_variables=system_variables,
        user_inputs={},
    )

    # Create graph runtime state
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory and graph
    node_factory = DifyNodeFactory(graph_init_params=init_params, graph_runtime_state=graph_runtime_state)
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    # Create the graph engine
    engine = GraphEngine(
        tenant_id="test_tenant",
        app_id="test_app",
        workflow_id="test_workflow",
        user_id="test_user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        graph=graph,
        graph_config=graph_config,
        graph_runtime_state=graph_runtime_state,
        max_execution_steps=500,
        max_execution_time=30,
    )

    # Define LLM outputs
    llm1_chunks = ["Hello", ", ", "I", " ", "am", " ", "an", " ", "AI", " ", "assistant", "."]  # English (slower)
    llm2_chunks = ["你好", "，", "我", "是", "AI", "助手", "。"]  # Chinese (faster)

    # Create generators with different delays (LLM 2 is faster)
    llm1_generator = create_llm_generator_with_delay(llm1_chunks, delay=0.05)  # Slower
    llm2_generator = create_llm_generator_with_delay(llm2_chunks, delay=0.01)  # Faster

    # Track which LLM node is being called
    llm_call_order = []
    generators = {
        "1754339718571": llm1_generator,  # LLM 1 node ID
        "1754339725656": llm2_generator,  # LLM 2 node ID
    }

    def mock_llm_run(self):
        llm_call_order.append(self.node_id)
        generator = generators.get(self.node_id)
        if generator:
            yield from generator(self)
        else:
            raise Exception(f"Unexpected LLM node ID: {self.node_id}")

    # Execute with mocked LLMs
    with patch.object(LLMNode, "_run", new=mock_llm_run):
        events = list(engine.run())

    # Check for successful completion
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    # Get all streaming chunk events
    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]

    # Get Answer node start event
    answer_start_events = [e for e in events if isinstance(e, NodeRunStartedEvent) and e.node_type == NodeType.ANSWER]
    assert len(answer_start_events) == 1, f"Expected 1 Answer node start event, got {len(answer_start_events)}"
    answer_start_event = answer_start_events[0]

    # Find the index of Answer node start
    answer_start_index = events.index(answer_start_event)

    # Collect chunk events by node
    llm1_chunks_events = [e for e in stream_chunk_events if e.node_id == "1754339718571"]
    llm2_chunks_events = [e for e in stream_chunk_events if e.node_id == "1754339725656"]

    # Verify both LLMs produced chunks
    assert len(llm1_chunks_events) == len(llm1_chunks), (
        f"Expected {len(llm1_chunks)} chunks from LLM 1, got {len(llm1_chunks_events)}"
    )
    assert len(llm2_chunks_events) == len(llm2_chunks), (
        f"Expected {len(llm2_chunks)} chunks from LLM 2, got {len(llm2_chunks_events)}"
    )

    # 1. Verify all chunks from LLM 2 are output before LLM 1
    llm1_chunk_indices = [events.index(e) for e in llm1_chunks_events]
    llm2_chunk_indices = [events.index(e) for e in llm2_chunks_events]

    if llm1_chunk_indices and llm2_chunk_indices:
        assert max(llm2_chunk_indices) < min(llm1_chunk_indices), (
            f"All LLM 2 chunks should be output before LLM 1 chunks. "
            f"LLM 2 chunk indices: {llm2_chunk_indices}, LLM 1 chunk indices: {llm1_chunk_indices}"
        )

    # Get indices of all chunk events
    chunk_indices = [events.index(e) for e in stream_chunk_events if e in llm1_chunks_events + llm2_chunks_events]

    # 4. Verify all chunks were sent before Answer node started
    assert all(idx < answer_start_index for idx in chunk_indices), (
        "All LLM chunks should be sent before Answer node starts"
    )

    # The test has successfully verified:
    # 1. Both LLMs run in parallel (they start at the same time)
    # 2. LLM 2 (Chinese) outputs all its chunks before LLM 1 (English) due to faster processing
    # 3. All LLM chunks are sent before the Answer node starts

    # Get LLM completion events
    llm_completed_events = [
        (i, e) for i, e in enumerate(events) if isinstance(e, NodeRunSucceededEvent) and e.node_type == NodeType.LLM
    ]

    # LLM 2 should complete before LLM 1
    assert len(llm_completed_events) == 2, f"Expected 2 LLM completion events, got {len(llm_completed_events)}"
    llm2_complete_idx = next(i for i, e in llm_completed_events if e.node_id == "1754339725656")
    llm1_complete_idx = next(i for i, e in llm_completed_events if e.node_id == "1754339718571")
    assert llm2_complete_idx < llm1_complete_idx, (
        f"LLM 2 should complete before LLM 1, but LLM 2 completed at {llm2_complete_idx} "
        f"and LLM 1 completed at {llm1_complete_idx}"
    )

    # 2. Verify at least one chunk from LLM 2 is output before LLM 1 completes
    if llm2_chunk_indices:
        assert min(llm2_chunk_indices) < llm1_complete_idx, (
            f"At least one chunk from LLM 2 should be output before LLM 1 completes. "
            f"First LLM 2 chunk at index {min(llm2_chunk_indices)}, LLM 1 completed at index {llm1_complete_idx}"
        )

    # 3. Verify at least one chunk from LLM 1 is output before LLM 2 completes
    if llm1_chunk_indices:
        assert min(llm1_chunk_indices) < llm2_complete_idx, (
            f"At least one chunk from LLM 1 should be output before LLM 2 completes. "
            f"First LLM 1 chunk at index {min(llm1_chunk_indices)}, LLM 2 completed at index {llm2_complete_idx}. "
            f"This test is expected to FAIL because chunks are currently buffered until node completion."
        )

    # EXPECTED BEHAVIOR: Chunks should stream during LLM execution, not after completion
    # The first chunk should appear BEFORE both LLMs' SuccessEvents
    assert stream_chunk_events, "Expected streaming events, but got none"

    first_chunk_index = events.index(stream_chunk_events[0])
    llm_success_indices = [i for i, e in llm_completed_events]

    # This test will FAIL with current implementation
    # Current behavior: first chunk at 10, LLM SuccessEvents at [7, 9]
    # Expected behavior: chunks should stream before node completion
    assert all(first_chunk_index < idx for idx in llm_success_indices), (
        f"EXPECTED: First chunk should appear BEFORE all LLM SuccessEvents (streaming during execution). "
        f"ACTUAL: First chunk at index {first_chunk_index}, LLM SuccessEvents at indices {llm_success_indices}. "
        f"This indicates chunks are buffered until after node completion instead of streaming."
    )

    # 5. Verify final output content matches the order defined in Answer node
    # According to Answer node configuration: '{{#1754339725656.text#}}{{#1754339718571.text#}}'
    # This means LLM 2 output should come first, then LLM 1 output
    answer_complete_events = [
        e for e in events if isinstance(e, NodeRunSucceededEvent) and e.node_type == NodeType.ANSWER
    ]
    assert len(answer_complete_events) == 1, f"Expected 1 Answer completion event, got {len(answer_complete_events)}"

    answer_outputs = answer_complete_events[0].node_run_result.outputs
    expected_answer_text = "你好，我是AI助手。Hello, I am an AI assistant."

    if "answer" in answer_outputs:
        actual_answer_text = answer_outputs["answer"]
        assert actual_answer_text == expected_answer_text, (
            f"Answer content should match the order defined in Answer node. "
            f"Expected: '{expected_answer_text}', Got: '{actual_answer_text}'"
        )
