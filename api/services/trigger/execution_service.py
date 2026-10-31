"""Own trigger execution status transitions independently of workflow runtime models."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from models.enums import WorkflowTriggerStatus
from services.workflow.entities import TriggerActor, TriggerData


@dataclass(frozen=True, slots=True)
class TriggerExecutionRef:
    id: str
    tenant_id: str
    app_id: str
    queue_name: str


@dataclass(frozen=True, slots=True)
class TriggerExecution:
    log: TriggerExecutionRef
    workflow_id: str
    actor: TriggerActor
    data: TriggerData


class TriggerExecutionStore(Protocol):
    def start(self, log_id: str) -> TriggerExecution | None:
        """Claim a pending task; return None if it is missing or already claimed."""
        ...

    def find_for_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> TriggerExecutionRef | None: ...

    def fail(self, *, log: TriggerExecutionRef, error: str, finished_at: datetime, elapsed_time: float) -> None: ...

    def finish(
        self,
        *,
        log: TriggerExecutionRef,
        status: WorkflowTriggerStatus,
        workflow_run_id: str,
        outputs: Mapping[str, Any],
        total_tokens: int,
        finished_at: datetime,
        elapsed_time: float,
        abort_reason: str | None,
    ) -> bool: ...


class TriggerExecutionService:
    def __init__(
        self,
        *,
        logs: TriggerExecutionStore,
        run: Callable[[TriggerExecution, datetime], None],
    ) -> None:
        self._logs = logs
        self._run = run

    def execute(self, log_id: str) -> None:
        execution = self._logs.start(log_id)
        if execution is None:
            return
        started_at = datetime.now(UTC)
        try:
            self._run(execution, started_at)
        except Exception as error:
            # Keep the existing terminal-failure behavior; task retries are not introduced here.
            finished_at = datetime.now(UTC)
            self._logs.fail(
                log=execution.log,
                error=str(error),
                finished_at=finished_at,
                elapsed_time=(finished_at - started_at).total_seconds(),
            )
