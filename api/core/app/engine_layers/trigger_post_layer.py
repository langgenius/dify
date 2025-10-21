import logging
from datetime import UTC, datetime
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy.orm import Session

from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunFailedEvent, GraphRunPausedEvent, GraphRunSucceededEvent
from models.engine import db
from models.enums import WorkflowTriggerStatus
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from tasks.workflow_cfs_scheduler.cfs_scheduler import TriggerWorkflowCFSPlanEntity

logger = logging.getLogger(__name__)


class TriggerPostLayer(GraphEngineLayer):
    """
    Trigger post layer.
    """

    def __init__(
        self,
        cfs_plan_scheduler_entity: TriggerWorkflowCFSPlanEntity,
        start_time: datetime,
        trigger_log_id: str,
    ):
        self.trigger_log_id = trigger_log_id
        self.start_time = start_time
        self.cfs_plan_scheduler_entity = cfs_plan_scheduler_entity

    def on_graph_start(self):
        pass

    def on_event(self, event: GraphEngineEvent):
        """
        Update trigger log with success or failure.
        """
        if isinstance(event, GraphRunSucceededEvent | GraphRunFailedEvent):
            with Session(db.engine) as session:
                repo = SQLAlchemyWorkflowTriggerLogRepository(session)
                trigger_log = repo.get_by_id(self.trigger_log_id)
                if not trigger_log:
                    logger.exception("Trigger log not found: %s", self.trigger_log_id)
                    return

                # Calculate elapsed time
                elapsed_time = (datetime.now(UTC) - self.start_time).total_seconds()

                # Extract relevant data from result
                if not self.graph_runtime_state:
                    logger.exception("Graph runtime state is not set")
                    return

                outputs = self.graph_runtime_state.outputs

                workflow_run_id = outputs.get("workflow_run_id")
                total_tokens = self.graph_runtime_state.total_tokens

                # Update trigger log with success
                trigger_log.status = (
                    WorkflowTriggerStatus.SUCCEEDED
                    if isinstance(event, GraphRunSucceededEvent)
                    else WorkflowTriggerStatus.FAILED
                )
                trigger_log.workflow_run_id = workflow_run_id
                trigger_log.outputs = TypeAdapter(dict[str, Any]).dump_json(outputs).decode()
                trigger_log.elapsed_time = elapsed_time
                trigger_log.total_tokens = total_tokens
                trigger_log.finished_at = datetime.now(UTC)
                repo.update(trigger_log)
                session.commit()
        elif isinstance(event, GraphRunPausedEvent):
            # FIXME: handle the paused event
            pass

    def on_graph_end(self, error: Exception | None) -> None:
        pass
