"""Tests for ResponseStreamCoordinator object field streaming."""

from unittest.mock import MagicMock

from core.workflow.enums import NodeType
from core.workflow.graph import Graph
from core.workflow.graph_engine.response_coordinator.coordinator import ResponseStreamCoordinator
from core.workflow.graph_events import ChunkType, NodeRunStreamChunkEvent
from core.workflow.nodes.base.entities import BaseNodeData
from core.workflow.runtime import VariablePool


class TestResponseCoordinatorObjectStreaming:
    """Test streaming of object-type variables with child fields."""

    def test_object_field_streaming(self):
        """Test that when selecting an object variable, all child field streams are forwarded."""
        # Create mock graph and variable pool
        graph = MagicMock(spec=Graph)
        variable_pool = MagicMock(spec=VariablePool)

        # Mock nodes
        llm_node = MagicMock()
        llm_node.id = "llm_node"
        llm_node.node_type = NodeType.LLM
        llm_node.execution_type = MagicMock()
        llm_node.blocks_variable_output = MagicMock(return_value=False)

        response_node = MagicMock()
        response_node.id = "response_node"
        response_node.node_type = NodeType.ANSWER
        response_node.execution_type = MagicMock()
        response_node.blocks_variable_output = MagicMock(return_value=False)

        # Mock template for response node
        response_node.node_data = MagicMock(spec=BaseNodeData)
        response_node.node_data.answer = "{{#llm_node.generation#}}"

        graph.nodes = {
            "llm_node": llm_node,
            "response_node": response_node,
        }
        graph.root_node = llm_node
        graph.get_outgoing_edges = MagicMock(return_value=[])

        # Create coordinator
        coordinator = ResponseStreamCoordinator(variable_pool, graph)

        # Track execution
        coordinator.track_node_execution("llm_node", "exec_123")
        coordinator.track_node_execution("response_node", "exec_456")

        # Simulate streaming events for child fields of generation object
        # 1. Content stream
        content_event_1 = NodeRunStreamChunkEvent(
            id="exec_123",
            node_id="llm_node",
            node_type=NodeType.LLM,
            selector=["llm_node", "generation", "content"],
            chunk="Hello",
            is_final=False,
            chunk_type=ChunkType.TEXT,
        )
        content_event_2 = NodeRunStreamChunkEvent(
            id="exec_123",
            node_id="llm_node",
            node_type=NodeType.LLM,
            selector=["llm_node", "generation", "content"],
            chunk=" world",
            is_final=True,
            chunk_type=ChunkType.TEXT,
        )

        # 2. Tool call stream
        tool_call_event = NodeRunStreamChunkEvent(
            id="exec_123",
            node_id="llm_node",
            node_type=NodeType.LLM,
            selector=["llm_node", "generation", "tool_calls"],
            chunk='{"query": "test"}',
            is_final=True,
            chunk_type=ChunkType.TOOL_CALL,
            tool_call_id="call_123",
            tool_name="search",
            tool_arguments='{"query": "test"}',
        )

        # 3. Tool result stream
        tool_result_event = NodeRunStreamChunkEvent(
            id="exec_123",
            node_id="llm_node",
            node_type=NodeType.LLM,
            selector=["llm_node", "generation", "tool_results"],
            chunk="Found 10 results",
            is_final=True,
            chunk_type=ChunkType.TOOL_RESULT,
            tool_call_id="call_123",
            tool_name="search",
            tool_files=[],
            tool_error=None,
        )

        # Intercept these events
        coordinator.intercept_event(content_event_1)
        coordinator.intercept_event(tool_call_event)
        coordinator.intercept_event(tool_result_event)
        coordinator.intercept_event(content_event_2)

        # Verify that all child streams are buffered
        assert ("llm_node", "generation", "content") in coordinator._stream_buffers
        assert ("llm_node", "generation", "tool_calls") in coordinator._stream_buffers
        assert ("llm_node", "generation", "tool_results") in coordinator._stream_buffers

        # Verify we can find child streams
        child_streams = coordinator._find_child_streams(["llm_node", "generation"])
        assert len(child_streams) == 3
        assert ("llm_node", "generation", "content") in child_streams
        assert ("llm_node", "generation", "tool_calls") in child_streams
        assert ("llm_node", "generation", "tool_results") in child_streams

    def test_find_child_streams(self):
        """Test the _find_child_streams method."""
        graph = MagicMock(spec=Graph)
        variable_pool = MagicMock(spec=VariablePool)

        coordinator = ResponseStreamCoordinator(variable_pool, graph)

        # Add some mock streams
        coordinator._stream_buffers = {
            ("node1", "generation", "content"): [],
            ("node1", "generation", "tool_calls"): [],
            ("node1", "generation", "thought"): [],
            ("node1", "text"): [],  # Not a child of generation
            ("node2", "generation", "content"): [],  # Different node
        }

        # Find children of node1.generation
        children = coordinator._find_child_streams(["node1", "generation"])

        assert len(children) == 3
        assert ("node1", "generation", "content") in children
        assert ("node1", "generation", "tool_calls") in children
        assert ("node1", "generation", "thought") in children
        assert ("node1", "text") not in children
        assert ("node2", "generation", "content") not in children

    def test_find_child_streams_with_closed_streams(self):
        """Test that _find_child_streams also considers closed streams."""
        graph = MagicMock(spec=Graph)
        variable_pool = MagicMock(spec=VariablePool)

        coordinator = ResponseStreamCoordinator(variable_pool, graph)

        # Add some streams - some buffered, some closed
        coordinator._stream_buffers = {
            ("node1", "generation", "content"): [],
        }
        coordinator._closed_streams = {
            ("node1", "generation", "tool_calls"),
            ("node1", "generation", "thought"),
        }

        # Should find all children regardless of whether they're in buffers or closed
        children = coordinator._find_child_streams(["node1", "generation"])

        assert len(children) == 3
        assert ("node1", "generation", "content") in children
        assert ("node1", "generation", "tool_calls") in children
        assert ("node1", "generation", "thought") in children
