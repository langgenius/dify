"""
Execution coordinator for managing overall workflow execution.
"""

from ..command_processing import CommandProcessor
from ..domain import GraphExecution
from ..event_management import EventRouter
from ..state_management import ExecutionTracker, NodeStateManager
from ..worker_management import WorkerPool


class ExecutionCoordinator:
    """
    Coordinates overall execution flow between subsystems.

    This provides high-level coordination methods used by the
    dispatcher to manage execution state.
    """

    def __init__(
        self,
        graph_execution: GraphExecution,
        node_state_manager: NodeStateManager,
        execution_tracker: ExecutionTracker,
        event_router: EventRouter,
        command_processor: CommandProcessor,
        worker_pool: WorkerPool,
    ) -> None:
        """
        Initialize the execution coordinator.

        Args:
            graph_execution: Graph execution aggregate
            node_state_manager: Manager for node states
            execution_tracker: Tracker for executing nodes
            event_router: Router for events
            command_processor: Processor for commands
            worker_pool: Pool of workers
        """
        self.graph_execution = graph_execution
        self.node_state_manager = node_state_manager
        self.execution_tracker = execution_tracker
        self.event_router = event_router
        self.command_processor = command_processor
        self.worker_pool = worker_pool

    def check_commands(self) -> None:
        """Process any pending commands."""
        self.command_processor.process_commands()

    def check_scaling(self) -> None:
        """Check and perform worker scaling if needed."""
        queue_depth = self.node_state_manager.ready_queue.qsize()
        executing_count = self.execution_tracker.count()
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
        return self.node_state_manager.ready_queue.empty() and self.execution_tracker.is_empty()

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
