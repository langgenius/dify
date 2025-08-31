"""
Execution coordinator for managing overall workflow execution.
"""

from typing import TYPE_CHECKING, final

from ..command_processing import CommandProcessor
from ..domain import GraphExecution
from ..event_management import EventCollector
from ..state_management import UnifiedStateManager
from ..worker_management import WorkerPool

if TYPE_CHECKING:
    from ..event_management import EventHandlerRegistry


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
        state_manager: UnifiedStateManager,
        event_handler: "EventHandlerRegistry",
        event_collector: EventCollector,
        command_processor: CommandProcessor,
        worker_pool: WorkerPool,
    ) -> None:
        """
        Initialize the execution coordinator.

        Args:
            graph_execution: Graph execution aggregate
            state_manager: Unified state manager
            event_handler: Event handler registry for processing events
            event_collector: Event collector for collecting events
            command_processor: Processor for commands
            worker_pool: Pool of workers
        """
        self.graph_execution = graph_execution
        self.state_manager = state_manager
        self.event_handler = event_handler
        self.event_collector = event_collector
        self.command_processor = command_processor
        self.worker_pool = worker_pool

    def check_commands(self) -> None:
        """Process any pending commands."""
        self.command_processor.process_commands()

    def check_scaling(self) -> None:
        """Check and perform worker scaling if needed."""
        queue_depth = self.state_manager.ready_queue.qsize()
        executing_count = self.state_manager.get_executing_count()
        self.worker_pool.check_scaling(queue_depth, executing_count)

    def is_execution_complete(self) -> bool:
        """
        Check if execution is complete.

        Returns:
            True if execution is complete
        """
        # Check if aborted or failed
        if self.graph_execution.aborted or self.graph_execution.has_error:
            return True

        # Complete if no work remains
        return self.state_manager.is_execution_complete()

    def mark_complete(self) -> None:
        """Mark execution as complete."""
        if not self.graph_execution.completed:
            self.graph_execution.complete()

    def mark_failed(self, error: Exception) -> None:
        """
        Mark execution as failed.

        Args:
            error: The error that caused failure
        """
        self.graph_execution.fail(error)
