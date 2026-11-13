"""Committed facts about the records a trace run is collected for."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class SourceWorkflowRun:
    id: str
    workflow_id: str
    graph: str | None
    """The graph snapshot of the run; ``None`` when the backend does not store it."""
    status: str
    finished_at: datetime | None
    """``None`` while the run has not finished."""
    created_by: str


@dataclass(frozen=True, slots=True)
class SourceNodeExecution:
    id: str
    node_id: str
    workflow_id: str | None
    """``None`` when the backend does not store the workflow."""
    workflow_run_id: str | None
    """``None`` for a single-node preview."""
    title: str
    status: str
    error: str | None
    inputs: str | None
    outputs: str | None
    created_at: datetime
    elapsed_time: float


@dataclass(frozen=True, slots=True)
class MessageProgress:
    """What recovery may infer about a message from its committed row."""

    message_id: str
    conversation_id: str
    agent_app: bool
    paused: bool
    explicit_error: bool
    """The message failed and recorded why."""
    answer_saved: bool
    """The final answer transaction committed, not just an early usage flush."""
    agent_stop_requested: bool
    updated_at: datetime
