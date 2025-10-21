from services.workflow.entities import WorkflowScheduleCFSPlanEntity
from services.workflow.scheduler import CFSPlanScheduler, SchedulerCommand
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue


class TriggerWorkflowCFSPlanEntity(WorkflowScheduleCFSPlanEntity):
    """
    Trigger workflow CFS plan entity.
    """

    queue: AsyncWorkflowQueue


class TriggerCFSPlanScheduler(CFSPlanScheduler):
    """
    Trigger workflow CFS plan scheduler.
    """

    def can_schedule(self) -> SchedulerCommand:
        """
        Check if the workflow can be scheduled.
        """
        assert isinstance(self.plan, TriggerWorkflowCFSPlanEntity)

        if self.plan.queue in [AsyncWorkflowQueue.PROFESSIONAL_QUEUE, AsyncWorkflowQueue.TEAM_QUEUE]:
            """
            permitted all paid users to schedule the workflow
            """
            return SchedulerCommand.NONE

        # FIXME: avoid the sandbox user's workflow at a running state for ever

        return SchedulerCommand.NONE
