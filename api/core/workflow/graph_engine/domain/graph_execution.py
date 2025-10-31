"""GraphExecution aggregate root managing the overall graph execution state."""

from __future__ import annotations

from dataclasses import dataclass, field
from importlib import import_module
from typing import Literal

from pydantic import BaseModel, Field

from core.workflow.entities.pause_reason import PauseReason
from core.workflow.enums import NodeState

from .node_execution import NodeExecution


class GraphExecutionErrorState(BaseModel):
    """Serializable representation of an execution error."""

    module: str = Field(description="Module containing the exception class")
    qualname: str = Field(description="Qualified name of the exception class")
    message: str | None = Field(default=None, description="Exception message string")


class NodeExecutionState(BaseModel):
    """Serializable representation of a node execution entity."""

    node_id: str
    state: NodeState = Field(default=NodeState.UNKNOWN)
    retry_count: int = Field(default=0)
    execution_id: str | None = Field(default=None)
    error: str | None = Field(default=None)


class GraphExecutionState(BaseModel):
    """Pydantic model describing serialized GraphExecution state."""

    type: Literal["GraphExecution"] = Field(default="GraphExecution")
    version: str = Field(default="1.0")
    workflow_id: str
    started: bool = Field(default=False)
    completed: bool = Field(default=False)
    aborted: bool = Field(default=False)
    paused: bool = Field(default=False)
    pause_reason: PauseReason | None = Field(default=None)
    error: GraphExecutionErrorState | None = Field(default=None)
    exceptions_count: int = Field(default=0)
    node_executions: list[NodeExecutionState] = Field(default_factory=list[NodeExecutionState])


def _serialize_error(error: Exception | None) -> GraphExecutionErrorState | None:
    """Convert an exception into its serializable representation."""

    if error is None:
        return None

    return GraphExecutionErrorState(
        module=error.__class__.__module__,
        qualname=error.__class__.__qualname__,
        message=str(error),
    )


def _resolve_exception_class(module_name: str, qualname: str) -> type[Exception]:
    """Locate an exception class from its module and qualified name."""

    module = import_module(module_name)
    attr: object = module
    for part in qualname.split("."):
        attr = getattr(attr, part)

    if isinstance(attr, type) and issubclass(attr, Exception):
        return attr

    raise TypeError(f"{qualname} in {module_name} is not an Exception subclass")


def _deserialize_error(state: GraphExecutionErrorState | None) -> Exception | None:
    """Reconstruct an exception instance from serialized data."""

    if state is None:
        return None

    try:
        exception_class = _resolve_exception_class(state.module, state.qualname)
        if state.message is None:
            return exception_class()
        return exception_class(state.message)
    except Exception:
        # Fallback to RuntimeError when reconstruction fails
        if state.message is None:
            return RuntimeError(state.qualname)
        return RuntimeError(state.message)


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
    paused: bool = False
    pause_reason: PauseReason | None = None
    error: Exception | None = None
    node_executions: dict[str, NodeExecution] = field(default_factory=dict[str, NodeExecution])
    exceptions_count: int = 0

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

    def pause(self, reason: PauseReason) -> None:
        """Pause the graph execution without marking it complete."""
        if self.completed:
            raise RuntimeError("Cannot pause execution that has completed")
        if self.aborted:
            raise RuntimeError("Cannot pause execution that has been aborted")
        if self.paused:
            return
        self.paused = True
        self.pause_reason = reason

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
        return self.started and not self.completed and not self.aborted and not self.paused

    @property
    def is_paused(self) -> bool:
        """Check if the execution is currently paused."""
        return self.paused

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

    def dumps(self) -> str:
        """Serialize the aggregate state into a JSON string."""

        node_states = [
            NodeExecutionState(
                node_id=node_id,
                state=node_execution.state,
                retry_count=node_execution.retry_count,
                execution_id=node_execution.execution_id,
                error=node_execution.error,
            )
            for node_id, node_execution in sorted(self.node_executions.items())
        ]

        state = GraphExecutionState(
            workflow_id=self.workflow_id,
            started=self.started,
            completed=self.completed,
            aborted=self.aborted,
            paused=self.paused,
            pause_reason=self.pause_reason,
            error=_serialize_error(self.error),
            exceptions_count=self.exceptions_count,
            node_executions=node_states,
        )

        return state.model_dump_json()

    def loads(self, data: str) -> None:
        """Restore aggregate state from a serialized JSON string."""

        state = GraphExecutionState.model_validate_json(data)

        if state.type != "GraphExecution":
            raise ValueError(f"Invalid serialized data type: {state.type}")

        if state.version != "1.0":
            raise ValueError(f"Unsupported serialized version: {state.version}")

        if self.workflow_id != state.workflow_id:
            raise ValueError("Serialized workflow_id does not match aggregate identity")

        self.started = state.started
        self.completed = state.completed
        self.aborted = state.aborted
        self.paused = state.paused
        self.pause_reason = state.pause_reason
        self.error = _deserialize_error(state.error)
        self.exceptions_count = state.exceptions_count
        self.node_executions = {
            item.node_id: NodeExecution(
                node_id=item.node_id,
                state=item.state,
                retry_count=item.retry_count,
                execution_id=item.execution_id,
                error=item.error,
            )
            for item in state.node_executions
        }

    def record_node_failure(self) -> None:
        """Increment the count of node failures encountered during execution."""
        self.exceptions_count += 1
