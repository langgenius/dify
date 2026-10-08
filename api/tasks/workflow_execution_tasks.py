"""
Celery tasks for asynchronous workflow execution storage operations.

These tasks provide asynchronous storage capabilities for workflow execution data,
improving performance by offloading storage operations to background workers.
"""

import json
import logging
from typing import Any

from celery import shared_task

from core.db.session_factory import session_factory
from graphon.entities import WorkflowExecution
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
from models import CreatorUserRole, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from repositories.workflow.execution_write_repository import save_workflow_run

logger = logging.getLogger(__name__)


@shared_task(queue="workflow_storage", bind=True, max_retries=3, default_retry_delay=60)
def save_workflow_execution_task(
    self,
    execution_data: dict[str, Any],
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

            workflow_run = _create_workflow_run_from_execution(
                execution=execution,
                tenant_id=tenant_id,
                app_id=app_id,
                triggered_from=WorkflowRunTriggeredFrom(triggered_from),
                creator_user_id=creator_user_id,
                creator_user_role=CreatorUserRole(creator_user_role),
            )
            if not save_workflow_run(session, workflow_run):
                logger.debug("Ignored stale workflow run update: %s", execution.id_)
                return True

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
    from models.workflow import WorkflowType as ModelWorkflowType

    workflow_run.type = ModelWorkflowType(execution.workflow_type.value)
    workflow_run.triggered_from = triggered_from
    workflow_run.version = execution.workflow_version
    json_converter = WorkflowRuntimeTypeConverter()
    workflow_run.graph = json.dumps(json_converter.to_json_encodable(execution.graph), ensure_ascii=False)
    workflow_run.inputs = json.dumps(json_converter.to_json_encodable(execution.inputs), ensure_ascii=False)
    workflow_run.status = execution.status
    workflow_run.outputs = (
        json.dumps(json_converter.to_json_encodable(execution.outputs), ensure_ascii=False)
        if execution.outputs
        else "{}"
    )
    workflow_run.error = execution.error_message
    workflow_run.elapsed_time = execution.elapsed_time
    workflow_run.total_tokens = execution.total_tokens
    workflow_run.total_steps = execution.total_steps
    workflow_run.exceptions_count = execution.exceptions_count
    workflow_run.created_by_role = creator_user_role
    workflow_run.created_by = creator_user_id
    workflow_run.created_at = execution.started_at
    workflow_run.finished_at = execution.finished_at

    return workflow_run
