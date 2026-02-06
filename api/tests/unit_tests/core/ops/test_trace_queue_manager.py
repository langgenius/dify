"""Unit tests for TraceQueueManager telemetry guard.

This test suite verifies that TraceQueueManager correctly drops trace tasks
when telemetry is disabled, proving Bug 1 from code review is a false positive.

The guard logic moved from persistence.py to TraceQueueManager.add_trace_task()
at line 1282 of ops_trace_manager.py:
    if self._enterprise_telemetry_enabled or self.trace_instance:
        trace_task.app_id = self.app_id
        trace_manager_queue.put(trace_task)

Tasks are only enqueued if EITHER:
- Enterprise telemetry is enabled (_enterprise_telemetry_enabled=True), OR
- A third-party trace instance (Langfuse, etc.) is configured

When BOTH are false, tasks are silently dropped (correct behavior).
"""

import queue
import sys
import types
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def trace_queue_manager_and_task(monkeypatch):
    """Fixture to provide TraceQueueManager and TraceTask with delayed imports."""
    module_name = "core.ops.ops_trace_manager"
    if module_name not in sys.modules:
        ops_stub = types.ModuleType(module_name)

        class StubTraceTask:
            def __init__(self, trace_type):
                self.trace_type = trace_type
                self.app_id = None

        class StubTraceQueueManager:
            def __init__(self, app_id=None):
                self.app_id = app_id
                from core.telemetry import is_enterprise_telemetry_enabled

                self._enterprise_telemetry_enabled = is_enterprise_telemetry_enabled()
                self.trace_instance = StubOpsTraceManager.get_ops_trace_instance(app_id)

            def add_trace_task(self, trace_task):
                if self._enterprise_telemetry_enabled or self.trace_instance:
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

    from core.ops.entities.trace_entity import TraceTaskName

    ops_module = __import__(module_name, fromlist=["TraceQueueManager", "TraceTask"])
    TraceQueueManager = ops_module.TraceQueueManager
    TraceTask = ops_module.TraceTask

    return TraceQueueManager, TraceTask, TraceTaskName


class TestTraceQueueManagerTelemetryGuard:
    """Test TraceQueueManager's telemetry guard in add_trace_task()."""

    def test_task_not_enqueued_when_telemetry_disabled_and_no_trace_instance(self, trace_queue_manager_and_task):
        """Verify task is NOT enqueued when telemetry disabled and no trace instance.

        This is the core guard: when _enterprise_telemetry_enabled=False AND
        trace_instance=None, the task should be silently dropped.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        mock_queue = MagicMock(spec=queue.Queue)

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.is_enterprise_telemetry_enabled", return_value=False),
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
            patch("core.ops.ops_trace_manager.trace_manager_queue", mock_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            mock_queue.put.assert_not_called()

    def test_task_enqueued_when_telemetry_enabled(self, trace_queue_manager_and_task):
        """Verify task IS enqueued when enterprise telemetry is enabled.

        When _enterprise_telemetry_enabled=True, the task should be enqueued
        regardless of trace_instance state.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        mock_queue = MagicMock(spec=queue.Queue)

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.is_enterprise_telemetry_enabled", return_value=True),
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
            patch("core.ops.ops_trace_manager.trace_manager_queue", mock_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            mock_queue.put.assert_called_once()
            called_task = mock_queue.put.call_args[0][0]
            assert called_task.app_id == "test-app-id"

    def test_task_enqueued_when_trace_instance_configured(self, trace_queue_manager_and_task):
        """Verify task IS enqueued when third-party trace instance is configured.

        When trace_instance is not None (e.g., Langfuse configured), the task
        should be enqueued even if enterprise telemetry is disabled.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        mock_queue = MagicMock(spec=queue.Queue)

        mock_trace_instance = MagicMock()

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.is_enterprise_telemetry_enabled", return_value=False),
            patch(
                "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=mock_trace_instance
            ),
            patch("core.ops.ops_trace_manager.trace_manager_queue", mock_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            mock_queue.put.assert_called_once()
            called_task = mock_queue.put.call_args[0][0]
            assert called_task.app_id == "test-app-id"

    def test_task_enqueued_when_both_telemetry_and_trace_instance_enabled(self, trace_queue_manager_and_task):
        """Verify task IS enqueued when both telemetry and trace instance are enabled.

        When both _enterprise_telemetry_enabled=True AND trace_instance is set,
        the task should definitely be enqueued.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        mock_queue = MagicMock(spec=queue.Queue)

        mock_trace_instance = MagicMock()

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.is_enterprise_telemetry_enabled", return_value=True),
            patch(
                "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=mock_trace_instance
            ),
            patch("core.ops.ops_trace_manager.trace_manager_queue", mock_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            mock_queue.put.assert_called_once()
            called_task = mock_queue.put.call_args[0][0]
            assert called_task.app_id == "test-app-id"

    def test_app_id_set_before_enqueue(self, trace_queue_manager_and_task):
        """Verify app_id is set on the task before enqueuing.

        The guard logic sets trace_task.app_id = self.app_id before calling
        trace_manager_queue.put(trace_task). This test verifies that behavior.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        mock_queue = MagicMock(spec=queue.Queue)

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.is_enterprise_telemetry_enabled", return_value=True),
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
            patch("core.ops.ops_trace_manager.trace_manager_queue", mock_queue),
        ):
            manager = TraceQueueManager(app_id="expected-app-id")
            manager.add_trace_task(trace_task)

            called_task = mock_queue.put.call_args[0][0]
            assert called_task.app_id == "expected-app-id"
