"""
GraphExecution aggregate root managing the overall graph execution state.
"""

from dataclasses import dataclass, field

from .node_execution import NodeExecution


@dataclass
class GraphExecution:
    """
    Aggregate root for graph execution.

    This manages the overall execution state of a workflow graph,
    coordinating between multiple node executions.
    """

    workflow_id: str
    started: bool = False
    completed: bool = False
    aborted: bool = False
    error: Exception | None = None
    node_executions: dict[str, NodeExecution] = field(default_factory=dict)

    def start(self) -> None:
        """Mark the graph execution as started."""
        if self.started:
            raise RuntimeError("Graph execution already started")
        self.started = True

    def complete(self) -> None:
        """Mark the graph execution as completed."""
        if not self.started:
            raise RuntimeError("Cannot complete execution that hasn't started")
        if self.completed:
            raise RuntimeError("Graph execution already completed")
        self.completed = True

    def abort(self, reason: str) -> None:
        """Abort the graph execution."""
        self.aborted = True
        self.error = RuntimeError(f"Aborted: {reason}")

    def fail(self, error: Exception) -> None:
        """Mark the graph execution as failed."""
        self.error = error
        self.completed = True

    def get_or_create_node_execution(self, node_id: str) -> NodeExecution:
        """Get or create a node execution entity."""
        if node_id not in self.node_executions:
            self.node_executions[node_id] = NodeExecution(node_id=node_id)
        return self.node_executions[node_id]

    @property
    def is_running(self) -> bool:
        """Check if the execution is currently running."""
        return self.started and not self.completed and not self.aborted

    @property
    def has_error(self) -> bool:
        """Check if the execution has encountered an error."""
        return self.error is not None

    @property
    def error_message(self) -> str | None:
        """Get the error message if an error exists."""
        if not self.error:
            return None
        return str(self.error)
