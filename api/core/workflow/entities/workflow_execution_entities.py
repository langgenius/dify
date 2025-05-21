"""
Domain entities for workflow execution.

Models are independent of the storage mechanism and don't contain
implementation details like tenant_id, app_id, etc.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field


class WorkflowType(StrEnum):
    """
    Workflow Type Enum for domain layer
    """

    WORKFLOW = "workflow"
    CHAT = "chat"


class WorkflowExecutionStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    STOPPED = "stopped"
    PARTIAL_SUCCEEDED = "partial-succeeded"


class WorkflowExecution(BaseModel):
    """
    Domain model for workflow execution based on WorkflowRun but without
    user, tenant, and app attributes.
    """

    id: str = Field(...)
    workflow_id: str = Field(...)
    workflow_version: str = Field(...)
    sequence_number: int = Field(...)

    type: WorkflowType = Field(...)
    graph: Mapping[str, Any] = Field(...)

    inputs: Mapping[str, Any] = Field(...)
    outputs: Optional[Mapping[str, Any]] = None

    status: WorkflowExecutionStatus = WorkflowExecutionStatus.RUNNING
    error_message: str = Field(default="")
    total_tokens: int = Field(default=0)
    total_steps: int = Field(default=0)
    exceptions_count: int = Field(default=0)

    started_at: datetime = Field(...)
    finished_at: Optional[datetime] = None

    @property
    def elapsed_time(self) -> float:
        """
        Calculate elapsed time in seconds.
        If workflow is not finished, use current time.
        """
        end_time = self.finished_at or datetime.now(UTC).replace(tzinfo=None)
        return (end_time - self.started_at).total_seconds()

    @classmethod
    def new(
        cls,
        *,
        id: str,
        workflow_id: str,
        sequence_number: int,
        type: WorkflowType,
        workflow_version: str,
        graph: Mapping[str, Any],
        inputs: Mapping[str, Any],
        started_at: datetime,
    ) -> "WorkflowExecution":
        return WorkflowExecution(
            id=id,
            workflow_id=workflow_id,
            sequence_number=sequence_number,
            type=type,
            workflow_version=workflow_version,
            graph=graph,
            inputs=inputs,
            status=WorkflowExecutionStatus.RUNNING,
            started_at=started_at,
        )
