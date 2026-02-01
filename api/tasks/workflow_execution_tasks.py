"""
Celery tasks for asynchronous workflow execution storage operations.

These tasks provide asynchronous storage capabilities for workflow execution data,
improving performance by offloading storage operations to background workers.
"""

import json
import logging

from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.workflow.entities.workflow_execution import WorkflowExecution
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from models import CreatorUserRole, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


@shared_task(queue="workflow_storage", bind=True, max_retries=3, default_retry_delay=60)
def save_workflow_execution_task(
    self,
    execution_data: dict,
    tenant_id: str,
    app_id: str,
    triggered_from: str,
    creator_user_id: str,
    creator_user_role: str,
) -> bool:
    """
    Asynchronously save or update a workflow execution to the database.

    Args:
        execution_data: Serialized WorkflowExecution data
        tenant_id: Tenant ID for multi-tenancy
        app_id: Application ID
        triggered_from: Source of the execution trigger
        creator_user_id: ID of the user who created the execution
        creator_user_role: Role of the user who created the execution

    Returns:
        True if successful, False otherwise
    """
    try:
        with session_factory.create_session() as session:
            # Deserialize execution data
            execution = WorkflowExecution.model_validate(execution_data)

            # Check if workflow run already exists
            existing_run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == execution.id_))

            if existing_run:
                # Update existing workflow run
                _update_workflow_run_from_execution(existing_run, execution)
                logger.debug("Updated existing workflow run: %s", execution.id_)
            else:
                # Create new workflow run
                workflow_run = _create_workflow_run_from_execution(
                    execution=execution,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    triggered_from=WorkflowRunTriggeredFrom(triggered_from),
                    creator_user_id=creator_user_id,
                    creator_user_role=CreatorUserRole(creator_user_role),
                )
                session.add(workflow_run)
                logger.debug("Created new workflow run: %s", execution.id_)

            session.commit()
            return True

    except Exception as e:
        logger.exception("Failed to save workflow execution %s", execution_data.get("id_", "unknown"))
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2**self.request.retries))


def _create_workflow_run_from_execution(
    execution: WorkflowExecution,
    tenant_id: str,
    app_id: str,
    triggered_from: WorkflowRunTriggeredFrom,
    creator_user_id: str,
    creator_user_role: CreatorUserRole,
) -> WorkflowRun:
    """
    Create a WorkflowRun database model from a WorkflowExecution domain entity.
    """
    workflow_run = WorkflowRun()
    workflow_run.id = execution.id_
    workflow_run.tenant_id = tenant_id
    workflow_run.app_id = app_id
    workflow_run.workflow_id = execution.workflow_id
    workflow_run.type = execution.workflow_type.value
    workflow_run.triggered_from = triggered_from.value
    workflow_run.version = execution.workflow_version
    json_converter = WorkflowRuntimeTypeConverter()
    workflow_run.graph = json.dumps(json_converter.to_json_encodable(execution.graph))
    workflow_run.inputs = json.dumps(json_converter.to_json_encodable(execution.inputs))
    workflow_run.status = execution.status.value
    workflow_run.outputs = (
        json.dumps(json_converter.to_json_encodable(execution.outputs)) if execution.outputs else "{}"
    )
    workflow_run.error = execution.error_message
    workflow_run.elapsed_time = execution.elapsed_time
    workflow_run.total_tokens = execution.total_tokens
    workflow_run.total_steps = execution.total_steps
    workflow_run.created_by_role = creator_user_role.value
    workflow_run.created_by = creator_user_id
    workflow_run.created_at = execution.started_at
    workflow_run.finished_at = execution.finished_at

    return workflow_run


def _update_workflow_run_from_execution(workflow_run: WorkflowRun, execution: WorkflowExecution):
    """
    Update a WorkflowRun database model from a WorkflowExecution domain entity.
    """
    json_converter = WorkflowRuntimeTypeConverter()
    workflow_run.status = execution.status.value
    workflow_run.outputs = (
        json.dumps(json_converter.to_json_encodable(execution.outputs)) if execution.outputs else "{}"
    )
    workflow_run.error = execution.error_message
    workflow_run.elapsed_time = execution.elapsed_time
    workflow_run.total_tokens = execution.total_tokens
    workflow_run.total_steps = execution.total_steps
    workflow_run.finished_at = execution.finished_at
