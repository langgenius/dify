"""Host adapter enforcing one persisted wall-clock budget across Graphon resumes."""

import logging
from datetime import UTC, datetime
from threading import RLock, Timer
from typing import override

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.engine.command.entities import AbortCommand
from graphon.engine.layer import Layer
from graphon.engine_events import GraphRunPausedEvent
from graphon.entities.pause_reason import HitlRequired
from graphon.nodes.base.node import Node
from services.external_agents.runtime_contracts import ExecutionIdentity

from .workflow_node import workflow_scope

logger = logging.getLogger(__name__)


class ExternalWorkflowBudgetLayer(Layer):
    """A timer belongs to an active Engine segment; its deadline belongs to the run.

    The SQL deadline includes external wait, cancellation and retry intervals.
    Only a checkpoint whose reasons are all Human Input stops this clock. No
    thread, worker or live graph is retained while the Engine is paused.
    """

    def __init__(self, repository) -> None:
        super().__init__()
        self._repository = repository
        self._timer: Timer | None = None
        self._scope = None
        self._identity = None
        self._lock = RLock()
        self._ended = False

    @override
    def on_node_run_start(self, node: Node) -> None:
        with self._lock:
            if self._identity is not None or self._ended:
                return
            context = DifyRunContext.model_validate(node.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
            run_id = get_system_text(node.runtime_state.variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID)
            if run_id is None:
                return
            scope = workflow_scope(context)
            identity = ExecutionIdentity(
                execution_id=node.execution_id, node_id=node.id, frame_id="root", workflow_run_id=run_id
            )
            now = datetime.now(UTC)
            deadline = self._repository.budget_deadline(scope, identity, now=now)
            self._scope, self._identity = scope, identity
            self._timer = Timer(max((deadline - now).total_seconds(), 0), self._abort)
            self._timer.daemon = True
            self._timer.start()

    def _abort(self) -> None:
        with self._lock:
            if not self._ended and self.command_channel is not None:
                self.command_channel.send_command(
                    AbortCommand(reason="External workflow logical execution budget exceeded.")
                )

    @override
    def on_event(self, event) -> None:
        if isinstance(event, GraphRunPausedEvent) and self._scope is not None and self._identity is not None:
            human_only = bool(event.reasons) and all(isinstance(reason, HitlRequired) for reason in event.reasons)
            self._repository.pause_budget(self._scope, self._identity, human_only=human_only, now=datetime.now(UTC))

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        with self._lock:
            self._ended = True
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
