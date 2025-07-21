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
    # State diagram for the workflw status:
    # (@) means start, (*) means end
    #
    #       ┌------------------>------------------------->------------------->--------------┐
    #       |                                                                               |
    #       |                       ┌-----------------------<--------------------┐          |
    #       ^                       |                                            |          |
    #       |                       |                                            ^          |
    #       |                       V                                            |          |
    # ┌-----------┐        ┌-----------------------┐                       ┌-----------┐    V
    # | Scheduled |------->|        Running        |---------------------->| Suspended |    |
    # └-----------┘        └-----------------------┘                       └-----------┘    |
    #       |                |       |       |    |                              |          |
    #       |                |       |       |    |                              |          |
    #       ^                |       |       |    V                              V          |
    #       |                |       |       |    |                         ┌---------┐     |
    #      (@)               |       |       |    └------------------------>| Stopped |<----┘
    #                        |       |       |                              └---------┘
    #                        |       |       |                                   |
    #                        |       |       V                                   V
    #                        |       |  ┌-----------┐                            |
    #                        |       |  | Succeeded |------------->--------------┤
    #                        |       |  └-----------┘                            |
    #                        |       V                                           V
    #                        |  +--------┐                                       |
    #                        |  | Failed |---------------------->----------------┤
    #                        |  └--------┘                                       |
    #                        V                                                   V
    #             ┌---------------------┐                                        |
    #             | Partially Succeeded |---------------------->-----------------┘--------> (*)
    #             └---------------------┘
    #
    # Mermaid diagram:
    #
    #     ---
    #     title: State diagram for Workflow run state
    #     ---
    #     stateDiagram-v2
    #         scheduled: Scheduled
    #         running: Running
    #         succeeded: Succeeded
    #         failed: Failed
    #         partial_succeeded: Partial Succeeded
    #         suspended: Suspended
    #         stopped: Stopped
    #
    #         [*] --> scheduled:
    #         scheduled --> running: Start Execution
    #         running --> suspended: Human input required
    #         suspended --> running: human input added
    #         suspended --> stopped: User stops execution
    #         running --> succeeded: Execution finishes without any error
    #         running --> failed: Execution finishes with errors
    #         running --> stopped: User stops execution
    #         running --> partial_succeeded: some execution occurred and handled during execution
    #
    #         scheduled --> stopped: User stops execution
    #
    #         succeeded --> [*]
    #         failed --> [*]
    #         partial_succeeded --> [*]
    #         stopped --> [*]

    # `SCHEDULED` means that the workflow is scheduled to run, but has not
    # started running yet. (maybe due to possible worker saturation.)
    SCHEDULED = "scheduled"

    # `RUNNING` means the workflow is exeuting.
    RUNNING = "running"

    # `SUCCEEDED` means the execution of workflow succeed without any error.
    SUCCEEDED = "succeeded"

    # `FAILED` means the execution of workflow failed without some errors.
    FAILED = "failed"

    # `STOPPED` means the execution of workflow was stopped, either manually
    # by the user, or automatically by the Dify application (E.G. the moderation
    # mechanism.)
    STOPPED = "stopped"

    # `PARTIAL_SUCCEEDED` indicates that some errors occurred during the workflow
    # execution, but they were successfully handled (e.g., by using an error
    # strategy such as "fail branch" or "default value").
    PARTIAL_SUCCEEDED = "partial-succeeded"

    # `SUSPENDED` indicates that the workflow execution is temporarily paused
    # (e.g., awaiting human input) and is expected to resume later.
    SUSPENDED = "suspended"

    def is_ended(self) -> bool:
        return self in _END_STATE


_END_STATE = frozenset(
    [
        WorkflowExecutionStatus.SUCCEEDED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        WorkflowExecutionStatus.STOPPED,
    ]
)


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
