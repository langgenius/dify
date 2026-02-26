from __future__ import annotations

import queue
import threading
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.workflow.enums import NodeType
from core.workflow.graph_engine.worker import Worker
from core.workflow.graph_events import NodeRunFailedEvent, NodeRunSucceededEvent


def _succeeded_event() -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="exec-1",
        node_id="node-1",
        node_type=NodeType.CODE,
        start_at=datetime.now(UTC),
    )


def test_worker_properties_reflect_runtime_state(monkeypatch: pytest.MonkeyPatch) -> None:
    stop_event = threading.Event()
    worker = Worker(
        ready_queue=MagicMock(),
        event_queue=MagicMock(),
        graph=SimpleNamespace(nodes={}),
        layers=[],
        stop_event=stop_event,
        worker_id=7,
    )
    monkeypatch.setattr("core.workflow.graph_engine.worker.time.time", lambda: worker._last_task_time + 10.0)

    assert worker.is_idle is True
    assert worker.idle_duration > 0
    assert worker.worker_id == 7


def test_run_emits_failed_event_when_execute_node_raises() -> None:
    stop_event = threading.Event()
    event_queue = MagicMock()
    ready_queue = MagicMock()
    node = SimpleNamespace(execution_id="exec", id="node-1", node_type=NodeType.CODE)
    graph = SimpleNamespace(nodes={"node-1": node})

    responses = iter(["node-1", queue.Empty()])

    def _get_with_stop(timeout: float | None = None):
        _ = timeout
        result = next(responses)
        if isinstance(result, Exception):
            stop_event.set()
            raise result
        return result

    ready_queue.get.side_effect = _get_with_stop

    worker = Worker(
        ready_queue=ready_queue,
        event_queue=event_queue,
        graph=graph,
        layers=[],
        stop_event=stop_event,
    )
    worker._execute_node = MagicMock(side_effect=RuntimeError("boom"))

    worker.run()

    ready_queue.task_done.assert_not_called()
    put_event = event_queue.put.call_args.args[0]
    assert isinstance(put_event, NodeRunFailedEvent)
    assert put_event.error == "boom"


def test_execute_node_without_context_pushes_events_and_reports_result() -> None:
    stop_event = threading.Event()
    event_queue = MagicMock()
    node = MagicMock()
    result_event = _succeeded_event()
    node.run.return_value = [result_event]

    worker = Worker(
        ready_queue=MagicMock(),
        event_queue=event_queue,
        graph=SimpleNamespace(nodes={}),
        layers=[],
        stop_event=stop_event,
    )
    worker._invoke_node_run_start_hooks = MagicMock()
    worker._invoke_node_run_end_hooks = MagicMock()

    worker._execute_node(node)

    node.ensure_execution_id.assert_called_once_with()
    event_queue.put.assert_called_once_with(result_event)
    worker._invoke_node_run_start_hooks.assert_called_once_with(node)
    worker._invoke_node_run_end_hooks.assert_called_once_with(node, None, result_event)


def test_execute_node_without_context_re_raises_node_errors() -> None:
    stop_event = threading.Event()
    node = MagicMock()
    node.run.side_effect = RuntimeError("node-run-error")

    worker = Worker(
        ready_queue=MagicMock(),
        event_queue=MagicMock(),
        graph=SimpleNamespace(nodes={}),
        layers=[],
        stop_event=stop_event,
    )
    worker._invoke_node_run_start_hooks = MagicMock()
    worker._invoke_node_run_end_hooks = MagicMock()

    with pytest.raises(RuntimeError, match="node-run-error"):
        worker._execute_node(node)

    error = worker._invoke_node_run_end_hooks.call_args.args[1]
    assert isinstance(error, RuntimeError)
    assert str(error) == "node-run-error"


def test_execute_node_with_execution_context_uses_context_manager() -> None:
    stop_event = threading.Event()
    node = MagicMock()
    node.run.return_value = [_succeeded_event()]
    execution_context = MagicMock()
    execution_context.__enter__ = MagicMock()
    execution_context.__exit__ = MagicMock(return_value=None)

    worker = Worker(
        ready_queue=MagicMock(),
        event_queue=MagicMock(),
        graph=SimpleNamespace(nodes={}),
        layers=[],
        stop_event=stop_event,
        execution_context=execution_context,
    )
    worker._invoke_node_run_start_hooks = MagicMock()
    worker._invoke_node_run_end_hooks = MagicMock()

    worker._execute_node(node)

    execution_context.__enter__.assert_called_once_with()
    execution_context.__exit__.assert_called_once()
    worker._invoke_node_run_end_hooks.assert_called_once()


def test_invoke_hook_methods_ignore_layer_failures() -> None:
    stop_event = threading.Event()
    failing_layer = MagicMock()
    failing_layer.on_node_run_start.side_effect = RuntimeError("start-hook")
    failing_layer.on_node_run_end.side_effect = RuntimeError("end-hook")
    healthy_layer = MagicMock()
    worker = Worker(
        ready_queue=MagicMock(),
        event_queue=MagicMock(),
        graph=SimpleNamespace(nodes={}),
        layers=[failing_layer, healthy_layer],
        stop_event=stop_event,
    )
    node = MagicMock()

    worker._invoke_node_run_start_hooks(node)
    worker._invoke_node_run_end_hooks(node, error=None, result_event=None)

    healthy_layer.on_node_run_start.assert_called_once_with(node)
    healthy_layer.on_node_run_end.assert_called_once_with(node, None, None)
