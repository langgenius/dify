"""Contracts for trigger execution records and lifecycle persistence."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
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
        """Atomically claim PENDING or QUEUED work; return None if it cannot be claimed."""
        ...

    def find_for_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> TriggerExecutionRef | None:
        """Return the latest log for the owned run, or None if no matching log exists."""
        ...

    def fail(self, *, log: TriggerExecutionRef, error: str, finished_at: datetime, elapsed_time: float) -> None:
        """Mark an owned RUNNING log failed; leave other or missing records unchanged."""
        ...

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
    ) -> bool:
        """Update an owned RUNNING or PAUSED log and add this execution segment's elapsed time.

        PAUSED is allowed because a human-in-the-loop resume does not claim the
        log again. Return False when the record is absent, foreign, or inactive.
        """
        ...
