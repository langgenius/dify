"""
Celery tasks for async workflow execution.

These tasks handle workflow execution for different subscription tiers
with appropriate retry policies and error handling.
"""

from datetime import UTC, datetime
from typing import Any

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.layers.trigger_post_layer import TriggerPostLayer
from core.db.session_factory import session_factory
from models.account import Account
from models.enums import CreatorUserRole, WorkflowTriggerStatus
from models.model import App, EndUser, Tenant
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.errors.app import WorkflowNotFoundError
from services.workflow.entities import (
    TriggerData,
    WorkflowTaskData,
)
from tasks.workflow_cfs_scheduler.cfs_scheduler import AsyncWorkflowCFSPlanEntity, AsyncWorkflowCFSPlanScheduler
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue, AsyncWorkflowSystemStrategy


@shared_task(queue=AsyncWorkflowQueue.PROFESSIONAL_QUEUE)
def execute_workflow_professional(task_data_dict: dict[str, Any]):
    """Execute workflow for professional tier with highest priority"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    cfs_plan_scheduler_entity = AsyncWorkflowCFSPlanEntity(
        queue=AsyncWorkflowQueue.PROFESSIONAL_QUEUE,
        schedule_strategy=AsyncWorkflowSystemStrategy,
        granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
    )
    _execute_workflow_common(
        task_data,
        AsyncWorkflowCFSPlanScheduler(plan=cfs_plan_scheduler_entity),
        cfs_plan_scheduler_entity,
    )


@shared_task(queue=AsyncWorkflowQueue.TEAM_QUEUE)
def execute_workflow_team(task_data_dict: dict[str, Any]):
    """Execute workflow for team tier"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    cfs_plan_scheduler_entity = AsyncWorkflowCFSPlanEntity(
        queue=AsyncWorkflowQueue.TEAM_QUEUE,
        schedule_strategy=AsyncWorkflowSystemStrategy,
        granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
    )
    _execute_workflow_common(
        task_data,
        AsyncWorkflowCFSPlanScheduler(plan=cfs_plan_scheduler_entity),
        cfs_plan_scheduler_entity,
    )


@shared_task(queue=AsyncWorkflowQueue.SANDBOX_QUEUE)
def execute_workflow_sandbox(task_data_dict: dict[str, Any]):
    """Execute workflow for free tier with lower retry limit"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    cfs_plan_scheduler_entity = AsyncWorkflowCFSPlanEntity(
        queue=AsyncWorkflowQueue.SANDBOX_QUEUE,
        schedule_strategy=AsyncWorkflowSystemStrategy,
        granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
    )
    _execute_workflow_common(
        task_data,
        AsyncWorkflowCFSPlanScheduler(plan=cfs_plan_scheduler_entity),
        cfs_plan_scheduler_entity,
    )


def _build_generator_args(trigger_data: TriggerData) -> dict[str, Any]:
    """Build args passed into WorkflowAppGenerator.generate for Celery executions."""

    args: dict[str, Any] = {
        "inputs": dict(trigger_data.inputs),
        "files": list(trigger_data.files),
        SKIP_PREPARE_USER_INPUTS_KEY: True,
    }
    return args


def _execute_workflow_common(
    task_data: WorkflowTaskData,
    cfs_plan_scheduler: AsyncWorkflowCFSPlanScheduler,
    cfs_plan_scheduler_entity: AsyncWorkflowCFSPlanEntity,
):
    """Execute workflow with common logic and trigger log updates."""

    with session_factory.create_session() as session:
        trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)

        # Get trigger log
        trigger_log = trigger_log_repo.get_by_id(task_data.workflow_trigger_log_id)

        if not trigger_log:
            # This should not happen, but handle gracefully
            return

        # Reconstruct execution data from trigger log
        trigger_data = TriggerData.model_validate_json(trigger_log.trigger_data)

        # Update status to running
        trigger_log.status = WorkflowTriggerStatus.RUNNING
        trigger_log_repo.update(trigger_log)
        session.commit()

        start_time = datetime.now(UTC)

        try:
            # Get app and workflow models
            app_model = session.scalar(select(App).where(App.id == trigger_log.app_id))

            if not app_model:
                raise WorkflowNotFoundError(f"App not found: {trigger_log.app_id}")

            workflow = session.scalar(select(Workflow).where(Workflow.id == trigger_log.workflow_id))
            if not workflow:
                raise WorkflowNotFoundError(f"Workflow not found: {trigger_log.workflow_id}")

            user = _get_user(session, trigger_log)

            # Execute workflow using WorkflowAppGenerator
            generator = WorkflowAppGenerator()

            # Prepare args matching AppGenerateService.generate format
            args = _build_generator_args(trigger_data)

            # If workflow_id was specified, add it to args
            if trigger_data.workflow_id:
                args["workflow_id"] = str(trigger_data.workflow_id)

            # Execute the workflow with the trigger type
            generator.generate(
                app_model=app_model,
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                call_depth=0,
                triggered_from=trigger_data.trigger_from,
                root_node_id=trigger_data.root_node_id,
                graph_engine_layers=[
                    # TODO: Re-enable TimeSliceLayer after the HITL release.
                    TriggerPostLayer(cfs_plan_scheduler_entity, start_time, trigger_log.id),
                ],
            )

        except Exception as e:
            # Calculate elapsed time for failed execution
            elapsed_time = (datetime.now(UTC) - start_time).total_seconds()

            # Update trigger log with failure
            trigger_log.status = WorkflowTriggerStatus.FAILED
            trigger_log.error = str(e)
            trigger_log.finished_at = datetime.now(UTC)
            trigger_log.elapsed_time = elapsed_time
            trigger_log_repo.update(trigger_log)

            # Final failure - no retry logic (simplified like RAG tasks)
            session.commit()


def _get_user(session: Session, trigger_log: WorkflowTriggerLog) -> Account | EndUser:
    """Compose user from trigger log"""
    tenant = session.scalar(select(Tenant).where(Tenant.id == trigger_log.tenant_id))
    if not tenant:
        raise ValueError(f"Tenant not found: {trigger_log.tenant_id}")

    # Get user from trigger log
    if trigger_log.created_by_role == CreatorUserRole.ACCOUNT:
        user = session.scalar(select(Account).where(Account.id == trigger_log.created_by))
        if user:
            user.current_tenant = tenant
    else:  # CreatorUserRole.END_USER
        user = session.scalar(select(EndUser).where(EndUser.id == trigger_log.created_by))

    if not user:
        raise ValueError(f"User not found: {trigger_log.created_by} (role: {trigger_log.created_by_role})")

    return user
