"""Unit tests for TelemetryFacade.emit() routing and enterprise-only filtering.

This test suite verifies that TelemetryFacade correctly:
1. Routes telemetry events to TraceQueueManager via enum-based TraceTaskName
2. Blocks community traces (returns early)
3. Allows enterprise-only traces to be routed to TraceQueueManager
4. Passes TraceTaskName enum directly to TraceTask constructor
"""

import queue
import sys
import types
from unittest.mock import MagicMock

import pytest

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.events import TelemetryContext, TelemetryEvent


@pytest.fixture
def facade_test_setup(monkeypatch):
    """Fixture to provide TelemetryFacade with mocked TraceQueueManager."""
    module_name = "core.ops.ops_trace_manager"

    # Always create a fresh stub module for testing
    ops_stub = types.ModuleType(module_name)

    class StubTraceTask:
        def __init__(self, trace_type, **kwargs):
            self.trace_type = trace_type
            self.app_id = None
            self.kwargs = kwargs

    class StubTraceQueueManager:
        def __init__(self, app_id=None, user_id=None):
            self.app_id = app_id
            self.user_id = user_id
            self.trace_instance = StubOpsTraceManager.get_ops_trace_instance(app_id)

        def add_trace_task(self, trace_task):
            trace_task.app_id = self.app_id
            from core.ops.ops_trace_manager import trace_manager_queue

            trace_manager_queue.put(trace_task)

    class StubOpsTraceManager:
        @staticmethod
        def get_ops_trace_instance(app_id):
            return None

    ops_stub.TraceQueueManager = StubTraceQueueManager
    ops_stub.TraceTask = StubTraceTask
    ops_stub.OpsTraceManager = StubOpsTraceManager
    ops_stub.trace_manager_queue = MagicMock(spec=queue.Queue)
    monkeypatch.setitem(sys.modules, module_name, ops_stub)

    from core.telemetry.facade import TelemetryFacade

    return TelemetryFacade, ops_stub.trace_manager_queue


class TestTelemetryFacadeEmit:
    """Test TelemetryFacade.emit() routing and filtering."""

    def test_emit_valid_name_creates_trace_task(self, facade_test_setup):
        """Verify emit with enterprise-only trace creates and enqueues a trace task.

        When emit() is called with an enterprise-only trace name
        (DRAFT_NODE_EXECUTION_TRACE), TraceQueueManager.add_trace_task()
        should be called with a TraceTask.
        """
        TelemetryFacade, mock_queue = facade_test_setup

        event = TelemetryEvent(
            name=TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"key": "value"},
        )

        TelemetryFacade.emit(event)

        # Verify add_trace_task was called
        mock_queue.put.assert_called_once()

        # Verify the TraceTask was created with the correct name
        called_task = mock_queue.put.call_args[0][0]
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE

    def test_emit_community_trace_returns_early(self, facade_test_setup):
        """Verify community trace is blocked by early return.

        When emit() is called with a community trace (WORKFLOW_TRACE),
        the facade should return early without calling add_trace_task.
        """
        TelemetryFacade, mock_queue = facade_test_setup

        event = TelemetryEvent(
            name=TraceTaskName.WORKFLOW_TRACE,
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={},
        )

        TelemetryFacade.emit(event)

        # Community traces should not reach the queue
        mock_queue.put.assert_not_called()

    def test_emit_enterprise_only_trace_allowed(self, facade_test_setup):
        """Verify enterprise-only trace is routed to TraceQueueManager.

        When emit() is called with DRAFT_NODE_EXECUTION_TRACE,
        add_trace_task should be called.
        """
        TelemetryFacade, mock_queue = facade_test_setup

        event = TelemetryEvent(
            name=TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={},
        )

        TelemetryFacade.emit(event)

        # Verify add_trace_task was called and task was enqueued
        mock_queue.put.assert_called_once()

        # Verify the TraceTask was created with the correct name
        called_task = mock_queue.put.call_args[0][0]
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE

    def test_emit_all_enterprise_only_traces_allowed(self, facade_test_setup):
        """Verify all 3 enterprise-only traces are correctly identified.

        The three enterprise-only traces are:
        - DRAFT_NODE_EXECUTION_TRACE
        - NODE_EXECUTION_TRACE
        - PROMPT_GENERATION_TRACE

        When these are emitted, they should be routed to add_trace_task.
        """
        TelemetryFacade, mock_queue = facade_test_setup

        enterprise_only_traces = [
            TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
            TraceTaskName.NODE_EXECUTION_TRACE,
            TraceTaskName.PROMPT_GENERATION_TRACE,
        ]

        for trace_name in enterprise_only_traces:
            mock_queue.reset_mock()

            event = TelemetryEvent(
                name=trace_name,
                context=TelemetryContext(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    app_id="test-app",
                ),
                payload={},
            )

            TelemetryFacade.emit(event)

            # All enterprise-only traces should be routed
            mock_queue.put.assert_called_once()

            # Verify the correct trace name was passed
            called_task = mock_queue.put.call_args[0][0]
            assert called_task.trace_type == trace_name

    def test_emit_passes_name_directly_to_trace_task(self, facade_test_setup):
        """Verify event.name (TraceTaskName enum) is passed directly to TraceTask.

        The facade should pass the TraceTaskName enum directly as the first
        argument to TraceTask(), not convert it to a string.
        """
        TelemetryFacade, mock_queue = facade_test_setup

        event = TelemetryEvent(
            name=TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"extra": "data"},
        )

        TelemetryFacade.emit(event)

        # Verify add_trace_task was called
        mock_queue.put.assert_called_once()

        # Verify the TraceTask was created with the enum directly
        called_task = mock_queue.put.call_args[0][0]

        # The trace_type should be the enum, not a string
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE
        assert isinstance(called_task.trace_type, TraceTaskName)

    def test_emit_with_provided_trace_manager(self, facade_test_setup):
        """Verify emit uses provided trace_manager instead of creating one.

        When a trace_manager is provided, emit should use it directly
        instead of creating a new TraceQueueManager.
        """
        TelemetryFacade, mock_queue = facade_test_setup

        mock_trace_manager = MagicMock()
        mock_trace_manager.add_trace_task = MagicMock()

        event = TelemetryEvent(
            name=TraceTaskName.NODE_EXECUTION_TRACE,
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={},
        )

        TelemetryFacade.emit(event, trace_manager=mock_trace_manager)

        # Verify the provided trace_manager was used
        mock_trace_manager.add_trace_task.assert_called_once()

        # Verify the TraceTask was created with the correct name
        called_task = mock_trace_manager.add_trace_task.call_args[0][0]
        assert called_task.trace_type == TraceTaskName.NODE_EXECUTION_TRACE
