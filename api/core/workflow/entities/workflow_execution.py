"""
Domain entities for workflow execution.

Models are independent of the storage mechanism and don't contain
implementation details like tenant_id, app_id, etc.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from core.workflow.enums import WorkflowExecutionStatus, WorkflowType


class WorkflowExecution(BaseModel):
    """
    Domain model for workflow execution based on WorkflowRun but without
    user, tenant, and app attributes.
    """

    id_: str = Field(...)
    workflow_id: str = Field(...)
    workflow_version: str = Field(...)
    workflow_type: WorkflowType = Field(...)
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
        id_: str,
        workflow_id: str,
        workflow_type: WorkflowType,
        workflow_version: str,
        graph: Mapping[str, Any],
        inputs: Mapping[str, Any],
        started_at: datetime,
    ) -> "WorkflowExecution":
        return WorkflowExecution(
            id_=id_,
            workflow_id=workflow_id,
            workflow_type=workflow_type,
            workflow_version=workflow_version,
            graph=graph,
            inputs=inputs,
            status=WorkflowExecutionStatus.RUNNING,
            started_at=started_at,
        )
