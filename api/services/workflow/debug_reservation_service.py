"""Recover abandoned trigger-debug executions after API, dispatch, or worker failures."""

import logging
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Protocol

from services.workflow.contracts import DebugReservationCursor, ExpiredDebugReservation


class DebugReservations(Protocol):
    def pending_batch(
        self, now: datetime, *, limit: int, after: DebugReservationCursor | None = None
    ) -> Sequence[DebugReservationCursor]: ...
    def expire(self, execution_id: str, now: datetime) -> ExpiredDebugReservation | None: ...
    def complete_cleanup(
        self, *, tenant_id: str, app_id: str, workflow_id: str, execution_id: str, delete_unstarted: bool
    ) -> None: ...


class ExecutionAgents(Protocol):
    def finished_agent_ids(self, *, tenant_id: str, app_id: str, workflow_id: str, execution_id: str) -> set[str]: ...


class AgentRetirement(Protocol):
    def retire_unowned(self, *, tenant_id: str, agent_ids: Iterable[str], account_id: str | None) -> None: ...


logger = logging.getLogger(__name__)


class WorkflowDebugReservationService:
    def __init__(
        self,
        reservations: DebugReservations,
        executions: ExecutionAgents,
        retirement: AgentRetirement,
    ) -> None:
        self._reservations = reservations
        self._executions = executions
        self._retirement = retirement

    def recover_expired(self, now: datetime) -> None:
        after: DebugReservationCursor | None = None
        while batch := self._reservations.pending_batch(now, limit=100, after=after):
            # Advance using the immutable selected key, regardless of deletion,
            # renewal, or cleanup failure while this batch is being processed.
            after = batch[-1]
            for candidate in batch:
                try:
                    expired = self._reservations.expire(candidate.execution_id, now)
                    if expired is None:
                        continue
                    agents = self._executions.finished_agent_ids(
                        tenant_id=expired.tenant_id,
                        app_id=expired.app_id,
                        workflow_id=expired.workflow_id,
                        execution_id=expired.execution_id,
                    )
                    self._retirement.retire_unowned(
                        tenant_id=expired.tenant_id, agent_ids=agents, account_id=expired.account_id
                    )
                    self._reservations.complete_cleanup(
                        delete_unstarted=True,
                        tenant_id=expired.tenant_id,
                        app_id=expired.app_id,
                        workflow_id=expired.workflow_id,
                        execution_id=expired.execution_id,
                    )
                except Exception:
                    # Persisted expiry remains discoverable for the next sweep.
                    logger.exception("Failed to recover trigger-debug reservation %s", candidate.execution_id)
