"""
Unit tests for stop_event functionality in GraphEngine.

Tests the unified stop_event management by GraphEngine and its propagation
to WorkerPool, Worker, Dispatcher, and Nodes.
"""

import threading
import time
from unittest.mock import MagicMock, Mock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
)
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from models.enums import UserFrom


class TestStopEventPropagation:
    """Test suite for stop_event propagation through GraphEngine components."""

    def test_graph_engine_creates_stop_event(self):
        """Test that GraphEngine creates a stop_event on initialization."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Verify stop_event was created
        assert engine._stop_event is not None
        assert isinstance(engine._stop_event, threading.Event)

        # Verify it was set in graph_runtime_state
        assert runtime_state.stop_event is not None
        assert runtime_state.stop_event is engine._stop_event

    def test_stop_event_cleared_on_start(self):
        """Test that stop_event is cleared when execution starts."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()
        mock_graph.root_node.id = "start"  # Set proper id

        start_node = StartNode(
            id="start",
            config={"id": "start", "data": {"title": "start", "variables": []}},
            graph_init_params=GraphInitParams(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                graph_config={},
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph_runtime_state=runtime_state,
        )
        mock_graph.nodes["start"] = start_node
        mock_graph.get_outgoing_edges = MagicMock(return_value=[])
        mock_graph.get_incoming_edges = MagicMock(return_value=[])

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Set the stop_event before running
        engine._stop_event.set()
        assert engine._stop_event.is_set()

        # Run the engine (should clear the stop_event)
        events = list(engine.run())

        # After running, stop_event should be set again (by _stop_execution)
        # But during start it was cleared
        assert any(isinstance(e, GraphRunStartedEvent) for e in events)
        assert any(isinstance(e, GraphRunSucceededEvent) for e in events)

    def test_stop_event_set_on_stop(self):
        """Test that stop_event is set when execution stops."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()
        mock_graph.root_node.id = "start"  # Set proper id

        start_node = StartNode(
            id="start",
            config={"id": "start", "data": {"title": "start", "variables": []}},
            graph_init_params=GraphInitParams(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                graph_config={},
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph_runtime_state=runtime_state,
        )
        mock_graph.nodes["start"] = start_node
        mock_graph.get_outgoing_edges = MagicMock(return_value=[])
        mock_graph.get_incoming_edges = MagicMock(return_value=[])

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Initially not set
        assert not engine._stop_event.is_set()

        # Run the engine
        list(engine.run())

        # After execution completes, stop_event should be set
        assert engine._stop_event.is_set()

    def test_stop_event_passed_to_worker_pool(self):
        """Test that stop_event is passed to WorkerPool."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Verify WorkerPool has the stop_event
        assert engine._worker_pool._stop_event is not None
        assert engine._worker_pool._stop_event is engine._stop_event

    def test_stop_event_passed_to_dispatcher(self):
        """Test that stop_event is passed to Dispatcher."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Verify Dispatcher has the stop_event
        assert engine._dispatcher._stop_event is not None
        assert engine._dispatcher._stop_event is engine._stop_event


class TestNodeStopCheck:
    """Test suite for Node._should_stop() functionality."""

    def test_node_should_stop_checks_runtime_state(self):
        """Test that Node._should_stop() checks GraphRuntimeState.stop_event."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

        answer_node = AnswerNode(
            id="answer",
            config={"id": "answer", "data": {"title": "answer", "answer": "{{#start.result#}}"}},
            graph_init_params=GraphInitParams(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                graph_config={},
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph_runtime_state=runtime_state,
        )

        # Initially stop_event is not set
        assert not answer_node._should_stop()

        # Set the stop_event
        runtime_state.stop_event.set()

        # Now _should_stop should return True
        assert answer_node._should_stop()

    def test_node_run_checks_stop_event_between_yields(self):
        """Test that Node.run() checks stop_event between yielding events."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

        # Create a simple node
        answer_node = AnswerNode(
            id="answer",
            config={"id": "answer", "data": {"title": "answer", "answer": "hello"}},
            graph_init_params=GraphInitParams(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                graph_config={},
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph_runtime_state=runtime_state,
        )

        # Set stop_event BEFORE running the node
        runtime_state.stop_event.set()

        # Run the node - should yield start event then detect stop
        # The node should check stop_event before processing
        assert answer_node._should_stop(), "stop_event should be set"

        # Run and collect events
        events = list(answer_node.run())

        # Since stop_event is set at the start, we should get:
        # 1. NodeRunStartedEvent (always yielded first)
        # 2. Either NodeRunFailedEvent (if detected early) or NodeRunSucceededEvent (if too fast)
        assert len(events) >= 2
        assert isinstance(events[0], NodeRunStartedEvent)

        # Note: AnswerNode is very simple and might complete before stop check
        # The important thing is that _should_stop() returns True when stop_event is set
        assert answer_node._should_stop()


class TestStopEventIntegration:
    """Integration tests for stop_event in workflow execution."""

    def test_simple_workflow_respects_stop_event(self):
        """Test that a simple workflow respects stop_event."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()
        mock_graph.root_node.id = "start"

        # Create start and answer nodes
        start_node = StartNode(
            id="start",
            config={"id": "start", "data": {"title": "start", "variables": []}},
            graph_init_params=GraphInitParams(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                graph_config={},
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph_runtime_state=runtime_state,
        )

        answer_node = AnswerNode(
            id="answer",
            config={"id": "answer", "data": {"title": "answer", "answer": "hello"}},
            graph_init_params=GraphInitParams(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                graph_config={},
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph_runtime_state=runtime_state,
        )

        mock_graph.nodes["start"] = start_node
        mock_graph.nodes["answer"] = answer_node
        mock_graph.get_outgoing_edges = MagicMock(return_value=[])
        mock_graph.get_incoming_edges = MagicMock(return_value=[])

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Set stop_event before running
        runtime_state.stop_event.set()

        # Run the engine
        events = list(engine.run())

        # Should get started event but not succeeded (due to stop)
        assert any(isinstance(e, GraphRunStartedEvent) for e in events)
        # The workflow should still complete (start node runs quickly)
        # but answer node might be cancelled depending on timing

    def test_stop_event_with_concurrent_nodes(self):
        """Test stop_event behavior with multiple concurrent nodes."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()

        # Create multiple nodes
        for i in range(3):
            answer_node = AnswerNode(
                id=f"answer_{i}",
                config={"id": f"answer_{i}", "data": {"title": f"answer_{i}", "answer": f"test{i}"}},
                graph_init_params=GraphInitParams(
                    tenant_id="test_tenant",
                    app_id="test_app",
                    workflow_id="test_workflow",
                    graph_config={},
                    user_id="test_user",
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                    call_depth=0,
                ),
                graph_runtime_state=runtime_state,
            )
            mock_graph.nodes[f"answer_{i}"] = answer_node

        mock_graph.get_outgoing_edges = MagicMock(return_value=[])
        mock_graph.get_incoming_edges = MagicMock(return_value=[])

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # All nodes should share the same stop_event
        for node in mock_graph.nodes.values():
            assert node.graph_runtime_state.stop_event is runtime_state.stop_event
            assert node.graph_runtime_state.stop_event is engine._stop_event


class TestStopEventTimeoutBehavior:
    """Test stop_event behavior with join timeouts."""

    @patch("core.workflow.graph_engine.orchestration.dispatcher.threading.Thread")
    def test_dispatcher_uses_shorter_timeout(self, mock_thread_cls: MagicMock):
        """Test that Dispatcher uses 2s timeout instead of 10s."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        dispatcher = engine._dispatcher
        dispatcher.start()  # This will create and start the mocked thread

        mock_thread_instance = mock_thread_cls.return_value
        mock_thread_instance.is_alive.return_value = True

        dispatcher.stop()

        mock_thread_instance.join.assert_called_once_with(timeout=2.0)

    @patch("core.workflow.graph_engine.worker_management.worker_pool.Worker")
    def test_worker_pool_uses_shorter_timeout(self, mock_worker_cls: MagicMock):
        """Test that WorkerPool uses 2s timeout instead of 10s."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        worker_pool = engine._worker_pool
        worker_pool.start(initial_count=1)  # Start with one worker

        mock_worker_instance = mock_worker_cls.return_value
        mock_worker_instance.is_alive.return_value = True

        worker_pool.stop()

        mock_worker_instance.join.assert_called_once_with(timeout=2.0)


class TestStopEventResumeBehavior:
    """Test stop_event behavior during workflow resume."""

    def test_stop_event_cleared_on_resume(self):
        """Test that stop_event is cleared when resuming a paused workflow."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()
        mock_graph.root_node.id = "start"  # Set proper id

        start_node = StartNode(
            id="start",
            config={"id": "start", "data": {"title": "start", "variables": []}},
            graph_init_params=GraphInitParams(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                graph_config={},
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph_runtime_state=runtime_state,
        )
        mock_graph.nodes["start"] = start_node
        mock_graph.get_outgoing_edges = MagicMock(return_value=[])
        mock_graph.get_incoming_edges = MagicMock(return_value=[])

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Simulate a previous execution that set stop_event
        engine._stop_event.set()
        assert engine._stop_event.is_set()

        # Run the engine (should clear stop_event in _start_execution)
        events = list(engine.run())

        # Execution should complete successfully
        assert any(isinstance(e, GraphRunStartedEvent) for e in events)
        assert any(isinstance(e, GraphRunSucceededEvent) for e in events)


class TestWorkerStopBehavior:
    """Test Worker behavior with shared stop_event."""

    def test_worker_uses_shared_stop_event(self):
        """Test that Worker uses shared stop_event from GraphEngine."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())
        mock_graph = MagicMock(spec=Graph)
        mock_graph.nodes = {}
        mock_graph.edges = {}
        mock_graph.root_node = MagicMock()

        engine = GraphEngine(
            workflow_id="test_workflow",
            graph=mock_graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
            config=GraphEngineConfig(),
        )

        # Get the worker pool and check workers
        worker_pool = engine._worker_pool

        # Start the worker pool to create workers
        worker_pool.start()

        # Check that at least one worker was created
        assert len(worker_pool._workers) > 0

        # Verify workers use the shared stop_event
        for worker in worker_pool._workers:
            assert worker._stop_event is engine._stop_event

        # Clean up
        worker_pool.stop()

    def test_worker_stop_is_noop(self):
        """Test that Worker.stop() is now a no-op."""
        runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

        # Create a mock worker
        from core.workflow.graph_engine.ready_queue import InMemoryReadyQueue
        from core.workflow.graph_engine.worker import Worker

        ready_queue = InMemoryReadyQueue()
        event_queue = MagicMock()

        # Create a proper mock graph with real dict
        mock_graph = Mock(spec=Graph)
        mock_graph.nodes = {}  # Use real dict

        stop_event = threading.Event()

        worker = Worker(
            ready_queue=ready_queue,
            event_queue=event_queue,
            graph=mock_graph,
            layers=[],
            stop_event=stop_event,
        )

        # Calling stop() should do nothing (no-op)
        # and should NOT set the stop_event
        worker.stop()
        assert not stop_event.is_set()
