from abc import ABC, abstractmethod
from enum import StrEnum

from services.workflow.entities import WorkflowScheduleCFSPlanEntity


class SchedulerCommand(StrEnum):
    """
    Scheduler command.
    """

    RESOURCE_LIMIT_REACHED = "resource_limit_reached"
    NONE = "none"


class CFSPlanScheduler[PlanT: WorkflowScheduleCFSPlanEntity](ABC):
    """
    CFS plan scheduler.
    """

    plan: PlanT

    def __init__(self, plan: PlanT):
        """
        Initialize the CFS plan scheduler.

        Args:
            plan: The CFS plan.
        """
        self.plan = plan

    @abstractmethod
    def can_schedule(self) -> SchedulerCommand:
        """
        Whether a workflow run can be scheduled.
        """
