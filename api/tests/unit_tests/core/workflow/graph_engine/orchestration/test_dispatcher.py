"""Tests for dispatcher command checking behavior."""

from __future__ import annotations

import queue
import threading
from unittest import mock

from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.event_management.event_handlers import EventHandler
from core.workflow.graph_engine.orchestration.dispatcher import Dispatcher
from core.workflow.graph_engine.orchestration.execution_coordinator import ExecutionCoordinator
from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunPauseRequestedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now


def test_dispatcher_should_consume_remains_events_after_pause():
    event_queue = queue.Queue()
    event_queue.put(
        GraphNodeEventBase(
            id="test",
            node_id="test",
            node_type=NodeType.START,
        )
    )
    event_handler = mock.Mock(spec=EventHandler)
    execution_coordinator = mock.Mock(spec=ExecutionCoordinator)
    execution_coordinator.paused.return_value = True
    dispatcher = Dispatcher(
        event_queue=event_queue,
        event_handler=event_handler,
        execution_coordinator=execution_coordinator,
        stop_event=threading.Event(),
    )
    dispatcher._dispatcher_loop()
    assert event_queue.empty()


class _StubExecutionCoordinator:
    """Stub execution coordinator that tracks command checks."""

    def __init__(self) -> None:
        self.command_checks = 0
        self.scaling_checks = 0
        self.execution_complete = False
        self.failed = False
        self._paused = False

    def process_commands(self) -> None:
        self.command_checks += 1

    def check_scaling(self) -> None:
        self.scaling_checks += 1

    @property
    def paused(self) -> bool:
        return self._paused

    @property
    def aborted(self) -> bool:
        return False

    def mark_complete(self) -> None:
        self.execution_complete = True

    def mark_failed(self, error: Exception) -> None:  # pragma: no cover - defensive, not triggered in tests
        self.failed = True


class _StubEventHandler:
    """Minimal event handler that marks execution complete after handling an event."""

    def __init__(self, coordinator: _StubExecutionCoordinator) -> None:
        self._coordinator = coordinator
        self.events = []

    def dispatch(self, event) -> None:
        self.events.append(event)
        self._coordinator.mark_complete()


def _run_dispatcher_for_event(event) -> int:
    """Run the dispatcher loop for a single event and return command check count."""
    event_queue: queue.Queue = queue.Queue()
    event_queue.put(event)

    coordinator = _StubExecutionCoordinator()
    event_handler = _StubEventHandler(coordinator)

    dispatcher = Dispatcher(
        event_queue=event_queue,
        event_handler=event_handler,
        execution_coordinator=coordinator,
        stop_event=threading.Event(),
    )

    dispatcher._dispatcher_loop()

    return coordinator.command_checks


def _make_started_event() -> NodeRunStartedEvent:
    return NodeRunStartedEvent(
        id="start-event",
        node_id="node-1",
        node_type=NodeType.CODE,
        node_title="Test Node",
        start_at=naive_utc_now(),
    )


def _make_succeeded_event() -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="success-event",
        node_id="node-1",
        node_type=NodeType.CODE,
        node_title="Test Node",
        start_at=naive_utc_now(),
        node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
    )


def test_dispatcher_checks_commands_during_idle_and_on_completion() -> None:
    """Dispatcher polls commands when idle and after completion events."""
    started_checks = _run_dispatcher_for_event(_make_started_event())
    succeeded_checks = _run_dispatcher_for_event(_make_succeeded_event())

    assert started_checks == 2
    assert succeeded_checks == 3


class _PauseStubEventHandler:
    """Minimal event handler that marks execution complete after handling an event."""

    def __init__(self, coordinator: _StubExecutionCoordinator) -> None:
        self._coordinator = coordinator
        self.events = []

    def dispatch(self, event) -> None:
        self.events.append(event)
        if isinstance(event, NodeRunPauseRequestedEvent):
            self._coordinator.mark_complete()


def test_dispatcher_drain_event_queue():
    events = [
        NodeRunStartedEvent(
            id="start-event",
            node_id="node-1",
            node_type=NodeType.CODE,
            node_title="Code",
            start_at=naive_utc_now(),
        ),
        NodeRunPauseRequestedEvent(
            id="pause-event",
            node_id="node-1",
            node_type=NodeType.CODE,
            reason=SchedulingPause(message="test pause"),
        ),
        NodeRunSucceededEvent(
            id="success-event",
            node_id="node-1",
            node_type=NodeType.CODE,
            start_at=naive_utc_now(),
            node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
        ),
    ]

    event_queue: queue.Queue = queue.Queue()
    for e in events:
        event_queue.put(e)

    coordinator = _StubExecutionCoordinator()
    event_handler = _PauseStubEventHandler(coordinator)

    dispatcher = Dispatcher(
        event_queue=event_queue,
        event_handler=event_handler,
        execution_coordinator=coordinator,
        stop_event=threading.Event(),
    )

    dispatcher._dispatcher_loop()

    # ensure all events are drained.
    assert event_queue.empty()
