"""
Test suite for Phase 1 MVP: Queue-Based Graph Engine

Following TDD principles, these tests define the expected behavior
of the new queue-based architecture before implementation.

Phase 1 MVP Scope:
- ✅ Plain nodes (existing: core.workflow.graph.node.Node)
- ✅ Response nodes (AnswerNode, EndNode)
- ❌ Container nodes (deferred to Phase 3)
- ❌ SubgraphExpander (deferred to Phase 3)
"""

import time
from threading import Thread
from typing import Any
from unittest.mock import Mock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphRuntimeState, VariablePool
from core.workflow.events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph import Graph, Node
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom
from models.workflow import WorkflowType


class MockNodeFactory:
    """Mock NodeFactory for testing purposes."""

    def create_node(self, node_config: dict[str, Any]) -> Node:
        """Create a mock node from config."""
        from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
        from core.workflow.events import NodeRunResult, RunCompletedEvent

        node_id = node_config.get("id", "mock_node")
        node_data = node_config.get("data", {})
        node_type = NodeType(node_data.get("type", "mock"))

        def mock_run():
            """Mock run method that yields a completion event."""
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs={},
                    process_data={},
                    outputs={f"{node_id}_output": f"result_from_{node_id}"},
                    metadata={},
                )
            )

        # Create a mock node with required attributes
        mock_node = Mock(spec=Node)
        mock_node.id = node_id
        mock_node.type_ = node_type
        mock_node._run = mock_run
        mock_node.run = mock_run  # Worker calls run() method

        return mock_node


