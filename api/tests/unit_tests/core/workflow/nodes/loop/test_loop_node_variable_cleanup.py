"""
Unit tests for LoopNode._cleanup_sub_graph_variables_from_previous_iteration method.

This module tests the cleanup functionality that removes sub-graph node variables
from the variable pool between loop iterations to prevent output duplication.
"""

from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams
from core.workflow.nodes.loop.loop_node import LoopNode
from core.workflow.runtime import GraphRuntimeState
from core.workflow.runtime.variable_pool import VariablePool
from models.enums import UserFrom


class TestLoopNodeVariableCleanup:
    """Test cases for LoopNode sub-graph variable cleanup functionality."""

    @pytest.fixture
    def variable_pool(self):
        """Create a VariablePool for testing."""
        pool = VariablePool()
        # Add some test variables
        pool.add(["llm_node", "text"], "Output from LLM")
        pool.add(["answer_node", "answer"], "Final answer")
        pool.add(["code_node", "code"], "print('hello')")
        pool.add(["loop_node_123", "counter"], 5)  # Loop node's own variable
        pool.add(["other_node", "result"], "some result")
        return pool

    @pytest.fixture
    def graph_runtime_state(self, variable_pool):
        """Create a GraphRuntimeState with the variable pool."""
        state = Mock(spec=GraphRuntimeState)
        state.variable_pool = variable_pool
        return state

    @pytest.fixture
    def graph_config(self):
        """Create a graph config with loop sub-graph nodes."""
        return {
            "nodes": [
                {"id": "llm_node", "data": {"type": "llm", "loop_id": "loop_node_123", "title": "LLM Node"}},
                {"id": "answer_node", "data": {"type": "answer", "loop_id": "loop_node_123", "title": "Answer Node"}},
                {"id": "code_node", "data": {"type": "code", "loop_id": "loop_node_123", "title": "Code Node"}},
                {"id": "loop_node_123", "data": {"type": "loop", "title": "Loop Node"}},
                {"id": "other_node", "data": {"type": "tool", "title": "Other Node (not in loop)"}},
            ]
        }

    @pytest.fixture
    def loop_node(self, graph_runtime_state, graph_config):
        """Create a LoopNode instance for testing."""
        # Create mock init params with actual enum values
        init_params = Mock(spec=GraphInitParams)
        init_params.graph_config = graph_config
        init_params.tenant_id = "tenant_123"
        init_params.app_id = "app_456"
        init_params.workflow_id = "workflow_789"
        init_params.user_id = "user_001"
        init_params.user_from = UserFrom.ACCOUNT
        init_params.invoke_from = InvokeFrom.SERVICE_API
        init_params.call_depth = 0

        # Create LoopNode instance
        node = LoopNode(
            id="loop_node_123",
            config={
                "id": "loop_node_123",
                "data": {
                    "title": "Test Loop",
                    "loop_count": 3,
                    "start_node_id": "llm_node",
                    "break_conditions": [],
                    "logical_operator": "and",
                    "type": "loop",
                },
            },
            graph_init_params=init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Manually set graph_config since it's set in __init__
        node.graph_config = graph_config

        return node

    def test_cleanup_removes_sub_graph_variables(self, loop_node, variable_pool):
        """
        Test that cleanup removes variables from nodes belonging to the loop.

        This test verifies that:
        1. Variables from llm_node, answer_node, and code_node are removed
        2. Variables from other_node (not in loop) are preserved
        3. Loop node's own variables are preserved
        """
        # Setup: Ensure variables exist
        assert variable_pool.get(["llm_node", "text"]) is not None
        assert variable_pool.get(["answer_node", "answer"]) is not None
        assert variable_pool.get(["code_node", "code"]) is not None
        assert variable_pool.get(["loop_node_123", "counter"]) is not None
        assert variable_pool.get(["other_node", "result"]) is not None

        # Execute: Call cleanup method
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: Sub-graph variables are removed
        assert variable_pool.get(["llm_node", "text"]) is None, "llm_node variable should be removed"
        assert variable_pool.get(["answer_node", "answer"]) is None, "answer_node variable should be removed"
        assert variable_pool.get(["code_node", "code"]) is None, "code_node variable should be removed"

        # Assert: Non-sub-graph variables are preserved
        assert variable_pool.get(["loop_node_123", "counter"]) is not None, (
            "loop node's own variable should be preserved"
        )
        assert variable_pool.get(["other_node", "result"]) is not None, (
            "variable from node not in loop should be preserved"
        )

    def test_cleanup_with_empty_graph_config(self, loop_node, variable_pool):
        """
        Test that cleanup handles empty graph_config gracefully.

        When graph_config is None or empty, the method should not fail.
        """
        # Setup: Set graph_config to None
        loop_node.graph_config = None

        # Execute: Should not raise any exception
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: No variables were removed (method returns early)
        assert variable_pool.get(["llm_node", "text"]) is not None

    def test_cleanup_with_empty_nodes_list(self, loop_node, variable_pool):
        """
        Test that cleanup handles empty nodes list in graph_config.
        """
        # Setup: Set nodes to empty list
        loop_node.graph_config = {"nodes": []}

        # Execute: Should not raise any exception
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: No variables were removed
        assert variable_pool.get(["llm_node", "text"]) is not None

    def test_cleanup_handles_missing_loop_id(self, loop_node, variable_pool):
        """
        Test that cleanup ignores nodes without loop_id in their data.

        Nodes that don't have a loop_id or have a different loop_id should
        not be affected by the cleanup.
        """
        # Setup: Add a node with different loop_id
        variable_pool.add(["another_loop_node", "output"], "data")

        # Execute
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: Only nodes with matching loop_id are cleaned up
        assert variable_pool.get(["another_loop_node", "output"]) is not None, (
            "node with different loop_id should not be cleaned"
        )
        assert variable_pool.get(["llm_node", "text"]) is None, "node with matching loop_id should be cleaned"

    def test_cleanup_handles_missing_node_id(self, loop_node, variable_pool):
        """
        Test that cleanup handles nodes missing 'id' field.

        Graph config entries without 'id' should be safely skipped.
        """
        # Setup: Add a node config without id
        loop_node.graph_config["nodes"].append(
            {"data": {"type": "llm", "loop_id": "loop_node_123", "title": "Node without ID"}}
        )

        # Execute: Should not raise any exception
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: Normal cleanup still works
        assert variable_pool.get(["llm_node", "text"]) is None

    def test_cleanup_handles_missing_data_field(self, loop_node, variable_pool):
        """
        Test that cleanup handles nodes missing 'data' field.
        """
        # Setup: Add a node config without data
        loop_node.graph_config["nodes"].append({"id": "node_without_data", "title": "Node without data"})

        # Execute: Should not raise any exception
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: Normal cleanup still works
        assert variable_pool.get(["llm_node", "text"]) is None

    def test_cleanup_does_not_remove_loop_node_own_variables(self, loop_node, variable_pool):
        """
        Test that cleanup never removes the loop node's own variables.

        The loop node itself (identified by self._node_id) should have its
        variables preserved even if it appears in the sub-graph node list.
        """
        # Setup: Add multiple loop node variables
        variable_pool.add(["loop_node_123", "iteration"], 1)
        variable_pool.add(["loop_node_123", "total"], 3)

        # Execute
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: Loop node variables are preserved
        assert variable_pool.get(["loop_node_123", "counter"]) is not None
        assert variable_pool.get(["loop_node_123", "iteration"]) is not None
        assert variable_pool.get(["loop_node_123", "total"]) is not None

    def test_cleanup_with_multiple_sub_graph_nodes(self, loop_node, variable_pool):
        """
        Test cleanup with many sub-graph nodes.

        Verifies that cleanup correctly handles a loop with multiple nodes
        from different types.
        """
        # Setup: Add more sub-graph node variables
        variable_pool.add(["http_node", "response"], '{"status": "ok"}')
        variable_pool.add(["template_transform_node", "output"], "transformed")
        # Update graph config to include these nodes
        loop_node.graph_config["nodes"].extend(
            [
                {"id": "http_node", "data": {"type": "http", "loop_id": "loop_node_123"}},
                {"id": "template_transform_node", "data": {"type": "template-transform", "loop_id": "loop_node_123"}},
            ]
        )

        # Execute
        loop_node._cleanup_sub_graph_variables_from_previous_iteration()

        # Assert: All sub-graph variables are removed
        assert variable_pool.get(["llm_node", "text"]) is None
        assert variable_pool.get(["answer_node", "answer"]) is None
        assert variable_pool.get(["code_node", "code"]) is None
        assert variable_pool.get(["http_node", "response"]) is None
        assert variable_pool.get(["template_transform_node", "output"]) is None

        # Assert: Non-sub-graph variables are preserved
        assert variable_pool.get(["loop_node_123", "counter"]) is not None
        assert variable_pool.get(["other_node", "result"]) is not None
