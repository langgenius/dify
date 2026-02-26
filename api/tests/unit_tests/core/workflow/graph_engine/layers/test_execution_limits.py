from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

from core.workflow.enums import NodeType
from core.workflow.graph_engine.entities.commands import CommandType
from core.workflow.graph_engine.layers.execution_limits import ExecutionLimitsLayer, LimitType
from core.workflow.graph_events import NodeRunFailedEvent, NodeRunStartedEvent, NodeRunSucceededEvent
from core.workflow.node_events import NodeRunResult


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _node_started_event() -> NodeRunStartedEvent:
    return NodeRunStartedEvent(
        id="exec-start",
        node_id="node-1",
        node_type=NodeType.CODE,
        node_title="Node 1",
        start_at=_utc_now(),
        node_run_result=NodeRunResult(),
    )


def _node_succeeded_event() -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="exec-success",
        node_id="node-1",
        node_type=NodeType.CODE,
        start_at=_utc_now(),
        node_run_result=NodeRunResult(),
    )


def _node_failed_event() -> NodeRunFailedEvent:
    return NodeRunFailedEvent(
        id="exec-fail",
        node_id="node-1",
        node_type=NodeType.CODE,
        start_at=_utc_now(),
        error="failure",
        node_run_result=NodeRunResult(),
    )


def test_on_graph_start_resets_runtime_state(monkeypatch) -> None:
    layer = ExecutionLimitsLayer(max_steps=3, max_time=10)
    layer.step_count = 99
    layer._execution_started = False
    layer._execution_ended = True
    layer._abort_sent = True
    monkeypatch.setattr("core.workflow.graph_engine.layers.execution_limits.time.time", lambda: 100.0)

    layer.on_graph_start()

    assert layer.start_time == 100.0
    assert layer.step_count == 0
    assert layer._execution_started is True
    assert layer._execution_ended is False
    assert layer._abort_sent is False


def test_on_event_is_ignored_when_execution_not_running() -> None:
    layer = ExecutionLimitsLayer(max_steps=3, max_time=10)

    layer.on_event(_node_started_event())
    assert layer.step_count == 0

    layer.on_graph_start()
    layer._execution_ended = True
    layer.on_event(_node_started_event())
    assert layer.step_count == 0

    layer._execution_ended = False
    layer._abort_sent = True
    layer.on_event(_node_started_event())
    assert layer.step_count == 0


def test_on_event_sends_abort_when_step_limit_is_exceeded(monkeypatch) -> None:
    layer = ExecutionLimitsLayer(max_steps=0, max_time=100)
    layer.command_channel = MagicMock()
    monkeypatch.setattr("core.workflow.graph_engine.layers.execution_limits.time.time", lambda: 1.0)
    layer.on_graph_start()

    layer.on_event(_node_started_event())
    layer.on_event(_node_succeeded_event())

    assert layer.step_count == 1
    layer.command_channel.send_command.assert_called_once()
    sent_command = layer.command_channel.send_command.call_args.args[0]
    assert sent_command.command_type == CommandType.ABORT
    assert sent_command.reason is not None
    assert "Maximum execution steps exceeded" in sent_command.reason
    assert layer._abort_sent is True


def test_on_event_sends_abort_when_time_limit_is_exceeded(monkeypatch) -> None:
    layer = ExecutionLimitsLayer(max_steps=99, max_time=1)
    layer.command_channel = MagicMock()
    monkeypatch.setattr(
        "core.workflow.graph_engine.layers.execution_limits.time.time",
        MagicMock(side_effect=[0.0, 3.0, 3.0]),
    )
    layer.on_graph_start()

    layer.on_event(_node_started_event())
    layer.on_event(_node_failed_event())

    layer.command_channel.send_command.assert_called_once()
    sent_command = layer.command_channel.send_command.call_args.args[0]
    assert sent_command.command_type == CommandType.ABORT
    assert sent_command.reason is not None
    assert "Maximum execution time exceeded" in sent_command.reason
    assert layer._abort_sent is True


def test_send_abort_command_is_noop_for_invalid_layer_state() -> None:
    layer = ExecutionLimitsLayer(max_steps=1, max_time=1)
    layer.command_channel = MagicMock()

    layer._send_abort_command(LimitType.STEP_LIMIT)
    layer.command_channel.send_command.assert_not_called()

    layer.on_graph_start()
    layer._execution_ended = True
    layer._send_abort_command(LimitType.STEP_LIMIT)
    layer.command_channel.send_command.assert_not_called()

    layer._execution_ended = False
    layer._abort_sent = True
    layer._send_abort_command(LimitType.STEP_LIMIT)
    layer.command_channel.send_command.assert_not_called()


def test_send_abort_command_logs_exception_when_channel_send_fails(monkeypatch) -> None:
    layer = ExecutionLimitsLayer(max_steps=1, max_time=1)
    layer.logger = MagicMock()
    layer.command_channel = MagicMock()
    layer.command_channel.send_command.side_effect = RuntimeError("send failed")
    monkeypatch.setattr("core.workflow.graph_engine.layers.execution_limits.time.time", lambda: 1.0)
    layer.on_graph_start()

    layer._send_abort_command(LimitType.STEP_LIMIT)

    assert layer._abort_sent is False
    layer.logger.exception.assert_called_once()


def test_on_graph_end_marks_execution_ended_once_and_logs_duration(monkeypatch) -> None:
    layer = ExecutionLimitsLayer(max_steps=3, max_time=10)
    layer.logger = MagicMock()
    monkeypatch.setattr(
        "core.workflow.graph_engine.layers.execution_limits.time.time",
        MagicMock(side_effect=[10.0, 14.0]),
    )
    layer.on_graph_start()
    layer.step_count = 2

    layer.on_graph_end(error=None)
    assert layer._execution_ended is True

    logger_calls_after_first_end = layer.logger.debug.call_count
    layer.on_graph_end(error=None)
    assert layer.logger.debug.call_count == logger_calls_after_first_end


def test_reached_limitation_helpers() -> None:
    layer = ExecutionLimitsLayer(max_steps=1, max_time=10)
    layer.step_count = 2
    layer.start_time = 0.0

    assert layer._reached_step_limitation() is True

    # Use a huge current value without patching to make this deterministic.
    layer.max_time = -1
    assert layer._reached_time_limitation() is True
