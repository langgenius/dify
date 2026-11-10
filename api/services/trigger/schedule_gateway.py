"""Celery and workflow execution adapters for scheduled triggers."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from celery import group

if TYPE_CHECKING:
    from services.async_workflow_service import TriggerWorkflowDispatcher


def publish_schedules(schedule_ids: Sequence[str]) -> None:
    """Publish one schedule task per ID; propagate broker publication failures."""
    from tasks.workflow_schedule_tasks import run_schedule_trigger

    group(run_schedule_trigger.s(schedule_id) for schedule_id in schedule_ids).apply_async()


class ScheduleWorkflowGateway:
    def __init__(self, *, workflows: TriggerWorkflowDispatcher) -> None:
        self._workflows = workflows

    def __call__(self, *, account_id: str, tenant_id: str, app_id: str, node_id: str) -> str:
        """Dispatch a workflow as the account and return its trigger log ID."""
        from models.enums import CreatorUserRole
        from services.workflow.entities import ScheduleTriggerData, TriggerActor

        response = self._workflows.trigger_workflow_async(
            actor=TriggerActor(id=account_id, role=CreatorUserRole.ACCOUNT),
            trigger_data=ScheduleTriggerData(app_id=app_id, root_node_id=node_id, inputs={}, tenant_id=tenant_id),
        )
        return response.workflow_trigger_log_id
