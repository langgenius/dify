"""Unit tests for the real TraceQueueManager producer facade."""

from unittest.mock import MagicMock, patch

import pytest

from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import OpsTraceManager, TraceQueueManager, TraceTask


@pytest.mark.parametrize(
    ("enterprise_enabled", "provider_configured", "should_submit"),
    [
        (False, False, False),
        (True, False, True),
        (False, True, True),
        (True, True, True),
    ],
)
def test_trace_manager_submits_only_when_a_consumer_is_enabled(
    enterprise_enabled: bool,
    provider_configured: bool,
    should_submit: bool,
) -> None:
    dispatcher = MagicMock()
    task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

    with (
        patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=enterprise_enabled),
        patch.object(OpsTraceManager, "get_ops_trace_instance", return_value=object() if provider_configured else None),
        patch("core.ops.ops_trace_manager._get_trace_dispatcher", return_value=dispatcher),
    ):
        TraceQueueManager(app_id="test-app-id").add_trace_task(task)

    assert dispatcher.submit.called is should_submit


def test_trace_manager_snapshots_app_routing_before_enqueue() -> None:
    dispatcher = MagicMock()
    task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

    with (
        patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
        patch.object(OpsTraceManager, "get_ops_trace_instance", return_value=None),
        patch("core.ops.ops_trace_manager._get_trace_dispatcher", return_value=dispatcher),
    ):
        manager = TraceQueueManager(app_id="source-app-id")
        manager.add_trace_task(task)
        manager.app_id = "other-app-id"

    work_item = dispatcher.submit.call_args.args[0]
    assert work_item.storage_id == "source-app-id"
    assert work_item.task is task
    assert not hasattr(task, "app_id")


def test_trace_manager_uses_tenant_routing_without_an_app() -> None:
    dispatcher = MagicMock()
    task = TraceTask(trace_type=TraceTaskName.DRAFT_NODE_EXECUTION_TRACE, tenant_id="tenant-id")

    with (
        patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
        patch.object(OpsTraceManager, "get_ops_trace_instance", return_value=None),
        patch("core.ops.ops_trace_manager._get_trace_dispatcher", return_value=dispatcher),
    ):
        TraceQueueManager().add_trace_task(task)

    assert dispatcher.submit.call_args.args[0].storage_id == "tenant-tenant-id"


def test_trace_manager_skips_task_without_routing_identity() -> None:
    dispatcher = MagicMock()
    task = TraceTask(trace_type=TraceTaskName.DRAFT_NODE_EXECUTION_TRACE)

    with (
        patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
        patch.object(OpsTraceManager, "get_ops_trace_instance", return_value=None),
        patch("core.ops.ops_trace_manager._get_trace_dispatcher", return_value=dispatcher),
    ):
        TraceQueueManager().add_trace_task(task)

    dispatcher.submit.assert_not_called()
