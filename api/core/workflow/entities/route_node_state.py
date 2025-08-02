import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.events import NodeRunResult


class RouteNodeState(BaseModel):
    class Status(Enum):
        RUNNING = "running"
        SUCCESS = "success"
        FAILED = "failed"
        PAUSED = "paused"
        EXCEPTION = "exception"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    """node state id"""

    node_id: str
    """node id"""

    node_run_result: Optional[NodeRunResult] = None
    """node run result"""

    status: Status = Status.RUNNING
    """node status"""

    start_at: datetime
    """start time"""

    paused_at: Optional[datetime] = None
    """paused time"""

    finished_at: Optional[datetime] = None
    """finished time"""

    failed_reason: Optional[str] = None
    """failed reason"""

    paused_by: Optional[str] = None
    """paused by"""

    index: int = 1

    def set_finished(self, run_result: NodeRunResult) -> None:
        """
        Node finished

        :param run_result: run result
        """
        if self.status in {
            RouteNodeState.Status.SUCCESS,
            RouteNodeState.Status.FAILED,
            RouteNodeState.Status.EXCEPTION,
        }:
            raise Exception(f"Route state {self.id} already finished")

        if run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
            self.status = RouteNodeState.Status.SUCCESS
        elif run_result.status == WorkflowNodeExecutionStatus.FAILED:
            self.status = RouteNodeState.Status.FAILED
            self.failed_reason = run_result.error
        elif run_result.status == WorkflowNodeExecutionStatus.EXCEPTION:
            self.status = RouteNodeState.Status.EXCEPTION
            self.failed_reason = run_result.error
        else:
            raise Exception(f"Invalid route status {run_result.status}")

        self.node_run_result = run_result
        self.finished_at = datetime.now(UTC).replace(tzinfo=None)
