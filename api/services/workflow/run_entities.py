"""Shared workflow run, pause, retention, and statistics contracts."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import NamedTuple, Protocol, TypedDict

from core.workflow.nodes.human_input.pause_reason import PauseReason as DifyPauseReason
from graphon.enums import WorkflowExecutionStatus


@dataclass(frozen=True, slots=True)
class WebWorkflowTarget[AppT, UserT]:
    """Admitted app state and detached records passed to the generation runtime."""

    app: AppT
    user: UserT
    mode: str
    workflow_id: str | None


class RunsWithRelatedCountsDict(TypedDict):
    runs: int
    node_executions: int
    offloads: int
    app_logs: int
    trigger_logs: int
    pauses: int
    pause_reasons: int


@dataclass(frozen=True)
class WorkflowRunCleanupRef:
    """
    Lightweight workflow run reference for retention cleanup scans.

    Cleanup jobs use this DTO when they only need cursor, tenant eligibility, and run-id deletion data. Keeping the
    query shape explicit prevents free-plan cleanup from hydrating full WorkflowRun models for rows that may be skipped
    after billing checks.
    """

    id: str
    tenant_id: str
    created_at: datetime


class WorkflowRunMessageRef(NamedTuple):
    message_id: str
    conversation_id: str


class WorkflowRunPauseRecord(NamedTuple):
    status: WorkflowExecutionStatus
    paused_at: datetime | None
    reasons: tuple[DifyPauseReason, ...]
    form_tokens: Mapping[str, str]


class WorkflowPauseEntity(Protocol):
    """
    Protocol for workflow pause entities.

    This domain model represents a paused workflow execution state,
    without implementation details like tenant_id, app_id, etc.
    It provides the interface for managing workflow pause/resume operations
    and state persistence through file storage.

    The `WorkflowPauseEntity` is never reused. If a workflow execution pauses multiple times,
    it will generate multiple `WorkflowPauseEntity` records.
    """

    @property
    def id(self) -> str:
        """The identifier of current WorkflowPauseEntity"""
        ...

    @property
    def workflow_execution_id(self) -> str:
        """The identifier of the workflow execution record the pause associated with.
        Correspond to `WorkflowExecution.id`.
        """
        ...

    def get_state(self) -> bytes:
        """
        Retrieve the serialized workflow state from storage.

        This method should load and return the workflow execution state
        that was saved when the workflow was paused. The state contains
        all necessary information to resume the workflow execution.

        Returns:
            bytes: The serialized workflow state containing
            execution context, variable values, node states, etc.

        """
        ...

    @property
    def resumed_at(self) -> datetime | None:
        """`resumed_at` return the resumption time of the current pause, or `None` if
        the pause is not resumed yet.
        """
        ...

    @property
    def paused_at(self) -> datetime:
        """`paused_at` returns the creation time of the pause."""
        ...

    def get_pause_reasons(self) -> Sequence[DifyPauseReason]:
        """
        Retrieve detailed reasons for this pause.

        Returns a sequence of `PauseReason` objects describing the specific nodes and
        reasons for which the workflow execution was paused.
        """
        ...


class DailyRunsStats(TypedDict):
    date: str
    runs: int


class DailyTerminalsStats(TypedDict):
    date: str
    terminal_count: int


class DailyTokenCostStats(TypedDict):
    date: str
    token_count: int


class AverageInteractionStats(TypedDict):
    date: str
    interactions: float
