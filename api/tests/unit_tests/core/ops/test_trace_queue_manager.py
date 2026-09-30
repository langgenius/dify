"""Exercise the real trace queue's telemetry guard without scheduling background work."""

import queue

import pytest
from flask import Flask

from core.ops import ops_trace_manager
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask


@pytest.mark.parametrize(
    ("telemetry_enabled", "trace_configured", "should_enqueue"),
    [
        pytest.param(False, False, False, id="no-consumer"),
        pytest.param(True, False, True, id="telemetry-only"),
        pytest.param(False, True, True, id="provider-only"),
        pytest.param(True, True, True, id="both-consumers"),
    ],
)
def test_trace_task_is_enqueued_only_for_active_consumers(
    monkeypatch: pytest.MonkeyPatch,
    telemetry_enabled: bool,
    trace_configured: bool,
    should_enqueue: bool,
) -> None:
    tasks: queue.Queue[TraceTask] = queue.Queue()
    trace_instance = object() if trace_configured else None
    monkeypatch.setattr(ops_trace_manager, "trace_manager_queue", tasks)
    monkeypatch.setattr(ops_trace_manager, "is_enterprise_telemetry_enabled", lambda: telemetry_enabled)
    monkeypatch.setattr(ops_trace_manager.OpsTraceManager, "get_ops_trace_instance", lambda _app_id: trace_instance)
    monkeypatch.setattr(TraceQueueManager, "start_timer", lambda _self: None)
    task = TraceTask(trace_type=TraceTaskName.WORKFLOW_TRACE)

    with Flask(__name__).app_context():
        manager = TraceQueueManager(app_id="test-app-id")
        manager.add_trace_task(task)

    if should_enqueue:
        queued_task = tasks.get_nowait()
        assert queued_task is task
        assert queued_task.app_id == "test-app-id"
    assert tasks.empty()
