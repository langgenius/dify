"""Unit tests for core.telemetry.emit() routing and enterprise-only filtering."""

from __future__ import annotations

import queue
from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.telemetry import emit
from core.telemetry.events import DraftNodeExecutionTraceEvent, TelemetryContext


@pytest.fixture
def telemetry_test_setup():
    trace_queue: queue.Queue[TraceTask] = queue.Queue()
    with (
        patch("core.ops.ops_trace_manager.OpsTraceManager.get_ops_trace_instance", return_value=None),
        patch("core.ops.ops_trace_manager.trace_manager_queue", trace_queue),
        patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=False),
        patch.object(TraceQueueManager, "start_timer"),
    ):
        yield emit, trace_queue


class TestTelemetryEmit:
    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_emit_enterprise_trace_creates_trace_task(self, mock_ee, telemetry_test_setup):
        emit_fn, trace_queue = telemetry_test_setup

        event = DraftNodeExecutionTraceEvent(
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"node_execution_data": {"key": "value"}},
        )

        emit_fn(event)

        called_task = trace_queue.get_nowait()
        assert trace_queue.empty()
        assert called_task.app_id == "test-app"
        assert called_task.user_id == "test-user"
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE

    def test_emit_enterprise_only_trace_dropped_when_ee_disabled(self, telemetry_test_setup):
        emit_fn, trace_queue = telemetry_test_setup

        event = DraftNodeExecutionTraceEvent(
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"node_execution_data": {}},
        )

        emit_fn(event)

        assert trace_queue.empty()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_emit_passes_name_directly_to_trace_task(self, mock_ee, telemetry_test_setup):
        emit_fn, trace_queue = telemetry_test_setup

        event = DraftNodeExecutionTraceEvent(
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"node_execution_data": {"extra": "data"}},
        )

        emit_fn(event)

        called_task = trace_queue.get_nowait()
        assert trace_queue.empty()
        assert called_task.app_id == "test-app"
        assert called_task.user_id == "test-user"
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE
        assert isinstance(called_task.trace_type, TraceTaskName)

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_emit_with_provided_trace_manager(self, mock_ee, telemetry_test_setup):
        emit_fn, trace_queue = telemetry_test_setup

        mock_trace_manager = MagicMock()
        mock_trace_manager.add_trace_task = MagicMock()

        event = DraftNodeExecutionTraceEvent(
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"node_execution_data": {}},
        )

        emit_fn(event, trace_manager=mock_trace_manager)

        mock_trace_manager.add_trace_task.assert_called_once()
        called_task = mock_trace_manager.add_trace_task.call_args[0][0]
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE
