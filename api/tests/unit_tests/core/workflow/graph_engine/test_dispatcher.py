"""Tests for dispatcher command checking behavior."""

from __future__ import annotations

import queue
from datetime import datetime

from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.event_management.event_manager import EventManager
from core.workflow.graph_engine.orchestration.dispatcher import Dispatcher
from core.workflow.graph_events import NodeRunStartedEvent, NodeRunSucceededEvent
from core.workflow.node_events import NodeRunResult


class _StubExecutionCoordinator:
    """Stub execution coordinator that tracks command checks."""

    def __init__(self) -> None:
        self.command_checks = 0
        self.scaling_checks = 0
        self._execution_complete = False
        self.mark_complete_called = False
        self.failed = False
        self._paused = False

    def check_commands(self) -> None:
        self.command_checks += 1

    def check_scaling(self) -> None:
        self.scaling_checks += 1

    @property
    def is_paused(self) -> bool:
        return self._paused

    def is_execution_complete(self) -> bool:
        return self._execution_complete

    def mark_complete(self) -> None:
        self.mark_complete_called = True

    def mark_failed(self, error: Exception) -> None:  # pragma: no cover - defensive, not triggered in tests
        self.failed = True

    def set_execution_complete(self) -> None:
        self._execution_complete = True


class _StubEventHandler:
    """Minimal event handler that marks execution complete after handling an event."""

    def __init__(self, coordinator: _StubExecutionCoordinator) -> None:
        self._coordinator = coordinator
        self.events = []

    def dispatch(self, event) -> None:
        self.events.append(event)
        self._coordinator.set_execution_complete()


def _run_dispatcher_for_event(event) -> int:
    """Run the dispatcher loop for a single event and return command check count."""
    event_queue: queue.Queue = queue.Queue()
    event_queue.put(event)

    coordinator = _StubExecutionCoordinator()
    event_handler = _StubEventHandler(coordinator)
    event_manager = EventManager()

    dispatcher = Dispatcher(
        event_queue=event_queue,
        event_handler=event_handler,
        event_collector=event_manager,
        execution_coordinator=coordinator,
    )

    dispatcher._dispatcher_loop()

    return coordinator.command_checks


def _make_started_event() -> NodeRunStartedEvent:
    return NodeRunStartedEvent(
        id="start-event",
        node_id="node-1",
        node_type=NodeType.CODE,
        node_title="Test Node",
        start_at=datetime.utcnow(),
    )


def _make_succeeded_event() -> NodeRunSucceededEvent:
    return NodeRunSucceededEvent(
        id="success-event",
        node_id="node-1",
        node_type=NodeType.CODE,
        node_title="Test Node",
        start_at=datetime.utcnow(),
        node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
    )


def test_dispatcher_checks_commands_during_idle_and_on_completion() -> None:
    """Dispatcher polls commands when idle and after completion events."""
    started_checks = _run_dispatcher_for_event(_make_started_event())
    succeeded_checks = _run_dispatcher_for_event(_make_succeeded_event())

    assert started_checks == 1
    assert succeeded_checks == 2
