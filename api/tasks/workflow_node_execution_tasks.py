"""
Celery tasks for asynchronous workflow node execution storage operations.

These tasks provide asynchronous storage capabilities for workflow node execution data,
improving performance by offloading storage operations to background workers.
"""

import json
import logging
from typing import TYPE_CHECKING, Any

from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecution,
)
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
from models import Account, CreatorUserRole, EndUser, WorkflowNodeExecutionModel
from models.workflow import WorkflowNodeExecutionTriggeredFrom

if TYPE_CHECKING:
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )

logger = logging.getLogger(__name__)


@shared_task(queue="workflow_storage", bind=True, max_retries=3, default_retry_delay=60)
def save_workflow_node_execution_task(
    self,
    execution_data: dict[str, Any],
    tenant_id: str,
    app_id: str,
    triggered_from: str,
    creator_user_id: str,
    creator_user_role: str,
) -> bool:
    """
    Asynchronously save or update workflow node execution metadata to the database.

    Args:
        execution_data: Serialized WorkflowNodeExecution data
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
            execution = WorkflowNodeExecution.model_validate(execution_data)

            existing_execution = session.scalar(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution.id)
            )

            if existing_execution:
                _update_node_execution_metadata(existing_execution, execution)
                logger.debug("Updated existing workflow node execution metadata: %s", execution.id)
            else:
                node_execution = _create_node_execution_from_domain(
                    execution=execution,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    triggered_from=WorkflowNodeExecutionTriggeredFrom(triggered_from),
                    creator_user_id=creator_user_id,
                    creator_user_role=CreatorUserRole(creator_user_role),
                )
                session.add(node_execution)
                logger.debug("Created new workflow node execution: %s", execution.id)

            session.commit()
            return True

    except Exception as e:
        logger.exception("Failed to save workflow node execution %s", execution_data.get("id", "unknown"))
        raise self.retry(exc=e, countdown=60 * (2**self.request.retries))


@shared_task(queue="workflow_storage", bind=True, max_retries=3, default_retry_delay=60)
def save_workflow_node_execution_data_task(
    self,
    execution_data: dict[str, Any],
    tenant_id: str,
    app_id: str,
    triggered_from: str,
    creator_user_id: str,
    creator_user_role: str,
) -> bool:
    """
    Asynchronously save full workflow node execution data to the database.

    This path preserves the SQLAlchemy repository's truncation and offload behavior while
    moving the blocking database and storage work out of the workflow engine thread.
    """
    try:
        execution = WorkflowNodeExecution.model_validate(execution_data)
        repository = _create_sqlalchemy_repository(
            tenant_id=tenant_id,
            app_id=app_id,
            triggered_from=triggered_from,
            creator_user_id=creator_user_id,
            creator_user_role=creator_user_role,
        )
        repository.save(execution)
        repository.save_execution_data(execution)
        return True
    except Exception as e:
        logger.exception("Failed to save workflow node execution data %s", execution_data.get("id", "unknown"))
        raise self.retry(exc=e, countdown=60 * (2**self.request.retries))


def _create_sqlalchemy_repository(
    *,
    tenant_id: str,
    app_id: str,
    triggered_from: str,
    creator_user_id: str,
    creator_user_role: str,
) -> "SQLAlchemyWorkflowNodeExecutionRepository":
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )

    session_maker = session_factory.get_session_maker()
    role = CreatorUserRole(creator_user_role)
    user: Account | EndUser | None
    with session_maker() as session:
        if role == CreatorUserRole.ACCOUNT:
            user = session.get(Account, creator_user_id)
            if user is not None:
                user.set_tenant_id(tenant_id)
        else:
            user = session.get(EndUser, creator_user_id)

    if user is None:
        raise ValueError(f"Creator user {creator_user_id} not found for workflow node execution persistence")

    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=session_maker,
        user=user,
        app_id=app_id or None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom(triggered_from),
    )


def _create_node_execution_from_domain(
    execution: WorkflowNodeExecution,
    tenant_id: str,
    app_id: str,
    triggered_from: WorkflowNodeExecutionTriggeredFrom,
    creator_user_id: str,
    creator_user_role: CreatorUserRole,
) -> WorkflowNodeExecutionModel:
    """
    Create a WorkflowNodeExecutionModel database model from a WorkflowNodeExecution domain entity.
    """
    node_execution = WorkflowNodeExecutionModel()
    node_execution.id = execution.id
    node_execution.tenant_id = tenant_id
    node_execution.app_id = app_id
    node_execution.workflow_id = execution.workflow_id
    node_execution.triggered_from = triggered_from
    node_execution.workflow_run_id = execution.workflow_execution_id
    node_execution.index = execution.index
    node_execution.predecessor_node_id = execution.predecessor_node_id
    node_execution.node_id = execution.node_id
    node_execution.node_type = execution.node_type
    node_execution.title = execution.title
    node_execution.node_execution_id = execution.node_execution_id

    node_execution.inputs = "{}"
    node_execution.process_data = "{}"
    node_execution.outputs = "{}"

    json_converter = WorkflowRuntimeTypeConverter()
    if execution.metadata:
        metadata_for_json = {
            key.value if hasattr(key, "value") else str(key): value for key, value in execution.metadata.items()
        }
        node_execution.execution_metadata = json.dumps(json_converter.to_json_encodable(metadata_for_json))
    else:
        node_execution.execution_metadata = "{}"

    node_execution.status = execution.status
    node_execution.error = execution.error
    node_execution.elapsed_time = execution.elapsed_time
    node_execution.created_by_role = creator_user_role
    node_execution.created_by = creator_user_id
    node_execution.created_at = execution.created_at
    node_execution.finished_at = execution.finished_at

    return node_execution


def _update_node_execution_metadata(node_execution: WorkflowNodeExecutionModel, execution: WorkflowNodeExecution):
    """
    Update WorkflowNodeExecutionModel metadata without changing persisted data payload fields.
    """
    json_converter = WorkflowRuntimeTypeConverter()
    if execution.metadata:
        metadata_for_json = {
            key.value if hasattr(key, "value") else str(key): value for key, value in execution.metadata.items()
        }
        node_execution.execution_metadata = json.dumps(json_converter.to_json_encodable(metadata_for_json))
    else:
        node_execution.execution_metadata = "{}"

    node_execution.status = execution.status
    node_execution.error = execution.error
    node_execution.elapsed_time = execution.elapsed_time
    node_execution.finished_at = execution.finished_at
