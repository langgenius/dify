"""Retire workflow-owned Agents, then publish resource cleanup after commit."""

import logging
from collections.abc import Iterable

from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)


class WorkflowAgentRetirementService:
    def __init__(self, repository: WorkflowAgentRetirementRepository) -> None:
        self._repository = repository

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
