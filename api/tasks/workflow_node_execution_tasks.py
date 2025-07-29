"""
Celery tasks for asynchronous workflow node execution storage operations.

These tasks provide asynchronous storage capabilities for workflow node execution data,
improving performance by offloading storage operations to background workers.
"""

import json
import logging
from typing import Optional

from celery import shared_task  # type: ignore[import-untyped]
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.nodes.enums import NodeType
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from extensions.ext_database import db
from models import CreatorUserRole, WorkflowNodeExecutionModel
from models.workflow import WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


@shared_task(queue="workflow_storage", bind=True, max_retries=3, default_retry_delay=60)
def save_workflow_node_execution_task(
    self,
    execution_data: dict,
    tenant_id: str,
    app_id: str,
    triggered_from: str,
    creator_user_id: str,
    creator_user_role: str,
) -> bool:
    """
    Asynchronously save or update a workflow node execution to the database.

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
        # Create a new session for this task
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

        with session_factory() as session:
            # Deserialize execution data
            execution = WorkflowNodeExecution.model_validate(execution_data)

            # Check if node execution already exists
            existing_execution = session.scalar(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution.id)
            )

            if existing_execution:
                # Update existing node execution
                _update_node_execution_from_domain(existing_execution, execution)
                logger.debug("Updated existing workflow node execution: %s", execution.id)
            else:
                # Create new node execution
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
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2**self.request.retries))


@shared_task(queue="workflow_storage", bind=True, max_retries=3, default_retry_delay=60)
def get_workflow_node_executions_by_workflow_run_task(
    self,
    workflow_run_id: str,
    tenant_id: str,
    app_id: str,
    order_config: Optional[dict] = None,
) -> list[dict]:
    """
    Asynchronously retrieve all workflow node executions for a specific workflow run.

    Args:
        workflow_run_id: The workflow run ID
        tenant_id: Tenant ID for multi-tenancy
        app_id: Application ID
        order_config: Optional ordering configuration

    Returns:
        List of serialized WorkflowNodeExecution data
    """
    try:
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

        with session_factory() as session:
            # Build base query
            query = select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                WorkflowNodeExecutionModel.tenant_id == tenant_id,
                WorkflowNodeExecutionModel.app_id == app_id,
            )

            # Apply ordering if specified
            if order_config:
                order_obj = OrderConfig(
                    order_by=order_config["order_by"], order_direction=order_config.get("order_direction")
                )
                for field_name in order_obj.order_by:
                    field = getattr(WorkflowNodeExecutionModel, field_name, None)
                    if field is not None:
                        if order_obj.order_direction == "desc":
                            query = query.order_by(field.desc())
                        else:
                            query = query.order_by(field.asc())

            node_executions = session.scalars(query).all()

            result = []
            for node_execution in node_executions:
                execution = _create_domain_from_node_execution(node_execution)
                result.append(execution.model_dump())

            return result

    except Exception as e:
        logger.exception("Failed to get workflow node executions for run %s", workflow_run_id)
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2**self.request.retries))


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
    node_execution.triggered_from = triggered_from.value
    node_execution.workflow_run_id = execution.workflow_execution_id
    node_execution.index = execution.index
    node_execution.predecessor_node_id = execution.predecessor_node_id
    node_execution.node_id = execution.node_id
    node_execution.node_type = execution.node_type.value
    node_execution.title = execution.title
    node_execution.node_execution_id = execution.node_execution_id

    # Serialize complex data as JSON
    json_converter = WorkflowRuntimeTypeConverter()
    node_execution.inputs = json.dumps(json_converter.to_json_encodable(execution.inputs)) if execution.inputs else "{}"
    node_execution.process_data = (
        json.dumps(json_converter.to_json_encodable(execution.process_data)) if execution.process_data else "{}"
    )
    node_execution.outputs = (
        json.dumps(json_converter.to_json_encodable(execution.outputs)) if execution.outputs else "{}"
    )
    # Convert metadata enum keys to strings for JSON serialization
    if execution.metadata:
        metadata_for_json = {
            key.value if hasattr(key, "value") else str(key): value for key, value in execution.metadata.items()
        }
        node_execution.execution_metadata = json.dumps(json_converter.to_json_encodable(metadata_for_json))
    else:
        node_execution.execution_metadata = "{}"

    node_execution.status = execution.status.value
    node_execution.error = execution.error
    node_execution.elapsed_time = execution.elapsed_time
    node_execution.created_by_role = creator_user_role.value
    node_execution.created_by = creator_user_id
    node_execution.created_at = execution.created_at
    node_execution.finished_at = execution.finished_at

    return node_execution


def _update_node_execution_from_domain(
    node_execution: WorkflowNodeExecutionModel, execution: WorkflowNodeExecution
) -> None:
    """
    Update a WorkflowNodeExecutionModel database model from a WorkflowNodeExecution domain entity.
    """
    # Update serialized data
    json_converter = WorkflowRuntimeTypeConverter()
    node_execution.inputs = json.dumps(json_converter.to_json_encodable(execution.inputs)) if execution.inputs else "{}"
    node_execution.process_data = (
        json.dumps(json_converter.to_json_encodable(execution.process_data)) if execution.process_data else "{}"
    )
    node_execution.outputs = (
        json.dumps(json_converter.to_json_encodable(execution.outputs)) if execution.outputs else "{}"
    )
    # Convert metadata enum keys to strings for JSON serialization
    if execution.metadata:
        metadata_for_json = {
            key.value if hasattr(key, "value") else str(key): value for key, value in execution.metadata.items()
        }
        node_execution.execution_metadata = json.dumps(json_converter.to_json_encodable(metadata_for_json))
    else:
        node_execution.execution_metadata = "{}"

    # Update other fields
    node_execution.status = execution.status.value
    node_execution.error = execution.error
    node_execution.elapsed_time = execution.elapsed_time
    node_execution.finished_at = execution.finished_at


def _create_domain_from_node_execution(node_execution: WorkflowNodeExecutionModel) -> WorkflowNodeExecution:
    """
    Create a WorkflowNodeExecution domain entity from a WorkflowNodeExecutionModel database model.
    """
    # Deserialize JSON data
    inputs = json.loads(node_execution.inputs or "{}")
    process_data = json.loads(node_execution.process_data or "{}")
    outputs = json.loads(node_execution.outputs or "{}")
    metadata = json.loads(node_execution.execution_metadata or "{}")

    # Convert metadata keys to enum values
    typed_metadata = {}
    for key, value in metadata.items():
        try:
            enum_key = WorkflowNodeExecutionMetadataKey(key)
            typed_metadata[enum_key] = value
        except ValueError:
            # Skip unknown metadata keys
            continue

    return WorkflowNodeExecution(
        id=node_execution.id,
        node_execution_id=node_execution.node_execution_id,
        workflow_id=node_execution.workflow_id,
        workflow_execution_id=node_execution.workflow_run_id,
        index=node_execution.index,
        predecessor_node_id=node_execution.predecessor_node_id,
        node_id=node_execution.node_id,
        node_type=NodeType(node_execution.node_type),
        title=node_execution.title,
        inputs=inputs if inputs else None,
        process_data=process_data if process_data else None,
        outputs=outputs if outputs else None,
        status=WorkflowNodeExecutionStatus(node_execution.status),
        error=node_execution.error,
        elapsed_time=node_execution.elapsed_time,
        metadata=typed_metadata if typed_metadata else None,
        created_at=node_execution.created_at,
        finished_at=node_execution.finished_at,
    )
