"""Graph-wide execution state shared by every runtime frame."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Annotated, Final, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, TypeAdapter

from graphon.entities.pause_reason import PauseReason

ROOT_FRAME_ID: Final = "root"


@dataclass
class NodeExecution:
    """Mutable retry and identity state for one frame-local node."""

    execution_id: str
    retry_count: int = 0

    def increment_retry(self) -> None:
        """Increment the retry count for this node."""
        self.retry_count += 1


class GraphExecutionErrorStateV1(BaseModel):
    """Serialized graph error from version 1.0."""

    qualname: str
    message: str | None = None


class NodeExecutionStateV1(BaseModel):
    """Node execution state before execution frames were introduced."""

    node_id: str
    retry_count: int = 0
    execution_id: str | None = None


class GraphExecutionStateV1(BaseModel):
    """Graph execution state produced before frame-aware execution."""

    type: Literal["GraphExecution"]
    version: Literal["1.0"]
    workflow_id: str
    started: bool = False
    completed: bool = False
    aborted: bool = False
    paused: bool = False
    pause_reasons: list[PauseReason] = Field(default_factory=list)
    error: GraphExecutionErrorStateV1 | None = None
    exceptions_count: int = 0
    node_executions: list[NodeExecutionStateV1] = Field(default_factory=list)


class NodeExecutionState(BaseModel):
    """Serializable representation of a node execution entity."""

    frame_id: str
    node_id: str
    retry_count: int
    execution_id: str


class GraphExecutionState(BaseModel):
    """Pydantic model describing serialized GraphExecution state."""

    version: Literal["2.0"]
    workflow_id: str
    started: bool
    completed: bool
    aborted: bool
    paused: bool
    pause_reasons: list[PauseReason]
    error: str | None
    exceptions_count: int
    node_executions: list[NodeExecutionState]


_GRAPH_EXECUTION_STATE_ADAPTER = TypeAdapter(
    Annotated[
        GraphExecutionStateV1 | GraphExecutionState,
        Field(discriminator="version"),
    ],
)


@dataclass
class GraphExecution:
    """Aggregate root for graph execution.

    This manages the overall execution state of a workflow graph,
    coordinating between multiple node executions.
    """

    workflow_id: str
    started: bool = False
    completed: bool = False
    aborted: bool = False
    paused: bool = False
    pause_reasons: list[PauseReason] = field(default_factory=list)
    error: Exception | None = None
    node_executions: dict[tuple[str, str], NodeExecution] = field(
        default_factory=dict[tuple[str, str], NodeExecution],
    )
    exceptions_count: int = 0

    _active_executions: int = field(default=0, init=False, repr=False, compare=False)
    _snapshot_lock: threading.Lock = field(
        # Resolve at construction so late gevent patching is honored.
        default_factory=lambda: threading.Lock(),  # ruff: ignore[unnecessary-lambda]
        init=False,
        repr=False,
        compare=False,
    )

    @contextmanager
    def track_execution(self) -> Iterator[None]:
        """Keep snapshots disabled for one engine run or execution thread.

        Each participant remains active until it exits, even if a shutdown join
        times out. This accounting is transient and shared by all runtime frames.
        """
        with self._snapshot_lock:
            self._active_executions += 1
        try:
            yield
        finally:
            with self._snapshot_lock:
                self._active_executions -= 1

    @contextmanager
    def lock_for_snapshot(self) -> Iterator[None]:
        """Exclude execution startup and other snapshots during serialization.

        Raises:
            RuntimeError: If an engine run or execution thread is still active.

        """
        with self._snapshot_lock:
            if self._active_executions:
                msg = (
                    "Cannot serialize runtime state during active execution; "
                    "finish consuming or close Engine.run() and wait for all "
                    "execution threads to stop"
                )
                raise RuntimeError(msg)
            yield

    def start(self) -> None:
        """Mark the graph execution as started."""
        if self.started:
            msg = "Graph execution already started"
            raise RuntimeError(msg)
        self.started = True

    def complete(self) -> None:
        """Mark the graph execution as completed."""
        if not self.started:
            msg = "Cannot complete execution that hasn't started"
            raise RuntimeError(msg)
        if self.completed:
            msg = "Graph execution already completed"
            raise RuntimeError(msg)
        self.completed = True

    def abort(self, reason: str) -> None:
        """Abort the graph execution."""
        self.aborted = True
        self.error = RuntimeError(f"Aborted: {reason}")

    def pause(self, reason: PauseReason) -> None:
        """Pause the graph execution without marking it complete."""
        if self.completed:
            msg = "Cannot pause execution that has completed"
            raise RuntimeError(msg)
        if self.aborted:
            msg = "Cannot pause execution that has been aborted"
            raise RuntimeError(msg)
        self.paused = True
        self.pause_reasons.append(reason)

    def fail(self, error: Exception) -> None:
        """Mark the graph execution as failed."""
        self.error = error
        self.completed = True

    def get_or_create_node_execution(
        self, *, frame_id: str, node_id: str
    ) -> NodeExecution:
        """Get or create a node execution entity."""
        key = (frame_id, node_id)
        if key not in self.node_executions:
            self.node_executions[key] = NodeExecution(
                execution_id=str(uuid4()),
            )
        return self.node_executions[key]

    def dumps(self) -> str:
        """Serialize the aggregate state into a JSON string."""
        node_states = [
            NodeExecutionState(
                frame_id=key[0],
                node_id=key[1],
                retry_count=node_execution.retry_count,
                execution_id=node_execution.execution_id,
            )
            for key, node_execution in sorted(self.node_executions.items())
        ]

        state = GraphExecutionState(
            version="2.0",
            workflow_id=self.workflow_id,
            started=self.started,
            completed=self.completed,
            aborted=self.aborted,
            paused=self.paused,
            pause_reasons=self.pause_reasons,
            error=None if self.error is None else str(self.error),
            exceptions_count=self.exceptions_count,
            node_executions=node_states,
        )

        return state.model_dump_json()

    @classmethod
    def from_snapshot(cls, data: str) -> GraphExecution:
        """Construct a complete execution state from serialized JSON.

        Both current version 2 snapshots and legacy version 1 snapshots are
        accepted. Legacy node executions are assigned to the root frame, and a
        missing legacy execution ID is regenerated exactly as before. The JSON
        field names and version values remain unchanged.

        Args:
            data: Serialized graph execution snapshot.

        Returns:
            A fully initialized execution state ready for runtime use.

        """
        serialized_state = _GRAPH_EXECUTION_STATE_ADAPTER.validate_json(data)
        if isinstance(serialized_state, GraphExecutionStateV1):
            state = GraphExecutionState(
                version="2.0",
                workflow_id=serialized_state.workflow_id,
                started=serialized_state.started,
                completed=serialized_state.completed,
                aborted=serialized_state.aborted,
                paused=serialized_state.paused,
                pause_reasons=serialized_state.pause_reasons,
                error=(
                    None
                    if serialized_state.error is None
                    else (
                        serialized_state.error.qualname
                        if serialized_state.error.message is None
                        else serialized_state.error.message
                    )
                ),
                exceptions_count=serialized_state.exceptions_count,
                node_executions=[
                    NodeExecutionState(
                        frame_id=ROOT_FRAME_ID,
                        node_id=item.node_id,
                        retry_count=item.retry_count,
                        execution_id=item.execution_id or str(uuid4()),
                    )
                    for item in serialized_state.node_executions
                ],
            )
        else:
            state = serialized_state

        return cls(
            workflow_id=state.workflow_id,
            started=state.started,
            completed=state.completed,
            aborted=state.aborted,
            paused=state.paused,
            pause_reasons=state.pause_reasons,
            error=RuntimeError(state.error) if state.error is not None else None,
            exceptions_count=state.exceptions_count,
            node_executions={
                (item.frame_id, item.node_id): NodeExecution(
                    retry_count=item.retry_count,
                    execution_id=item.execution_id,
                )
                for item in state.node_executions
            },
        )

    def record_node_failure(self) -> None:
        """Increment the count of node failures encountered during execution."""
        self.exceptions_count += 1
