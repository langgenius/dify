"""Unit tests for skip propagator."""

from unittest.mock import MagicMock, create_autospec

from core.workflow.graph import Edge, Graph
from core.workflow.graph_engine.graph_state_manager import GraphStateManager
from core.workflow.graph_engine.graph_traversal.skip_propagator import SkipPropagator


class TestSkipPropagator:
    """Test suite for SkipPropagator."""

    def test_propagate_skip_from_edge_with_unknown_edges_stops_processing(self) -> None:
        """When there are unknown incoming edges, propagation should stop."""
        # Arrange
        mock_graph = create_autospec(Graph)
        mock_state_manager = create_autospec(GraphStateManager)

        # Create a mock edge
        mock_edge = MagicMock(spec=Edge)
        mock_edge.id = "edge_1"
        mock_edge.head = "node_2"

        # Setup graph edges dict
        mock_graph.edges = {"edge_1": mock_edge}

        # Setup incoming edges
        incoming_edges = [MagicMock(spec=Edge), MagicMock(spec=Edge)]
        mock_graph.get_incoming_edges.return_value = incoming_edges

        # Setup state manager to return has_unknown=True
        mock_state_manager.analyze_edge_states.return_value = {
            "has_unknown": True,
            "has_taken": False,
            "all_skipped": False,
        }

        propagator = SkipPropagator(mock_graph, mock_state_manager)

        # Act
        propagator.propagate_skip_from_edge("edge_1")

        # Assert
        mock_graph.get_incoming_edges.assert_called_once_with("node_2")
        mock_state_manager.analyze_edge_states.assert_called_once_with(incoming_edges)
        # Should not call any other state manager methods
        mock_state_manager.enqueue_node.assert_not_called()
        mock_state_manager.start_execution.assert_not_called()
        mock_state_manager.mark_node_skipped.assert_not_called()

    def test_propagate_skip_from_edge_with_taken_edge_enqueues_node(self) -> None:
        """When there is at least one taken edge, node should be enqueued."""
        # Arrange
        mock_graph = create_autospec(Graph)
        mock_state_manager = create_autospec(GraphStateManager)

        # Create a mock edge
        mock_edge = MagicMock(spec=Edge)
        mock_edge.id = "edge_1"
        mock_edge.head = "node_2"

        mock_graph.edges = {"edge_1": mock_edge}
        incoming_edges = [MagicMock(spec=Edge)]
        mock_graph.get_incoming_edges.return_value = incoming_edges

        # Setup state manager to return has_taken=True
        mock_state_manager.analyze_edge_states.return_value = {
            "has_unknown": False,
            "has_taken": True,
            "all_skipped": False,
        }

        propagator = SkipPropagator(mock_graph, mock_state_manager)

        # Act
        propagator.propagate_skip_from_edge("edge_1")

        # Assert
        mock_state_manager.enqueue_node.assert_called_once_with("node_2")
        mock_state_manager.start_execution.assert_called_once_with("node_2")
        mock_state_manager.mark_node_skipped.assert_not_called()

    def test_propagate_skip_from_edge_with_all_skipped_propagates_to_node(self) -> None:
        """When all incoming edges are skipped, should propagate skip to node."""
        # Arrange
        mock_graph = create_autospec(Graph)
        mock_state_manager = create_autospec(GraphStateManager)

        # Create a mock edge
        mock_edge = MagicMock(spec=Edge)
        mock_edge.id = "edge_1"
        mock_edge.head = "node_2"

        mock_graph.edges = {"edge_1": mock_edge}
        incoming_edges = [MagicMock(spec=Edge)]
        mock_graph.get_incoming_edges.return_value = incoming_edges

        # Setup state manager to return all_skipped=True
        mock_state_manager.analyze_edge_states.return_value = {
            "has_unknown": False,
            "has_taken": False,
            "all_skipped": True,
        }

        propagator = SkipPropagator(mock_graph, mock_state_manager)

        # Act
        propagator.propagate_skip_from_edge("edge_1")

        # Assert
        mock_state_manager.mark_node_skipped.assert_called_once_with("node_2")
        mock_state_manager.enqueue_node.assert_not_called()
        mock_state_manager.start_execution.assert_not_called()

    def test_propagate_skip_to_node_marks_node_and_outgoing_edges_skipped(self) -> None:
        """_propagate_skip_to_node should mark node and all outgoing edges as skipped."""
        # Arrange
        mock_graph = create_autospec(Graph)
        mock_state_manager = create_autospec(GraphStateManager)

        # Create outgoing edges
        edge1 = MagicMock(spec=Edge)
        edge1.id = "edge_2"
        edge1.head = "node_downstream_1"  # Set head for propagate_skip_from_edge

        edge2 = MagicMock(spec=Edge)
        edge2.id = "edge_3"
        edge2.head = "node_downstream_2"

        # Setup graph edges dict for propagate_skip_from_edge
        mock_graph.edges = {"edge_2": edge1, "edge_3": edge2}
        mock_graph.get_outgoing_edges.return_value = [edge1, edge2]

        # Setup get_incoming_edges to return empty list to stop recursion
        mock_graph.get_incoming_edges.return_value = []

        propagator = SkipPropagator(mock_graph, mock_state_manager)

        # Use mock to call private method
        # Act
        propagator._propagate_skip_to_node("node_1")

        # Assert
        mock_state_manager.mark_node_skipped.assert_called_once_with("node_1")
        mock_state_manager.mark_edge_skipped.assert_any_call("edge_2")
        mock_state_manager.mark_edge_skipped.assert_any_call("edge_3")
        assert mock_state_manager.mark_edge_skipped.call_count == 2
        # Should recursively propagate from each edge
        # Since propagate_skip_from_edge is called, we need to verify it was called
        # But we can't directly verify due to recursion. We'll trust the logic.

    def test_skip_branch_paths_marks_unselected_edges_and_propagates(self) -> None:
        """skip_branch_paths should mark all unselected edges as skipped and propagate."""
        # Arrange
        mock_graph = create_autospec(Graph)
        mock_state_manager = create_autospec(GraphStateManager)

        # Create unselected edges
        edge1 = MagicMock(spec=Edge)
        edge1.id = "edge_1"
        edge1.head = "node_downstream_1"

        edge2 = MagicMock(spec=Edge)
        edge2.id = "edge_2"
        edge2.head = "node_downstream_2"

        unselected_edges = [edge1, edge2]

        # Setup graph edges dict
        mock_graph.edges = {"edge_1": edge1, "edge_2": edge2}
        # Setup get_incoming_edges to return empty list to stop recursion
        mock_graph.get_incoming_edges.return_value = []

        propagator = SkipPropagator(mock_graph, mock_state_manager)

        # Act
        propagator.skip_branch_paths(unselected_edges)

        # Assert
        mock_state_manager.mark_edge_skipped.assert_any_call("edge_1")
        mock_state_manager.mark_edge_skipped.assert_any_call("edge_2")
        assert mock_state_manager.mark_edge_skipped.call_count == 2
        # propagate_skip_from_edge should be called for each edge
        # We can't directly verify due to the mock, but the logic is covered

    def test_propagate_skip_from_edge_recursively_propagates_through_graph(self) -> None:
        """Skip propagation should recursively propagate through the graph."""
        # Arrange
        mock_graph = create_autospec(Graph)
        mock_state_manager = create_autospec(GraphStateManager)

        # Create edge chain: edge_1 -> node_2 -> edge_3 -> node_4
        edge1 = MagicMock(spec=Edge)
        edge1.id = "edge_1"
        edge1.head = "node_2"

        edge3 = MagicMock(spec=Edge)
        edge3.id = "edge_3"
        edge3.head = "node_4"

        mock_graph.edges = {"edge_1": edge1, "edge_3": edge3}

        # Setup get_incoming_edges to return different values based on node
        def get_incoming_edges_side_effect(node_id):
            if node_id == "node_2":
                return [edge1]
            elif node_id == "node_4":
                return [edge3]
            return []

        mock_graph.get_incoming_edges.side_effect = get_incoming_edges_side_effect

        # Setup get_outgoing_edges to return different values based on node
        def get_outgoing_edges_side_effect(node_id):
            if node_id == "node_2":
                return [edge3]
            elif node_id == "node_4":
                return []  # No outgoing edges, stops recursion
            return []

        mock_graph.get_outgoing_edges.side_effect = get_outgoing_edges_side_effect

        # Setup state manager to return all_skipped for both nodes
        mock_state_manager.analyze_edge_states.return_value = {
            "has_unknown": False,
            "has_taken": False,
            "all_skipped": True,
        }

        propagator = SkipPropagator(mock_graph, mock_state_manager)

        # Act
        propagator.propagate_skip_from_edge("edge_1")

        # Assert
        # Should mark node_2 as skipped
        mock_state_manager.mark_node_skipped.assert_any_call("node_2")
        # Should mark edge_3 as skipped
        mock_state_manager.mark_edge_skipped.assert_any_call("edge_3")
        # Should propagate to node_4
        mock_state_manager.mark_node_skipped.assert_any_call("node_4")
        assert mock_state_manager.mark_node_skipped.call_count == 2

    def test_propagate_skip_from_edge_with_mixed_edge_states_handles_correctly(self) -> None:
        """Test with mixed edge states (some unknown, some taken, some skipped)."""
        # Arrange
        mock_graph = create_autospec(Graph)
        mock_state_manager = create_autospec(GraphStateManager)

        mock_edge = MagicMock(spec=Edge)
        mock_edge.id = "edge_1"
        mock_edge.head = "node_2"

        mock_graph.edges = {"edge_1": mock_edge}
        incoming_edges = [MagicMock(spec=Edge), MagicMock(spec=Edge), MagicMock(spec=Edge)]
        mock_graph.get_incoming_edges.return_value = incoming_edges

        # Test 1: has_unknown=True, has_taken=False, all_skipped=False
        mock_state_manager.analyze_edge_states.return_value = {
            "has_unknown": True,
            "has_taken": False,
            "all_skipped": False,
        }

        propagator = SkipPropagator(mock_graph, mock_state_manager)

        # Act
        propagator.propagate_skip_from_edge("edge_1")

        # Assert - should stop processing
        mock_state_manager.enqueue_node.assert_not_called()
        mock_state_manager.mark_node_skipped.assert_not_called()

        # Reset mocks for next test
        mock_state_manager.reset_mock()
        mock_graph.reset_mock()

        # Test 2: has_unknown=False, has_taken=True, all_skipped=False
        mock_state_manager.analyze_edge_states.return_value = {
            "has_unknown": False,
            "has_taken": True,
            "all_skipped": False,
        }

        # Act
        propagator.propagate_skip_from_edge("edge_1")

        # Assert - should enqueue node
        mock_state_manager.enqueue_node.assert_called_once_with("node_2")
        mock_state_manager.start_execution.assert_called_once_with("node_2")

        # Reset mocks for next test
        mock_state_manager.reset_mock()
        mock_graph.reset_mock()

        # Test 3: has_unknown=False, has_taken=False, all_skipped=True
        mock_state_manager.analyze_edge_states.return_value = {
            "has_unknown": False,
            "has_taken": False,
            "all_skipped": True,
        }

        # Act
        propagator.propagate_skip_from_edge("edge_1")

        # Assert - should propagate skip
        mock_state_manager.mark_node_skipped.assert_called_once_with("node_2")
