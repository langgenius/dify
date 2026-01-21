import logging
from datetime import UTC, datetime
from typing import Any, ClassVar

from pydantic import TypeAdapter

from core.db.session_factory import session_factory
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunFailedEvent, GraphRunPausedEvent, GraphRunSucceededEvent
from models.enums import WorkflowTriggerStatus
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from tasks.workflow_cfs_scheduler.cfs_scheduler import AsyncWorkflowCFSPlanEntity

logger = logging.getLogger(__name__)


class TriggerPostLayer(GraphEngineLayer):
    """
    Trigger post layer.
    """

    _STATUS_MAP: ClassVar[dict[type[GraphEngineEvent], WorkflowTriggerStatus]] = {
        GraphRunSucceededEvent: WorkflowTriggerStatus.SUCCEEDED,
        GraphRunFailedEvent: WorkflowTriggerStatus.FAILED,
        GraphRunPausedEvent: WorkflowTriggerStatus.PAUSED,
    }

    def __init__(
        self,
        cfs_plan_scheduler_entity: AsyncWorkflowCFSPlanEntity,
        start_time: datetime,
        trigger_log_id: str,
    ):
        super().__init__()
        self.trigger_log_id = trigger_log_id
        self.start_time = start_time
        self.cfs_plan_scheduler_entity = cfs_plan_scheduler_entity

    def on_graph_start(self):
        pass

    def on_event(self, event: GraphEngineEvent):
        """
        Update trigger log with success or failure.
        """
        if isinstance(event, tuple(self._STATUS_MAP.keys())):
            with session_factory.create_session() as session:
                repo = SQLAlchemyWorkflowTriggerLogRepository(session)
                trigger_log = repo.get_by_id(self.trigger_log_id)
                if not trigger_log:
                    logger.exception("Trigger log not found: %s", self.trigger_log_id)
                    return

                # Calculate elapsed time
                elapsed_time = (datetime.now(UTC) - self.start_time).total_seconds()

                # Extract relevant data from result
                outputs = self.graph_runtime_state.outputs

                # BASICLY, workflow_execution_id is the same as workflow_run_id
                workflow_run_id = self.graph_runtime_state.system_variable.workflow_execution_id
                assert workflow_run_id, "Workflow run id is not set"

                total_tokens = self.graph_runtime_state.total_tokens

                # Update trigger log with success
                trigger_log.status = self._STATUS_MAP[type(event)]
                trigger_log.workflow_run_id = workflow_run_id
                trigger_log.outputs = TypeAdapter(dict[str, Any]).dump_json(outputs).decode()

                if trigger_log.elapsed_time is None:
                    trigger_log.elapsed_time = elapsed_time
                else:
                    trigger_log.elapsed_time += elapsed_time

                trigger_log.total_tokens = total_tokens
                trigger_log.finished_at = datetime.now(UTC)
                repo.update(trigger_log)
                session.commit()

    def on_graph_end(self, error: Exception | None) -> None:
        pass
