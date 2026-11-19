"""Retire workflow-owned Agents, then publish resource cleanup after commit."""

import logging
from collections.abc import Iterable

from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
from repositories.agent.runtime_repository import WorkflowAgentExecutionRepository
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from repositories.workflow.execution_write_repository import WorkflowExecutionWriteRepository
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)


class WorkflowAgentRetirementService:
    def __init__(self, repository: WorkflowAgentRetirementRepository) -> None:
        self._repository = repository

    @classmethod
    def finish_execution(
        cls,
        *,
        sessions: sessionmaker[Session],
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        execution_id: str,
        account_id: str | None,
        status: WorkflowExecutionStatus | None = None,
        cancel: bool = False,
    ) -> None:
        """Complete execution ownership before retiring Agents in a separate transaction.

        Every terminal path, including timeouts without a live stream, uses this
        entry point. Paused runs keep their references. Terminal reference rows
        remain available so a failed resource publication can be retried.
        Cancelled reservations are removed only after every cleanup publication
        succeeds; failures remain discoverable by the reservation sweeper.
        """
        outcome = WorkflowExecutionWriteRepository(sessions).finish(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            execution_id=execution_id,
            status=status,
            cancel=cancel,
        )
        if outcome is None or not outcome.is_ended():
            return
        cls.retire_finished_execution(
            delete_unstarted=cancel,
            sessions=sessions,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            execution_id=execution_id,
            account_id=account_id,
        )

    @classmethod
    def retire_finished_execution(
        cls,
        *,
        sessions: sessionmaker[Session],
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        execution_id: str,
        account_id: str | None,
        delete_unstarted: bool,
    ) -> None:
        """Retry cleanup of committed terminal runs without writing execution state.

        Paused and resumed runs yield no candidates. A failed dispatch retains
        both references and the reservation for recovery; acknowledge only after
        all resource cleanup publications succeed.
        """
        agents = WorkflowAgentExecutionRepository(sessions).finished_agent_ids(
            tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id, execution_id=execution_id
        )
        if agents:
            cls(WorkflowAgentRetirementRepository(sessions)).retire_unowned(
                tenant_id=tenant_id, agent_ids=agents, account_id=account_id
            )
        WorkflowDebugReservationRepository(sessions).complete_cleanup(
            delete_unstarted=delete_unstarted,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            execution_id=execution_id,
        )

    def retire_unowned(self, *, tenant_id: str, agent_ids: Iterable[str], account_id: str | None) -> None:
        """Commit retirement before dispatching idempotent cleanup; failures propagate.

        The repository includes archived Agents and retired resources on retry,
        so a failed publication can be repeated with the complete cleanup work.
        """
        retired = self._repository.retire(tenant_id=tenant_id, agent_ids=agent_ids, account_id=account_id)
        for app_id in retired.app_ids:
            try:
                remove_app_and_related_data_task.delay(tenant_id=tenant_id, app_id=app_id)
            except Exception:
                logger.exception(
                    "Failed to enqueue hidden Agent App cleanup", extra={"tenant_id": tenant_id, "app_id": app_id}
                )
                raise
        enqueue_agent_resource_collection(
            tenant_id=tenant_id,
            workspace_ids=retired.workspace_ids,
            binding_ids=retired.binding_ids,
            home_snapshot_ids=retired.home_snapshot_ids,
            purge_agent_ids=retired.agent_ids,
        )