class TestQueueBasedGraphEngine:
    """Test the new queue-based GraphEngine MVP implementation."""

    def test_engine_initialization(self):
        """Test that QueueBasedGraphEngine initializes correctly."""
        # This test will fail until we implement QueueBasedGraphEngine
        from core.workflow.graph_engine.queue_engine import QueueBasedGraphEngine

        graph_config = self._create_simple_graph_config()
        graph = Graph.init(graph_config=graph_config, node_factory=MockNodeFactory())
        variable_pool = VariablePool(
            system_variables=SystemVariable(user_id="test", app_id="1", workflow_id="1", files=[]),
            user_inputs={"input": "test"},
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        engine = QueueBasedGraphEngine(
            tenant_id="111",
            app_id="222",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="333",
            graph_config=graph_config,
            user_id="444",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.WEB_APP,
            call_depth=0,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=500,
            max_execution_time=1200,
        )

        # Engine should have the required components
        assert hasattr(engine, "ready_queue")
        assert hasattr(engine, "event_queue")
        assert hasattr(engine, "workers")
        assert hasattr(engine, "dispatcher_thread")
        assert hasattr(engine, "state_lock")
        assert hasattr(engine, "output_registry")
        assert hasattr(engine, "response_coordinator")

        # Should have 10 workers
        assert len(engine.workers) == 10

        # Workers should be Thread instances
        for worker in engine.workers:
            assert isinstance(worker, Thread)

    def test_simple_node_execution(self):
        """Test execution of a simple linear workflow with plain nodes."""
        from core.workflow.graph_engine.queue_engine import QueueBasedGraphEngine

        graph_config = self._create_simple_graph_config()
        graph = Graph.init(graph_config=graph_config, node_factory=MockNodeFactory())
        variable_pool = VariablePool(
            system_variables=SystemVariable(user_id="test", app_id="1", workflow_id="1", files=[]),
            user_inputs={"input": "test"},
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        engine = QueueBasedGraphEngine(
            tenant_id="111",
            app_id="222",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="333",
            graph_config=graph_config,
            user_id="444",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.WEB_APP,
            call_depth=0,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=500,
            max_execution_time=1200,
        )

        # Execute the engine
        events = list(engine.run())

        # Should produce expected events
        assert len(events) > 0
        assert isinstance(events[0], GraphRunStartedEvent)
        assert isinstance(events[-1], GraphRunSucceededEvent)

        # Should contain node execution events
        node_events = [e for e in events if isinstance(e, (NodeRunStartedEvent, NodeRunSucceededEvent))]
        assert len(node_events) > 0

    def test_parallel_execution(self):
        """Test parallel execution of nodes with branching."""
        from core.workflow.graph_engine.queue_engine import QueueBasedGraphEngine

        graph_config = self._create_parallel_graph_config()
        graph = Graph.init(graph_config=graph_config, node_factory=MockNodeFactory())
        variable_pool = VariablePool(
            system_variables=SystemVariable(user_id="test", app_id="1", workflow_id="1", files=[]),
            user_inputs={"input": "test"},
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        engine = QueueBasedGraphEngine(
            tenant_id="111",
            app_id="222",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="333",
            graph_config=graph_config,
            user_id="444",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.WEB_APP,
            call_depth=0,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=500,
            max_execution_time=1200,
        )

        events = list(engine.run())

        # Should handle parallel execution correctly
        assert len(events) > 0
        assert isinstance(events[0], GraphRunStartedEvent)
        assert isinstance(events[-1], GraphRunSucceededEvent)

        # Should execute nodes from parallel branches (node1 and node2)
        node_events = [e for e in events if isinstance(e, (NodeRunStartedEvent, NodeRunSucceededEvent))]
        executed_nodes = {e.node_id for e in node_events if hasattr(e, "node_id")}
        assert "node1" in executed_nodes
        assert "node2" in executed_nodes

    def test_response_node_streaming(self):
        """Test that response nodes (Answer/End) work with ResponseStreamCoordinator."""
        from core.workflow.graph_engine.queue_engine import QueueBasedGraphEngine

        graph_config = self._create_response_graph_config()
        graph = Graph.init(graph_config=graph_config, node_factory=MockNodeFactory())
        variable_pool = VariablePool(
            system_variables=SystemVariable(user_id="test", app_id="1", workflow_id="1", files=[]),
            user_inputs={"input": "test"},
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        engine = QueueBasedGraphEngine(
            tenant_id="111",
            app_id="222",
            workflow_type=WorkflowType.CHAT,  # ChatFlow for Answer nodes
            workflow_id="333",
            graph_config=graph_config,
            user_id="444",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.WEB_APP,
            call_depth=0,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=500,
            max_execution_time=1200,
        )

        events = list(engine.run())

        # Should handle response nodes correctly
        assert len(events) > 0
        assert isinstance(events[0], GraphRunStartedEvent)
        assert isinstance(events[-1], GraphRunSucceededEvent)

    def test_error_handling_abort_strategy(self):
        """Test basic error handling with ABORT strategy."""
        from core.workflow.graph_engine.queue_engine import QueueBasedGraphEngine

        # Create a failing node factory
        class FailingNodeFactory:
            def create_node(self, node_config: dict[str, Any]) -> Node:
                node_id = node_config.get("id", "mock_node")
                node_data = node_config.get("data", {})
                node_type = node_data.get("type", "mock")

                def failing_run():
                    """Mock run method that raises an exception."""
                    raise RuntimeError(f"Node {node_id} failed intentionally")

                mock_node = Mock(spec=Node)
                mock_node.id = node_id
                mock_node.node_type = node_type
                mock_node._run = failing_run
                mock_node.run = failing_run  # Worker calls run() method

                # Set proper type_ property that returns NodeType enum
                from core.workflow.enums import NodeType

                if node_type == "start":
                    mock_node.type_ = NodeType.START
                elif node_type == "end":
                    mock_node.type_ = NodeType.END
                elif node_type == "answer":
                    mock_node.type_ = NodeType.ANSWER
                else:
                    mock_node.type_ = NodeType.CODE

                return mock_node

        graph_config = self._create_simple_graph_config()
        graph = Graph.init(graph_config=graph_config, node_factory=FailingNodeFactory())
        variable_pool = VariablePool(
            system_variables=SystemVariable(user_id="test", app_id="1", workflow_id="1", files=[]),
            user_inputs={"input": "test"},
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        engine = QueueBasedGraphEngine(
            tenant_id="111",
            app_id="222",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="333",
            graph_config=graph_config,
            user_id="444",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.WEB_APP,
            call_depth=0,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=500,
            max_execution_time=1200,
        )

        # Should handle errors gracefully - for now we expect a GraphRunFailedEvent
        # rather than an exception since our current implementation catches and converts errors
        events = list(engine.run())

        # Should contain a failure event
        from core.workflow.events import GraphRunFailedEvent, NodeRunFailedEvent

        failure_events = [e for e in events if isinstance(e, (GraphRunFailedEvent, NodeRunFailedEvent))]
        assert len(failure_events) > 0

    def test_thread_safety(self):
        """Test that OutputRegistry and other components are thread-safe."""
        from core.workflow.graph_engine.output_registry import OutputRegistry

        registry = OutputRegistry()

        # This test should pass with the existing v2/test_output_registry.py implementation
        import threading

        results = []

        def append_chunks(thread_id: int):
            for i in range(10):
                registry.append_chunk(["stream"], f"thread{thread_id}_chunk{i}")

        # Start multiple threads
        threads = []
        for i in range(3):
            thread = threading.Thread(target=append_chunks, args=(i,))
            threads.append(thread)
            thread.start()

        # Wait for threads
        for thread in threads:
            thread.join()

        # Verify all chunks are present
        chunks = []
        while True:
            chunk = registry.pop_chunk(["stream"])
            if chunk is None:
                break
            chunks.append(chunk)

        assert len(chunks) == 30  # 3 threads * 10 chunks each

    def test_backward_compatibility(self):
        """Test that the new engine maintains backward compatibility with existing API."""
        from core.workflow.graph_engine.queue_engine import QueueBasedGraphEngine

        # Should have the same constructor signature as the old GraphEngine
        graph_config = self._create_simple_graph_config()
        graph = Graph.init(graph_config=graph_config, node_factory=MockNodeFactory())
        variable_pool = VariablePool(
            system_variables=SystemVariable(user_id="test", app_id="1", workflow_id="1", files=[]),
            user_inputs={"input": "test"},
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        # This should work exactly like the old GraphEngine constructor
        engine = QueueBasedGraphEngine(
            tenant_id="111",
            app_id="222",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="333",
            graph_config=graph_config,
            user_id="444",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.WEB_APP,
            call_depth=0,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=500,
            max_execution_time=1200,
        )

        # Should have the same run() method that returns a generator
        generator = engine.run()
        assert generator is not None

        # Generator should produce events compatible with existing event system
        events = list(generator)
        assert isinstance(events[0], GraphRunStartedEvent)

    # Helper methods for creating test graph configurations

    def _create_simple_graph_config(self) -> dict[str, Any]:
        """Create a simple linear graph configuration for testing."""
        return {
            "edges": [{"id": "1", "source": "start", "target": "end"}],
            "nodes": [
                {"data": {"type": "start", "title": "start"}, "id": "start"},
                {"data": {"type": "end", "title": "end"}, "id": "end"},
            ],
        }

    def _create_parallel_graph_config(self) -> dict[str, Any]:
        """Create a parallel branching graph configuration for testing."""
        return {
            "edges": [
                {"id": "1", "source": "start", "target": "node1"},
                {"id": "2", "source": "start", "target": "node2"},
                {"id": "3", "source": "node1", "target": "end1"},
                {"id": "4", "source": "node2", "target": "end2"},
            ],
            "nodes": [
                {"data": {"type": "start", "title": "start"}, "id": "start"},
                {"data": {"type": "code", "title": "node1"}, "id": "node1"},
                {"data": {"type": "code", "title": "node2"}, "id": "node2"},
                {"data": {"type": "end", "title": "end1"}, "id": "end1"},
                {"data": {"type": "end", "title": "end2"}, "id": "end2"},
            ],
        }

    def _create_response_graph_config(self) -> dict[str, Any]:
        """Create a graph with response nodes (Answer) for testing."""
        return {
            "edges": [{"id": "1", "source": "start", "target": "answer"}],
            "nodes": [
                {"data": {"type": "start", "title": "start"}, "id": "start"},
                {"data": {"type": "answer", "title": "answer", "answer": "Hello"}, "id": "answer"},
            ],
        }


class TestOutputRegistry:
    """Test the OutputRegistry component separately."""

    def test_output_registry_basic_operations(self):
        """Test basic OutputRegistry operations work correctly."""
        # The implementation should exist or the v2 test imports should work
        from core.workflow.graph_engine.output_registry import OutputRegistry

        registry = OutputRegistry()

        # Test scalar operations
        registry.set_scalar(["node1", "output"], "test_value")
        assert registry.get_scalar(["node1", "output"]) == "test_value"

        # Test stream operations
        registry.append_chunk(["node1", "stream"], "chunk1")
        registry.append_chunk(["node1", "stream"], "chunk2")

        assert registry.has_unread(["node1", "stream"]) is True
        assert registry.pop_chunk(["node1", "stream"]) == "chunk1"
        assert registry.pop_chunk(["node1", "stream"]) == "chunk2"


class TestResponseStreamCoordinator:
    """Test the ResponseStreamCoordinator component separately."""

    def test_response_coordinator_basic_operations(self):
        """Test basic ResponseStreamCoordinator operations."""
        from core.workflow.graph_engine.response_coordinator import ResponseStreamCoordinator

        coordinator = ResponseStreamCoordinator()

        # Test registration
        coordinator.register("answer_node_1")

        # Test dependency management
        # (Implementation details to be defined based on spec)
        assert hasattr(coordinator, "register")
        assert hasattr(coordinator, "on_edge_update")
        assert hasattr(coordinator, "start_session")


class TestWorker:
    """Test the Worker thread component separately."""

    def test_worker_initialization(self):
        """Test Worker thread initializes correctly."""
        from core.workflow.graph_engine.worker import Worker

        # Worker should be a Thread subclass
        worker = Worker(ready_queue=Mock(), event_queue=Mock(), graph=Mock(), output_registry=Mock())
        assert isinstance(worker, Thread)
        assert hasattr(worker, "run")
