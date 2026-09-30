"""
Celery tasks for asynchronous workflow node execution storage operations.

These tasks provide asynchronous storage capabilities for workflow node execution data,
improving performance by offloading storage operations to background workers.
"""

import json
import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from sqlalchemy import select

from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from core.db.session_factory import session_factory
from core.workflow.node_execution_process_data import preserve_workflow_agent_binding_id
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecution,
)
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
from libs.datetime_utils import ensure_naive_utc
from models import CreatorUserRole, WorkflowNodeExecutionModel
from models.workflow import WorkflowNodeExecutionTriggeredFrom

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
        with session_factory.create_session() as session:
            # Deserialize execution data
            execution = WorkflowNodeExecution.model_validate(execution_data)

            # Check if node execution already exists
            existing_execution = session.scalar(
                WorkflowNodeExecutionModel.preload_offload_data(select(WorkflowNodeExecutionModel))
                .where(WorkflowNodeExecutionModel.id == execution.id)
                .with_for_update()
            )

            if existing_execution:
                if (
                    existing_execution.tenant_id != tenant_id
                    or existing_execution.app_id != app_id
                    or existing_execution.workflow_id != execution.workflow_id
                    or existing_execution.workflow_run_id != execution.workflow_execution_id
                ):
                    raise ValueError("Unauthorized access to workflow node execution")
                if not _advances_execution(existing_execution, execution):
                    return True
                # Update existing node execution
                existing_execution.created_at = execution.created_at
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


def _advances_execution(stored: WorkflowNodeExecutionModel, incoming: WorkflowNodeExecution) -> bool:
    """Apply lifecycle progress once, even when the broker reorders snapshots.

    Paused nodes retain their ID on resume, with a new attempt version. Completed
    attempts cannot be restarted by delayed messages. Data corrections and
    offloading are owned by the synchronous `save_execution_data` operation.
    The version is the engine's lossless start time stored in JSON metadata;
    database DATETIME columns can round or truncate fractional seconds.
    """
    pending = WorkflowNodeExecutionStatus.PENDING
    running = WorkflowNodeExecutionStatus.RUNNING
    retrying = WorkflowNodeExecutionStatus.RETRY
    paused = WorkflowNodeExecutionStatus.PAUSED
    if stored.status not in (pending, running, retrying, paused):
        return False
    incoming_start = ensure_naive_utc(incoming.created_at)
    incoming_version = incoming_start.isoformat(timespec="microseconds")
    stored_version = stored.execution_attempt_version
    if stored_version is not None and incoming_version != stored_version:
        # Resume can arrive before its preceding pause snapshot.
        return incoming_version > stored_version
    if stored_version is None:
        # Legacy rows have no lossless version. Within their one-second precision
        # window, only state progression is safe; do not mistake rounding for resume.
        stored_start = ensure_naive_utc(stored.created_at)
        if incoming_start <= stored_start - timedelta(seconds=1):
            return False
        if incoming_start >= stored_start + timedelta(seconds=1):
            return True
    if stored.status == pending:
        return incoming.status != pending
    if stored.status == running:
        return incoming.status not in (pending, running)
    if stored.status != retrying or incoming.status in (pending, running):
        return False
    if incoming.status != retrying:
        return True
    # An offloaded retry history is only a preview. Its synchronous writer owns
    # subsequent retry data; queued snapshots must not replace that preview.
    if stored.process_data_truncated:
        return False
    stored_history = (stored.process_data_dict or {}).get(RETRY_HISTORY_PROCESS_DATA_KEY, [])
    incoming_history = (incoming.process_data or {}).get(RETRY_HISTORY_PROCESS_DATA_KEY, [])
    return len(incoming_history) > len(stored_history)


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
    node_execution.set_execution_attempt(execution.created_at)

    node_execution.status = execution.status
    node_execution.error = execution.error
    node_execution.elapsed_time = execution.elapsed_time
    node_execution.created_by_role = creator_user_role
    node_execution.created_by = creator_user_id
    node_execution.created_at = execution.created_at
    node_execution.finished_at = execution.finished_at

    return node_execution


def _update_node_execution_from_domain(node_execution: WorkflowNodeExecutionModel, execution: WorkflowNodeExecution):
    """
    Update a WorkflowNodeExecutionModel database model from a WorkflowNodeExecution domain entity.
    """
    # Update serialized data
    json_converter = WorkflowRuntimeTypeConverter()
    node_execution.inputs = json.dumps(json_converter.to_json_encodable(execution.inputs)) if execution.inputs else "{}"
    process_data = preserve_workflow_agent_binding_id(node_execution.process_data_dict, execution.process_data)
    node_execution.process_data = (
        json.dumps(json_converter.to_json_encodable(process_data)) if process_data is not None else "{}"
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
    node_execution.set_execution_attempt(execution.created_at)

    # Update other fields
    node_execution.status = execution.status
    node_execution.error = execution.error
    node_execution.elapsed_time = execution.elapsed_time
    node_execution.finished_at = execution.finished_at
