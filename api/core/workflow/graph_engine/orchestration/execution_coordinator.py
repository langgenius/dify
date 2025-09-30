"""
Execution coordinator for managing overall workflow execution.
"""

from typing import final

from ..command_processing import CommandProcessor
from ..domain import GraphExecution
from ..graph_state_manager import GraphStateManager
from ..worker_management import WorkerPool


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
        command_processor: CommandProcessor,
        worker_pool: WorkerPool,
    ) -> None:
        """
        Initialize the execution coordinator.

        Args:
            graph_execution: Graph execution aggregate
            state_manager: Unified state manager
            command_processor: Processor for commands
            worker_pool: Pool of workers
        """
        self._graph_execution = graph_execution
        self._state_manager = state_manager
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
        # Treat paused, aborted, or failed executions as terminal states
        if self._graph_execution.is_paused:
            return True

        if self._graph_execution.aborted or self._graph_execution.has_error:
            return True

        return self._state_manager.is_execution_complete()

    @property
    def is_paused(self) -> bool:
        """Expose whether the underlying graph execution is paused."""
        return self._graph_execution.is_paused

    def mark_complete(self) -> None:
        """Mark execution as complete."""
        if self._graph_execution.is_paused:
            return
        if not self._graph_execution.completed:
            self._graph_execution.complete()

    def mark_failed(self, error: Exception) -> None:
        """
        Mark execution as failed.

        Args:
            error: The error that caused failure
        """
        self._graph_execution.fail(error)

    def handle_pause_if_needed(self) -> None:
        """If the execution has been paused, stop workers immediately."""

        if not self._graph_execution.is_paused:
            return

        self._worker_pool.stop()
        self._state_manager.clear_executing()

    def handle_abort_if_needed(self) -> None:
        """If the execution has been aborted, stop workers immediately."""

        if not self._graph_execution.aborted:
            return

        self._worker_pool.stop()
        self._state_manager.clear_executing()
