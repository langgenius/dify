import logging
import uuid
from typing import ClassVar

from apscheduler.schedulers.background import BackgroundScheduler  # type: ignore

from core.workflow.graph_engine.entities.commands import CommandType, GraphEngineCommand
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from services.workflow.entities import WorkflowScheduleCFSPlanEntity
from services.workflow.scheduler import CFSPlanScheduler, SchedulerCommand

logger = logging.getLogger(__name__)


class TimeSliceLayer(GraphEngineLayer):
    """
    CFS plan scheduler to control the timeslice of the workflow.
    """

    scheduler: ClassVar[BackgroundScheduler] = BackgroundScheduler()

    def __init__(self, cfs_plan_scheduler: CFSPlanScheduler) -> None:
        """
        CFS plan scheduler allows to control the timeslice of the workflow.
        """

        if not TimeSliceLayer.scheduler.running:
            TimeSliceLayer.scheduler.start()

        super().__init__()
        self.cfs_plan_scheduler = cfs_plan_scheduler
        self.stopped = False
        self.schedule_id = ""

    def _checker_job(self, schedule_id: str):
        """
        Check if the workflow need to be suspended.
        """
        try:
            if self.stopped:
                self.scheduler.remove_job(schedule_id)
                return

            if self.cfs_plan_scheduler.can_schedule() == SchedulerCommand.RESOURCE_LIMIT_REACHED:
                # remove the job
                self.scheduler.remove_job(schedule_id)

                if not self.command_channel:
                    logger.exception("No command channel to stop the workflow")
                    return

                # send command to pause the workflow
                self.command_channel.send_command(
                    GraphEngineCommand(
                        command_type=CommandType.PAUSE,
                        payload={
                            "reason": SchedulerCommand.RESOURCE_LIMIT_REACHED,
                        },
                    )
                )

        except Exception:
            logger.exception("scheduler error during check if the workflow need to be suspended")

    def on_graph_start(self):
        """
        Start timer to check if the workflow need to be suspended.
        """

        if self.cfs_plan_scheduler.plan.schedule_strategy == WorkflowScheduleCFSPlanEntity.Strategy.TimeSlice:
            self.schedule_id = uuid.uuid4().hex

            self.scheduler.add_job(
                lambda: self._checker_job(self.schedule_id),
                "interval",
                seconds=self.cfs_plan_scheduler.plan.granularity,
                id=self.schedule_id,
            )

    def on_event(self, event: GraphEngineEvent):
        pass

    def on_graph_end(self, error: Exception | None) -> None:
        self.stopped = True
        # remove the scheduler
        if self.schedule_id:
            self.scheduler.remove_job(self.schedule_id)
