import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, ClassVar, override

from pydantic import TypeAdapter

from core.db.session_factory import session_factory
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.engine.layer import Layer
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
)
from models.enums import WorkflowTriggerStatus
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository

logger = logging.getLogger(__name__)


class TriggerPostLayer(Layer):
    """
    Trigger post layer.
    """

    _STATUS_MAP: ClassVar[dict[type[EngineEvent], WorkflowTriggerStatus]] = {
        GraphRunSucceededEvent: WorkflowTriggerStatus.SUCCEEDED,
        GraphRunPartialSucceededEvent: WorkflowTriggerStatus.SUCCEEDED,
        GraphRunFailedEvent: WorkflowTriggerStatus.FAILED,
        GraphRunAbortedEvent: WorkflowTriggerStatus.FAILED,
        GraphRunPausedEvent: WorkflowTriggerStatus.PAUSED,
    }

    def __init__(
        self,
        start_time: datetime,
        trigger_log_id: str,
        *,
        execution_guard: Callable[[], bool] | None = None,
    ):
        super().__init__()
        self.trigger_log_id = trigger_log_id
        self.start_time = start_time
        self.execution_guard = execution_guard
        self._pending_terminal_event: EngineEvent | None = None
        self._published_pause_run_id: str | None = None

    @override
    def on_event(self, event: EngineEvent):
        """
        Update trigger log with success or failure.
        """
        if isinstance(event, tuple(self._STATUS_MAP.keys())):
            self._pending_terminal_event = event
            # The engine emits PAUSED before the aggregate stores its snapshot.
            # Only the aggregate's successful pause handoff may publish it.
            if not isinstance(event, GraphRunPausedEvent):
                self.publish_pending_terminal(require_ownership=False)

    def publish_pending_terminal(self, *, require_ownership: bool = True) -> None:
        """Retry terminal publication outside Graphon's exception-swallowing dispatcher."""
        event = self._pending_terminal_event
        if event is not None:
            with session_factory.create_session() as session:
                repo = SQLAlchemyWorkflowTriggerLogRepository(session)
                trigger_log = (
                    repo.lock_for_execution_update(trigger_log_id=self.trigger_log_id)
                    if self.execution_guard is not None
                    else repo.get_by_id(self.trigger_log_id)
                )
                if trigger_log is None:
                    logger.error("Trigger log not found: %s", self.trigger_log_id)
                    return
                if self.execution_guard is not None:
                    correcting_pause = (
                        trigger_log.status == WorkflowTriggerStatus.PAUSED
                        and self._published_pause_run_id is not None
                        and self._published_pause_run_id == trigger_log.workflow_run_id
                        and isinstance(event, GraphRunFailedEvent | GraphRunAbortedEvent)
                    )
                    if trigger_log.status != WorkflowTriggerStatus.RUNNING and not correcting_pause:
                        session.rollback()
                        self._pending_terminal_event = None
                        return
                    if not self.execution_guard():
                        session.rollback()
                        if require_ownership:
                            raise RuntimeError(
                                f"Cannot publish terminal event without execution ownership: {self.trigger_log_id}"
                            )
                        return
                # Calculate elapsed time
                now = datetime.now(UTC)
                elapsed_time = (now - self.start_time).total_seconds()

                # Extract relevant data from result
                outputs = self.runtime_state.outputs

                # BASICLY, workflow_execution_id is the same as workflow_run_id
                workflow_run_id = get_system_text(
                    self.runtime_state.variable_pool,
                    SystemVariableKey.WORKFLOW_EXECUTION_ID,
                )
                assert workflow_run_id, "Workflow run id is not set"

                total_tokens = self.runtime_state.total_tokens

                trigger_log.status = self._STATUS_MAP[type(event)]
                trigger_log.workflow_run_id = workflow_run_id
                trigger_log.outputs = TypeAdapter(dict[str, Any]).dump_json(outputs).decode()
                if isinstance(event, GraphRunAbortedEvent):
                    trigger_log.error = event.reason or "Workflow execution aborted"
                trigger_log.elapsed_time = (trigger_log.elapsed_time or 0) + elapsed_time
                trigger_log.total_tokens = total_tokens
                trigger_log.finished_at = now
                repo.update(trigger_log)
                session.commit()
                if isinstance(event, GraphRunPausedEvent):
                    self._published_pause_run_id = workflow_run_id
                self._pending_terminal_event = None
                self.start_time = now
