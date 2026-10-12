"""Unit tests for TraceQueueManager telemetry guard.

Verifies that TraceQueueManager.add_trace_task() only enqueues tasks when at
least one consumer is active:
- Enterprise telemetry is enabled (_enterprise_telemetry_enabled=True), OR
- A third-party trace instance (Langfuse, etc.) is configured

When neither is active, tasks are silently dropped to avoid unnecessary work.

When BOTH are false, tasks are silently dropped (correct behavior).
"""

import queue
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def trace_queue_manager_and_task():
    """Exercise the production guard without starting background dispatch."""
    from core.ops.entities.trace_entity import TraceTaskName
    from core.ops.ops_trace_manager import TraceQueueManager, TraceTask

    with patch.object(TraceQueueManager, "start_timer"):
        yield TraceQueueManager, TraceTask, TraceTaskName


class TestTraceQueueManagerTelemetryGuard:
    """Test TraceQueueManager's telemetry guard in add_trace_task()."""

    def test_task_not_enqueued_when_telemetry_disabled_and_no_trace_instance(self, trace_queue_manager_and_task):
        """Verify task is NOT enqueued when telemetry disabled and no trace instance.

        This is the core guard: when _enterprise_telemetry_enabled=False AND
        trace_instance=None, the task should be silently dropped.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        trace_queue = queue.Queue()

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False),
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
            patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            assert trace_queue.empty()

    def test_task_enqueued_when_telemetry_enabled(self, trace_queue_manager_and_task):
        """Verify task IS enqueued when enterprise telemetry is enabled.

        When _enterprise_telemetry_enabled=True, the task should be enqueued
        regardless of trace_instance state.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        trace_queue = queue.Queue()

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
            patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            called_task = trace_queue.get_nowait()
            assert called_task is trace_task
            assert trace_queue.empty()
            assert called_task.app_id == "test-app-id"

    def test_task_enqueued_when_trace_instance_configured(self, trace_queue_manager_and_task):
        """Verify task IS enqueued when third-party trace instance is configured.

        When trace_instance is not None (e.g., Langfuse configured), the task
        should be enqueued even if enterprise telemetry is disabled.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        trace_queue = queue.Queue()

        mock_trace_instance = MagicMock()

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False),
            patch(
                "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=mock_trace_instance
            ),
            patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            called_task = trace_queue.get_nowait()
            assert called_task is trace_task
            assert trace_queue.empty()
            assert called_task.app_id == "test-app-id"

    def test_task_enqueued_when_both_telemetry_and_trace_instance_enabled(self, trace_queue_manager_and_task):
        """Verify task IS enqueued when both telemetry and trace instance are enabled.

        When both _enterprise_telemetry_enabled=True AND trace_instance is set,
        the task should definitely be enqueued.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        trace_queue = queue.Queue()

        mock_trace_instance = MagicMock()

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
            patch(
                "core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=mock_trace_instance
            ),
            patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
        ):
            manager = TraceQueueManager(app_id="test-app-id")
            manager.add_trace_task(trace_task)

            called_task = trace_queue.get_nowait()
            assert called_task is trace_task
            assert trace_queue.empty()
            assert called_task.app_id == "test-app-id"

    def test_app_id_set_before_enqueue(self, trace_queue_manager_and_task):
        """Verify app_id is set on the task before enqueuing.

        The guard logic sets trace_task.app_id = self.app_id before calling
        trace_manager_queue.put(trace_task). This test verifies that behavior.
        """
        TraceQueueManager, TraceTask, TraceTaskName = trace_queue_manager_and_task

        trace_queue = queue.Queue()

        trace_task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

        with (
            patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
            patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
            patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
        ):
            manager = TraceQueueManager(app_id="expected-app-id")
            manager.add_trace_task(trace_task)

            called_task = trace_queue.get_nowait()
            assert called_task is trace_task
            assert trace_queue.empty()
            assert called_task.app_id == "expected-app-id"
