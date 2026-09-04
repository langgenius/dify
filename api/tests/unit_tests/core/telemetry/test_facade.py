"""Unit tests for core.telemetry.emit() routing and enterprise-only filtering."""

from __future__ import annotations

import queue
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.events import DraftNodeExecutionTraceEvent, TelemetryContext


@pytest.fixture
def telemetry_test_setup(monkeypatch: pytest.MonkeyPatch):
    module_name = "core.ops.ops_trace_manager"
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

    from core.telemetry import emit

    return emit, ops_stub.trace_manager_queue


class TestTelemetryEmit:
    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_emit_enterprise_trace_creates_trace_task(self, mock_ee, telemetry_test_setup):
        emit_fn, mock_queue = telemetry_test_setup

        event = DraftNodeExecutionTraceEvent(
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"node_execution_data": {"key": "value"}},
        )

        emit_fn(event)

        mock_queue.put.assert_called_once()
        called_task = mock_queue.put.call_args[0][0]
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE

    def test_emit_enterprise_only_trace_dropped_when_ee_disabled(self, telemetry_test_setup):
        emit_fn, mock_queue = telemetry_test_setup

        event = DraftNodeExecutionTraceEvent(
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"node_execution_data": {}},
        )

        emit_fn(event)

        mock_queue.put.assert_not_called()

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_emit_passes_name_directly_to_trace_task(self, mock_ee, telemetry_test_setup):
        emit_fn, mock_queue = telemetry_test_setup

        event = DraftNodeExecutionTraceEvent(
            context=TelemetryContext(
                tenant_id="test-tenant",
                user_id="test-user",
                app_id="test-app",
            ),
            payload={"node_execution_data": {"extra": "data"}},
        )

        emit_fn(event)

        mock_queue.put.assert_called_once()
        called_task = mock_queue.put.call_args[0][0]
        assert called_task.trace_type == TraceTaskName.DRAFT_NODE_EXECUTION_TRACE
        assert isinstance(called_task.trace_type, TraceTaskName)

    @patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True)
    def test_emit_with_provided_trace_manager(self, mock_ee, telemetry_test_setup):
        emit_fn, mock_queue = telemetry_test_setup

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
