from enum import StrEnum

from configs import dify_config
from services.workflow.entities import WorkflowScheduleCFSPlanEntity

# Determine queue names based on edition
if dify_config.EDITION == "CLOUD":
    # Cloud edition: separate queues for different tiers
    _professional_queue = "workflow_professional"
    _team_queue = "workflow_team"
    _sandbox_queue = "workflow_sandbox"
    AsyncWorkflowSystemStrategy = WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice
else:
    # Community edition: single workflow queue (not dataset)
    _professional_queue = "workflow"
    _team_queue = "workflow"
    _sandbox_queue = "workflow"
    AsyncWorkflowSystemStrategy = WorkflowScheduleCFSPlanEntity.Strategy.Nop


class AsyncWorkflowQueue(StrEnum):
    # Define constants
    PROFESSIONAL_QUEUE = _professional_queue
    TEAM_QUEUE = _team_queue
    SANDBOX_QUEUE = _sandbox_queue
