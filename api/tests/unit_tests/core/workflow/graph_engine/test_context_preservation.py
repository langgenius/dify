"""
Test context preservation in GraphEngine workers.

This module tests that Flask app context and context variables are properly
preserved when executing nodes in worker threads.
"""

import contextvars
import queue
import threading
import time
from unittest.mock import MagicMock

from flask import Flask, g

from core.workflow.enums import NodeType
from core.workflow.graph import Graph
from core.workflow.graph_engine.worker import Worker
from core.workflow.graph_events import GraphNodeEventBase, NodeRunSucceededEvent
from core.workflow.nodes.base.node import Node
from libs.flask_utils import preserve_flask_contexts


class TestContextPreservation:
    """Test suite for context preservation in workers."""

    def test_preserve_flask_contexts_with_flask_app(self) -> None:
        """Test that Flask app context is preserved in worker context."""
        app = Flask(__name__)

        # Variable to check if context was available
        context_available = False

        def worker_task() -> None:
            nonlocal context_available
            with preserve_flask_contexts(flask_app=app, context_vars=contextvars.Context()):
                # Check if we're in app context
                from flask import has_app_context

                context_available = has_app_context()

        # Run worker task in thread
        thread = threading.Thread(target=worker_task)
        thread.start()
        thread.join()

        assert context_available, "Flask app context should be available in worker"

    def test_preserve_flask_contexts_with_context_vars(self) -> None:
        """Test that context variables are preserved in worker context."""
        app = Flask(__name__)

        # Create a context variable
        test_var: contextvars.ContextVar[str] = contextvars.ContextVar("test_var")
        test_var.set("test_value")

        # Capture context
        context = contextvars.copy_context()

        # Variable to store value from worker
        worker_value: str | None = None

        def worker_task() -> None:
            nonlocal worker_value
            with preserve_flask_contexts(flask_app=app, context_vars=context):
                # Try to get the context variable
                try:
                    worker_value = test_var.get()
                except LookupError:
                    worker_value = None

        # Run worker task in thread
        thread = threading.Thread(target=worker_task)
        thread.start()
        thread.join()

        assert worker_value == "test_value", "Context variable should be preserved in worker"

    def test_preserve_flask_contexts_with_user(self) -> None:
        """Test that Flask app context allows user storage in worker context.

        Note: The existing preserve_flask_contexts preserves user from request context,
        not from context vars. In worker threads without request context, we can still
        set user data in g within the app context.
        """
        app = Flask(__name__)

        # Variable to store user from worker
        worker_can_set_user = False

        def worker_task() -> None:
            nonlocal worker_can_set_user
            with preserve_flask_contexts(flask_app=app, context_vars=contextvars.Context()):
                # Set and verify user in the app context
                g._login_user = "test_user"
                worker_can_set_user = hasattr(g, "_login_user") and g._login_user == "test_user"

        # Run worker task in thread
        thread = threading.Thread(target=worker_task)
        thread.start()
        thread.join()

        assert worker_can_set_user, "Should be able to set user in Flask app context within worker"

    def test_worker_with_context(self) -> None:
        """Test that Worker class properly uses context preservation."""
        # Setup Flask app and context
        app = Flask(__name__)
        test_var: contextvars.ContextVar[str] = contextvars.ContextVar("test_var")
        test_var.set("worker_test_value")
        context = contextvars.copy_context()

        # Create queues
        ready_queue: queue.Queue[str] = queue.Queue()
        event_queue: queue.Queue[GraphNodeEventBase] = queue.Queue()

        # Create a mock graph with a test node
        graph = MagicMock(spec=Graph)
        test_node = MagicMock(spec=Node)

        # Variable to capture context inside node execution
        captured_value: str | None = None
        context_available_in_node = False

        def mock_run() -> list[GraphNodeEventBase]:
            """Mock node run that checks context."""
            nonlocal captured_value, context_available_in_node
            try:
                captured_value = test_var.get()
            except LookupError:
                captured_value = None

            from flask import has_app_context

            context_available_in_node = has_app_context()

            from datetime import datetime

            return [
                NodeRunSucceededEvent(
                    id="test",
                    node_id="test_node",
                    node_type=NodeType.CODE,
                    in_iteration_id=None,
                    outputs={},
                    start_at=datetime.now(),
                )
            ]

        test_node.run = mock_run
        graph.nodes = {"test_node": test_node}

        # Create worker with context
        worker = Worker(
            ready_queue=ready_queue,
            event_queue=event_queue,
            graph=graph,
            worker_id=0,
            flask_app=app,
            context_vars=context,
        )

        # Start worker
        worker.start()

        # Queue a node for execution
        ready_queue.put("test_node")

        # Wait for execution
        time.sleep(0.5)

        # Stop worker
        worker.stop()
        worker.join(timeout=1)

        # Check results
        assert captured_value == "worker_test_value", "Context variable should be available in node execution"
        assert context_available_in_node, "Flask app context should be available in node execution"

        # Check that event was pushed
        assert not event_queue.empty(), "Event should be pushed to event queue"
        event = event_queue.get()
        assert isinstance(event, NodeRunSucceededEvent), "Should receive NodeRunSucceededEvent"

    def test_worker_without_context(self) -> None:
        """Test that Worker still works without context."""
        # Create queues
        ready_queue: queue.Queue[str] = queue.Queue()
        event_queue: queue.Queue[GraphNodeEventBase] = queue.Queue()

        # Create a mock graph with a test node
        graph = MagicMock(spec=Graph)
        test_node = MagicMock(spec=Node)

        # Flag to check if node was executed
        node_executed = False

        def mock_run() -> list[GraphNodeEventBase]:
            """Mock node run."""
            nonlocal node_executed
            node_executed = True
            from datetime import datetime

            return [
                NodeRunSucceededEvent(
                    id="test",
                    node_id="test_node",
                    node_type=NodeType.CODE,
                    in_iteration_id=None,
                    outputs={},
                    start_at=datetime.now(),
                )
            ]

        test_node.run = mock_run
        graph.nodes = {"test_node": test_node}

        # Create worker without context
        worker = Worker(
            ready_queue=ready_queue,
            event_queue=event_queue,
            graph=graph,
            worker_id=0,
        )

        # Start worker
        worker.start()

        # Queue a node for execution
        ready_queue.put("test_node")

        # Wait for execution
        time.sleep(0.5)

        # Stop worker
        worker.stop()
        worker.join(timeout=1)

        # Check that node was executed
        assert node_executed, "Node should be executed even without context"

        # Check that event was pushed
        assert not event_queue.empty(), "Event should be pushed to event queue"
