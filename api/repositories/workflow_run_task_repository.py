"""Workflow run task and pause records for the workflow run execution service."""

from collections.abc import Sequence
from typing import override

from core.workflow.nodes.human_input.pause_reason import PauseReason
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_api_workflow_run_repository import WorkflowPauseStoppedError
from services.workflow_run_execution_service import WorkflowRunPauseStoppedError, WorkflowRunTasks


class WorkflowRunTaskRepository(WorkflowRunTasks):
    def __init__(self, *, workflow_runs: APIWorkflowRunRepository) -> None:
        self._workflow_runs = workflow_runs

    @override
    def bind_task(self, *, tenant_id: str, app_id: str, workflow_run_id: str, task_id: str) -> None:
        self._workflow_runs.bind_workflow_task(
            tenant_id=tenant_id, app_id=app_id, workflow_run_id=workflow_run_id, task_id=task_id
        )

    @override
    def stop_paused_task(self, *, tenant_id: str, app_id: str, task_id: str) -> None:
        # A stop already won the pause race, so the driver finishes the run without an owner check.
        self._workflow_runs.stop_paused_workflow_task(tenant_id=tenant_id, app_id=app_id, task_id=task_id, owner=None)

    @override
    def save_pause(
        self, *, workflow_run_id: str, state_owner_user_id: str, state: str, pause_reasons: Sequence[PauseReason]
    ) -> None:
        try:
            self._workflow_runs.create_workflow_pause(
                workflow_run_id=workflow_run_id,
                state_owner_user_id=state_owner_user_id,
                state=state,
                pause_reasons=pause_reasons,
            )
        except WorkflowPauseStoppedError as error:
            raise WorkflowRunPauseStoppedError(str(error)) from error
