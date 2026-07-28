import logging
from datetime import UTC, datetime
from typing import Any, ClassVar, override

from pydantic import TypeAdapter

from core.app.apps.workflow.command_channels import is_workflow_warm_shutdown_pause
from core.db.session_factory import session_factory
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
)
from libs.datetime_utils import ensure_naive_utc
from models.enums import WorkflowTriggerStatus
from models.workflow import WorkflowRun
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
        GraphRunAbortedEvent: WorkflowTriggerStatus.FAILED,
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

    @override
    def on_graph_start(self):
        # Persist the association before the graph can enter a maintenance
        # handoff. The pause event is intentionally transparent, so waiting
        # until a terminal event would leave the compensation scanner unable
        # to find and terminalize the trigger log after resume exhaustion.
        workflow_run_id = get_system_text(
            self.graph_runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        if not workflow_run_id:
            logger.warning("Workflow run id is not set when trigger graph starts: %s", self.trigger_log_id)
            return

        with session_factory.create_session() as session:
            repo = SQLAlchemyWorkflowTriggerLogRepository(session)
            trigger_log = repo.get_by_id(self.trigger_log_id)
            if not trigger_log:
                logger.error("Trigger log not found: %s", self.trigger_log_id)
                return
            if trigger_log.workflow_run_id == workflow_run_id:
                return
            trigger_log.workflow_run_id = workflow_run_id
            repo.update(trigger_log)
            session.commit()

    @override
    def on_event(self, event: GraphEngineEvent):
        """
        Update trigger log with success or failure.
        """
        if isinstance(event, GraphRunPausedEvent) and is_workflow_warm_shutdown_pause(event.reasons):
            # Maintenance handoff is transparent to the logical trigger run.
            # The resumed worker will eventually persist its actual terminal
            # status and cumulative execution statistics.
            return

        if isinstance(event, tuple(self._STATUS_MAP.keys())):
            with session_factory.create_session() as session:
                repo = SQLAlchemyWorkflowTriggerLogRepository(session)
                trigger_log = repo.get_by_id(self.trigger_log_id)
                if not trigger_log:
                    logger.exception("Trigger log not found: %s", self.trigger_log_id)
                    return

                now = datetime.now(UTC)
                segment_elapsed_time = (now - self.start_time).total_seconds()

                # Extract relevant data from result
                outputs = self.graph_runtime_state.outputs

                # BASICLY, workflow_execution_id is the same as workflow_run_id
                workflow_run_id = get_system_text(
                    self.graph_runtime_state.variable_pool,
                    SystemVariableKey.WORKFLOW_EXECUTION_ID,
                )
                assert workflow_run_id, "Workflow run id is not set"

                total_tokens = self.graph_runtime_state.total_tokens

                # Update trigger log with success
                trigger_log.status = self._STATUS_MAP[type(event)]
                trigger_log.workflow_run_id = workflow_run_id
                trigger_log.outputs = TypeAdapter(dict[str, Any]).dump_json(outputs).decode()
                if isinstance(event, GraphRunAbortedEvent):
                    trigger_log.error = event.reason or "Workflow execution aborted"

                workflow_run = session.get(WorkflowRun, workflow_run_id)
                if workflow_run is not None:
                    # WorkflowRun is the source of user-visible wall-clock
                    # timing across maintenance handoffs. Execution limits and
                    # quota accounting continue to use Graphon's active segment
                    # clocks and token counters instead.
                    trigger_log.elapsed_time = max(
                        (ensure_naive_utc(now) - ensure_naive_utc(workflow_run.created_at)).total_seconds(),
                        0.0,
                    )
                elif trigger_log.elapsed_time is None:
                    trigger_log.elapsed_time = segment_elapsed_time
                else:
                    trigger_log.elapsed_time += segment_elapsed_time

                trigger_log.total_tokens = total_tokens
                trigger_log.finished_at = now
                repo.update(trigger_log)
                session.commit()

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        pass
