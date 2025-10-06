"""
Execution coordinator for managing overall workflow execution.
"""

from typing import TYPE_CHECKING, final

from ..command_processing import CommandProcessor
from ..domain import GraphExecution
from ..event_management import EventManager
from ..graph_state_manager import GraphStateManager
from ..worker_management import WorkerPool

if TYPE_CHECKING:
    from ..event_management import EventHandler


@final
class ExecutionCoordinator:
    """
    Coordinates overall execution flow between subsystems.

    This provides high-level coordination methods used by the
    dispatcher to manage execution state.
    """

    def __init__(
        self,
        graph_execution: GraphExecution,
        state_manager: GraphStateManager,
        event_handler: "EventHandler",
        event_collector: EventManager,
        command_processor: CommandProcessor,
        worker_pool: WorkerPool,
    ) -> None:
        """
        Initialize the execution coordinator.

        Args:
            graph_execution: Graph execution aggregate
            state_manager: Unified state manager
            event_handler: Event handler registry for processing events
            event_collector: Event manager for collecting events
            command_processor: Processor for commands
            worker_pool: Pool of workers
        """
        self._graph_execution = graph_execution
        self._state_manager = state_manager
        self._event_handler = event_handler
        self._event_collector = event_collector
        self._command_processor = command_processor
        self._worker_pool = worker_pool

    def check_commands(self) -> None:
        """Process any pending commands."""
        self._command_processor.process_commands()

    def check_scaling(self) -> None:
        """Check and perform worker scaling if needed."""
        self._worker_pool.check_and_scale()

    def is_execution_complete(self) -> bool:
        """
        Check if execution is complete.

        Returns:
            True if execution is complete
        """
        # Check if aborted or failed
        if self._graph_execution.aborted or self._graph_execution.has_error:
            return True

        # Complete if no work remains
        return self._state_manager.is_execution_complete()

    def mark_complete(self) -> None:
        """Mark execution as complete."""
        if not self._graph_execution.completed:
            self._graph_execution.complete()

    def mark_failed(self, error: Exception) -> None:
        """
        Mark execution as failed.

        Args:
            error: The error that caused failure
        """
        self._graph_execution.fail(error)
