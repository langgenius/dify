"""
Celery tasks for async workflow execution.

These tasks handle workflow execution for different subscription tiers
with appropriate retry policies and error handling.
"""

import json
from datetime import UTC, datetime
from typing import Any

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models.account import Account
from models.enums import CreatorUserRole, WorkflowTriggerStatus
from models.model import App, EndUser, Tenant
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.errors.app import WorkflowNotFoundError
from services.workflow.entities import AsyncTriggerExecutionResult, AsyncTriggerStatus, TriggerData, WorkflowTaskData

# Determine queue names based on edition
if dify_config.EDITION == "CLOUD":
    # Cloud edition: separate queues for different tiers
    _professional_queue = "workflow_professional"
    _team_queue = "workflow_team"
    _sandbox_queue = "workflow_sandbox"
else:
    # Community edition: single workflow queue (not dataset)
    _professional_queue = "workflow"
    _team_queue = "workflow"
    _sandbox_queue = "workflow"

# Define constants
PROFESSIONAL_QUEUE = _professional_queue
TEAM_QUEUE = _team_queue
SANDBOX_QUEUE = _sandbox_queue


@shared_task(queue=PROFESSIONAL_QUEUE)
def execute_workflow_professional(task_data_dict: dict[str, Any]) -> dict[str, Any]:
    """Execute workflow for professional tier with highest priority"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    return _execute_workflow_common(task_data).model_dump()


@shared_task(queue=TEAM_QUEUE)
def execute_workflow_team(task_data_dict: dict[str, Any]) -> dict[str, Any]:
    """Execute workflow for team tier"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    return _execute_workflow_common(task_data).model_dump()


@shared_task(queue=SANDBOX_QUEUE)
def execute_workflow_sandbox(task_data_dict: dict[str, Any]) -> dict[str, Any]:
    """Execute workflow for free tier with lower retry limit"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    return _execute_workflow_common(task_data).model_dump()


def _execute_workflow_common(task_data: WorkflowTaskData) -> AsyncTriggerExecutionResult:
    """
    Common workflow execution logic with trigger log updates

    Args:
        task_data: Validated Pydantic model with task data

    Returns:
        AsyncTriggerExecutionResult: Pydantic model with execution results
    """
    # Create a new session for this task
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    with session_factory() as session:
        trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)

        # Get trigger log
        trigger_log = trigger_log_repo.get_by_id(task_data.workflow_trigger_log_id)

        if not trigger_log:
            # This should not happen, but handle gracefully
            return AsyncTriggerExecutionResult(
                execution_id=task_data.workflow_trigger_log_id,
                status=AsyncTriggerStatus.FAILED,
                error=f"Trigger log not found: {task_data.workflow_trigger_log_id}",
            )

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
            args: dict[str, Any] = {"inputs": dict(trigger_data.inputs), "files": list(trigger_data.files)}

            # If workflow_id was specified, add it to args
            if trigger_data.workflow_id:
                args["workflow_id"] = str(trigger_data.workflow_id)

            # Execute the workflow with the trigger type
            result = generator.generate(
                app_model=app_model,
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                call_depth=0,
                triggered_from=trigger_data.trigger_type,
                root_node_id=trigger_data.root_node_id,
            )

            # Calculate elapsed time
            elapsed_time = (datetime.now(UTC) - start_time).total_seconds()

            # Extract relevant data from result
            if isinstance(result, dict):
                workflow_run_id = result.get("workflow_run_id")
                total_tokens = result.get("total_tokens")
                outputs = result
            else:
                # Handle generator result - collect all data
                workflow_run_id = None
                total_tokens = None
                outputs = {"data": "streaming_result"}

            # Update trigger log with success
            trigger_log.status = WorkflowTriggerStatus.SUCCEEDED
            trigger_log.workflow_run_id = workflow_run_id
            trigger_log.outputs = json.dumps(outputs)
            trigger_log.elapsed_time = elapsed_time
            trigger_log.total_tokens = total_tokens
            trigger_log.finished_at = datetime.now(UTC)
            trigger_log_repo.update(trigger_log)
            session.commit()

            return AsyncTriggerExecutionResult(
                execution_id=trigger_log.id,
                status=AsyncTriggerStatus.COMPLETED,
                result=outputs,
                elapsed_time=elapsed_time,
                total_tokens=total_tokens,
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

            return AsyncTriggerExecutionResult(
                execution_id=trigger_log.id, status=AsyncTriggerStatus.FAILED, error=str(e), elapsed_time=elapsed_time
            )


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
