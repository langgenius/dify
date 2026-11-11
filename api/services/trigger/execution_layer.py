"""Report graph terminal events through an injected trigger execution store."""

import logging
from datetime import UTC, datetime
from typing import ClassVar, override

from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.engine.layer import Layer
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
)
from models.enums import WorkflowTriggerStatus
from services.trigger.execution_store import TriggerExecutionRef, TriggerExecutionStore

logger = logging.getLogger(__name__)


class TriggerPostLayer(Layer):
    _STATUS_MAP: ClassVar[dict[type[EngineEvent], WorkflowTriggerStatus]] = {
        GraphRunSucceededEvent: WorkflowTriggerStatus.SUCCEEDED,
        GraphRunFailedEvent: WorkflowTriggerStatus.FAILED,
        GraphRunAbortedEvent: WorkflowTriggerStatus.FAILED,
        GraphRunPausedEvent: WorkflowTriggerStatus.PAUSED,
    }

    def __init__(self, *, logs: TriggerExecutionStore, log: TriggerExecutionRef, start_time: datetime) -> None:
        super().__init__()
        self._logs = logs
        self._log = log
        self._start_time = start_time

    @override
    def on_event(self, event: EngineEvent) -> None:
        """Persist terminal or pause events for the active run, ignoring other events.

        A workflow run ID must be present. Advance the segment timer only when
        the store accepts the update, avoiding double-counting after a pause.
        """
        if not isinstance(event, tuple(self._STATUS_MAP)):
            return
        now = datetime.now(UTC)
        workflow_run_id = get_system_text(self.runtime_state.variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID)
        assert workflow_run_id, "Workflow run id is not set"
        updated = self._logs.finish(
            log=self._log,
            status=self._STATUS_MAP[type(event)],
            workflow_run_id=workflow_run_id,
            outputs=self.runtime_state.outputs,
            total_tokens=self.runtime_state.total_tokens,
            finished_at=now,
            elapsed_time=(now - self._start_time).total_seconds(),
            abort_reason=(event.reason or "Workflow execution aborted")
            if isinstance(event, GraphRunAbortedEvent)
            else None,
        )
        if updated:
            self._start_time = now
        else:
            logger.info("Trigger log %s is missing or no longer active; skipping status update", self._log.id)
