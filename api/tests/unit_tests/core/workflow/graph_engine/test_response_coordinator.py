"""Test cases for ResponseStreamCoordinator."""

from unittest.mock import Mock

from core.variables import StringSegment
from core.workflow.enums import NodeState, NodeType
from core.workflow.graph import Graph
from core.workflow.graph_engine.output_registry import OutputRegistry
from core.workflow.graph_engine.response_coordinator import ResponseSession, ResponseStreamCoordinator
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template, TextSegment, VariableSegment


class TestResponseStreamCoordinator:
    """Test cases for ResponseStreamCoordinator."""

    def test_skip_variable_segment_from_skipped_node(self):
        """Test that VariableSegments from skipped nodes are properly skipped during try_flush."""
        # Create mock graph
        graph = Mock(spec=Graph)

        # Create mock nodes
        skipped_node = Mock(spec=Node)
        skipped_node.id = "skipped_node"
        skipped_node.state = NodeState.SKIPPED
        skipped_node.node_type = NodeType.LLM

        active_node = Mock(spec=Node)
        active_node.id = "active_node"
        active_node.state = NodeState.TAKEN
        active_node.node_type = NodeType.LLM

        response_node = Mock(spec=AnswerNode)
        response_node.id = "response_node"
        response_node.node_type = NodeType.ANSWER

        # Set up graph nodes dictionary
        graph.nodes = {"skipped_node": skipped_node, "active_node": active_node, "response_node": response_node}

        # Create output registry
        registry = OutputRegistry()

        # Add some test data to registry for the active node
        registry.set_scalar(("active_node", "output"), StringSegment(value="Active output"))

        # Create RSC instance
        rsc = ResponseStreamCoordinator(registry=registry, graph=graph)

        # Create template with segments from both skipped and active nodes
        template = Template(
            segments=[
                VariableSegment(selector=["skipped_node", "output"]),
                TextSegment(text=" - "),
                VariableSegment(selector=["active_node", "output"]),
            ]
        )

        # Create and set active session
        session = ResponseSession(node_id="response_node", template=template, index=0)
        rsc.active_session = session

        # Execute try_flush
        events = rsc.try_flush()

        # Verify that:
        # 1. The skipped node's variable segment was skipped (index advanced)
        # 2. The text segment was processed
        # 3. The active node's variable segment was processed
        assert len(events) == 2  # TextSegment + VariableSegment from active_node

        # Check that the first event is the text segment
        assert events[0].chunk == " - "

        # Check that the second event is from the active node
        assert events[1].chunk == "Active output"
        assert events[1].selector == ["active_node", "output"]

        # Session should be complete
        assert session.is_complete()

    def test_process_variable_segment_from_non_skipped_node(self):
        """Test that VariableSegments from non-skipped nodes are processed normally."""
        # Create mock graph
        graph = Mock(spec=Graph)

        # Create mock nodes
        active_node1 = Mock(spec=Node)
        active_node1.id = "node1"
        active_node1.state = NodeState.TAKEN
        active_node1.node_type = NodeType.LLM

        active_node2 = Mock(spec=Node)
        active_node2.id = "node2"
        active_node2.state = NodeState.TAKEN
        active_node2.node_type = NodeType.LLM

        response_node = Mock(spec=AnswerNode)
        response_node.id = "response_node"
        response_node.node_type = NodeType.ANSWER

        # Set up graph nodes dictionary
        graph.nodes = {"node1": active_node1, "node2": active_node2, "response_node": response_node}

        # Create output registry
        registry = OutputRegistry()

        # Add test data to registry
        registry.set_scalar(("node1", "output"), StringSegment(value="Output 1"))
        registry.set_scalar(("node2", "output"), StringSegment(value="Output 2"))

        # Create RSC instance
        rsc = ResponseStreamCoordinator(registry=registry, graph=graph)

        # Create template with segments from active nodes
        template = Template(
            segments=[
                VariableSegment(selector=["node1", "output"]),
                TextSegment(text=" | "),
                VariableSegment(selector=["node2", "output"]),
            ]
        )

        # Create and set active session
        session = ResponseSession(node_id="response_node", template=template, index=0)
        rsc.active_session = session

        # Execute try_flush
        events = rsc.try_flush()

        # Verify all segments were processed
        assert len(events) == 3

        # Check events in order
        assert events[0].chunk == "Output 1"
        assert events[0].selector == ["node1", "output"]

        assert events[1].chunk == " | "

        assert events[2].chunk == "Output 2"
        assert events[2].selector == ["node2", "output"]

        # Session should be complete
        assert session.is_complete()

    def test_mixed_skipped_and_active_nodes(self):
        """Test processing with a mix of skipped and active nodes."""
        # Create mock graph
        graph = Mock(spec=Graph)

        # Create mock nodes with various states
        skipped_node1 = Mock(spec=Node)
        skipped_node1.id = "skip1"
        skipped_node1.state = NodeState.SKIPPED
        skipped_node1.node_type = NodeType.LLM

        active_node = Mock(spec=Node)
        active_node.id = "active"
        active_node.state = NodeState.TAKEN
        active_node.node_type = NodeType.LLM

        skipped_node2 = Mock(spec=Node)
        skipped_node2.id = "skip2"
        skipped_node2.state = NodeState.SKIPPED
        skipped_node2.node_type = NodeType.LLM

        response_node = Mock(spec=AnswerNode)
        response_node.id = "response_node"
        response_node.node_type = NodeType.ANSWER

        # Set up graph nodes dictionary
        graph.nodes = {
            "skip1": skipped_node1,
            "active": active_node,
            "skip2": skipped_node2,
            "response_node": response_node,
        }

        # Create output registry
        registry = OutputRegistry()

        # Add data only for active node
        registry.set_scalar(("active", "result"), StringSegment(value="Active Result"))

        # Create RSC instance
        rsc = ResponseStreamCoordinator(registry=registry, graph=graph)

        # Create template with mixed segments
        template = Template(
            segments=[
                TextSegment(text="Start: "),
                VariableSegment(selector=["skip1", "output"]),
                VariableSegment(selector=["active", "result"]),
                VariableSegment(selector=["skip2", "output"]),
                TextSegment(text=" :End"),
            ]
        )

        # Create and set active session
        session = ResponseSession(node_id="response_node", template=template, index=0)
        rsc.active_session = session

        # Execute try_flush
        events = rsc.try_flush()

        # Should have: "Start: ", "Active Result", " :End"
        assert len(events) == 3

        assert events[0].chunk == "Start: "
        assert events[1].chunk == "Active Result"
        assert events[1].selector == ["active", "result"]
        assert events[2].chunk == " :End"

        # Session should be complete
        assert session.is_complete()

    def test_all_variable_segments_skipped(self):
        """Test when all VariableSegments are from skipped nodes."""
        # Create mock graph
        graph = Mock(spec=Graph)

        # Create all skipped nodes
        skipped_node1 = Mock(spec=Node)
        skipped_node1.id = "skip1"
        skipped_node1.state = NodeState.SKIPPED
        skipped_node1.node_type = NodeType.LLM

        skipped_node2 = Mock(spec=Node)
        skipped_node2.id = "skip2"
        skipped_node2.state = NodeState.SKIPPED
        skipped_node2.node_type = NodeType.LLM

        response_node = Mock(spec=AnswerNode)
        response_node.id = "response_node"
        response_node.node_type = NodeType.ANSWER

        # Set up graph nodes dictionary
        graph.nodes = {"skip1": skipped_node1, "skip2": skipped_node2, "response_node": response_node}

        # Create output registry (empty since nodes are skipped)
        registry = OutputRegistry()

        # Create RSC instance
        rsc = ResponseStreamCoordinator(registry=registry, graph=graph)

        # Create template with only skipped segments
        template = Template(
            segments=[
                VariableSegment(selector=["skip1", "output"]),
                VariableSegment(selector=["skip2", "output"]),
                TextSegment(text="Final text"),
            ]
        )

        # Create and set active session
        session = ResponseSession(node_id="response_node", template=template, index=0)
        rsc.active_session = session

        # Execute try_flush
        events = rsc.try_flush()

        # Should only have the final text segment
        assert len(events) == 1
        assert events[0].chunk == "Final text"

        # Session should be complete
        assert session.is_complete()
