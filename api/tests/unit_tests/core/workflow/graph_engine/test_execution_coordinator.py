"""Unit tests for the execution coordinator orchestration logic."""

from unittest.mock import MagicMock

from core.workflow.graph_engine.command_processing.command_processor import CommandProcessor
from core.workflow.graph_engine.domain.graph_execution import GraphExecution
from core.workflow.graph_engine.graph_state_manager import GraphStateManager
from core.workflow.graph_engine.orchestration.execution_coordinator import ExecutionCoordinator
from core.workflow.graph_engine.worker_management.worker_pool import WorkerPool


def _build_coordinator(graph_execution: GraphExecution) -> tuple[ExecutionCoordinator, MagicMock, MagicMock]:
    command_processor = MagicMock(spec=CommandProcessor)
    state_manager = MagicMock(spec=GraphStateManager)
    worker_pool = MagicMock(spec=WorkerPool)

    coordinator = ExecutionCoordinator(
        graph_execution=graph_execution,
        state_manager=state_manager,
        command_processor=command_processor,
        worker_pool=worker_pool,
    )
    return coordinator, state_manager, worker_pool


def test_handle_pause_stops_workers_and_clears_state() -> None:
    """Paused execution should stop workers and clear executing state."""
    graph_execution = GraphExecution(workflow_id="workflow")
    graph_execution.start()
    graph_execution.pause("Awaiting human input")

    coordinator, state_manager, worker_pool = _build_coordinator(graph_execution)

    coordinator.handle_pause_if_needed()

    worker_pool.stop.assert_called_once_with()
    state_manager.clear_executing.assert_called_once_with()


def test_handle_pause_noop_when_execution_running() -> None:
    """Running execution should not trigger pause handling."""
    graph_execution = GraphExecution(workflow_id="workflow")
    graph_execution.start()

    coordinator, state_manager, worker_pool = _build_coordinator(graph_execution)

    coordinator.handle_pause_if_needed()

    worker_pool.stop.assert_not_called()
    state_manager.clear_executing.assert_not_called()


def test_is_execution_complete_when_paused() -> None:
    """Paused execution should be treated as complete."""
    graph_execution = GraphExecution(workflow_id="workflow")
    graph_execution.start()
    graph_execution.pause("Awaiting input")

    coordinator, state_manager, _worker_pool = _build_coordinator(graph_execution)
    state_manager.is_execution_complete.return_value = False

    assert coordinator.is_execution_complete()
