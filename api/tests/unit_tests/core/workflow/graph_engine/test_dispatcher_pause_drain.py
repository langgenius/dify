import queue
import threading
from datetime import datetime

from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.orchestration.dispatcher import Dispatcher
from core.workflow.graph_events import NodeRunSucceededEvent
from core.workflow.node_events import NodeRunResult


class StubExecutionCoordinator:
    def __init__(self, paused: bool) -> None:
        self._paused = paused
        self.mark_complete_called = False
        self.failed_error: Exception | None = None

    @property
    def aborted(self) -> bool:
        return False

    @property
    def paused(self) -> bool:
        return self._paused

    @property
    def execution_complete(self) -> bool:
        return False

    def check_scaling(self) -> None:
        return None

    def process_commands(self) -> None:
        return None

    def mark_complete(self) -> None:
        self.mark_complete_called = True

    def mark_failed(self, error: Exception) -> None:
        self.failed_error = error


class StubEventHandler:
    def __init__(self) -> None:
        self.events: list[object] = []

    def dispatch(self, event: object) -> None:
        self.events.append(event)


def test_dispatcher_drains_events_when_paused() -> None:
    event_queue: queue.Queue = queue.Queue()
    event = NodeRunSucceededEvent(
        id="exec-1",
        node_id="node-1",
        node_type=NodeType.START,
        start_at=datetime.utcnow(),
        node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
    )
    event_queue.put(event)

    handler = StubEventHandler()
    coordinator = StubExecutionCoordinator(paused=True)
    dispatcher = Dispatcher(
        event_queue=event_queue,
        event_handler=handler,
        execution_coordinator=coordinator,
        event_emitter=None,
        stop_event=threading.Event(),
    )

    dispatcher._dispatcher_loop()

    assert handler.events == [event]
    assert coordinator.mark_complete_called is True
