"""Decode workflow records returned by the LogStore SDK and PostgreSQL protocol."""

import logging
from datetime import UTC, datetime
from typing import Any

from core.ops.utils import JSON_DICT_ADAPTER
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun, WorkflowType

logger = logging.getLogger(__name__)


def safe_float(value: Any, default: float = 0.0) -> float:
    """
    Safely convert a value to float, handling 'null' strings and None.
    """
    if value is None or value in {"null", ""}:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    """
    Safely convert a value to int, handling 'null' strings and None.
    """
    if value is None or value in {"null", ""}:
        return default
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default


def workflow_run_from_log(data: dict[str, Any]) -> WorkflowRun:
    """
    Convert LogStore result dictionary to WorkflowRun instance.

    Args:
        data: Dictionary from LogStore query result

    Returns:
        WorkflowRun instance
    """
    logger.debug("workflow_run_from_log: data keys=%s", list(data.keys())[:5])
    # Create model instance without session
    model = WorkflowRun()

    # Map all required fields with validation
    # Critical fields - must not be None
    model.id = data.get("id") or ""
    model.tenant_id = data.get("tenant_id") or ""
    model.app_id = data.get("app_id") or ""
    model.workflow_id = data.get("workflow_id") or ""
    type_val = data.get("type")
    try:
        model.type = WorkflowType(str(type_val)) if type_val else WorkflowType.WORKFLOW
    except ValueError:
        logger.warning("Invalid type value: %s, falling back to WORKFLOW", type_val)
        model.type = WorkflowType.WORKFLOW
    triggered_from_val = data.get("triggered_from")
    try:
        model.triggered_from = (
            WorkflowRunTriggeredFrom(str(triggered_from_val))
            if triggered_from_val
            else WorkflowRunTriggeredFrom.APP_RUN
        )
    except ValueError:
        logger.warning("Invalid triggered_from value: %s, falling back to APP_RUN", triggered_from_val)
        model.triggered_from = WorkflowRunTriggeredFrom.APP_RUN
    model.version = data.get("version") or ""
    status_val = data.get("status")
    try:
        model.status = WorkflowExecutionStatus(str(status_val)) if status_val else WorkflowExecutionStatus.RUNNING
    except ValueError:
        logger.warning("Invalid status value: %s, falling back to RUNNING", status_val)
        model.status = WorkflowExecutionStatus.RUNNING
    created_by_role_val = data.get("created_by_role")
    try:
        model.created_by_role = (
            CreatorUserRole(str(created_by_role_val)) if created_by_role_val else CreatorUserRole.ACCOUNT
        )
    except ValueError:
        logger.warning("Invalid created_by_role value: %s, falling back to ACCOUNT", created_by_role_val)
        model.created_by_role = CreatorUserRole.ACCOUNT
    model.created_by = data.get("created_by") or ""

    model.total_tokens = safe_int(data.get("total_tokens", 0))
    model.total_steps = safe_int(data.get("total_steps", 0))
    model.exceptions_count = safe_int(data.get("exceptions_count", 0))

    # Optional fields
    model.graph = data.get("graph")
    model.inputs = data.get("inputs")
    model.outputs = data.get("outputs")
    model.error = data.get("error_message") or data.get("error")

    # Handle datetime fields
    # Every branch must yield naive UTC, matching what the database path stores.
    # Mixing naive local time and aware values here breaks the elapsed_time subtraction below.
    started_at = data.get("started_at") or data.get("created_at")
    if started_at:
        match started_at:
            case str():
                model.created_at = ensure_naive_utc(datetime.fromisoformat(started_at))
            case int() | float():
                model.created_at = datetime.fromtimestamp(started_at, tz=UTC).replace(tzinfo=None)
            case _:
                model.created_at = ensure_naive_utc(started_at)
    else:
        # Provide default created_at if missing
        model.created_at = naive_utc_now()

    finished_at = data.get("finished_at") or None
    if finished_at:
        match finished_at:
            case str():
                model.finished_at = ensure_naive_utc(datetime.fromisoformat(finished_at))
            case int() | float():
                model.finished_at = datetime.fromtimestamp(finished_at, tz=UTC).replace(tzinfo=None)
            case _:
                model.finished_at = ensure_naive_utc(finished_at)

    # Compute elapsed_time from started_at and finished_at
    # LogStore doesn't store elapsed_time, it's computed in WorkflowExecution domain entity
    if model.finished_at and model.created_at:
        model.elapsed_time = (model.finished_at - model.created_at).total_seconds()
    else:
        # Use safe conversion to handle 'null' strings and None values
        model.elapsed_time = safe_float(data.get("elapsed_time", 0))

    return model


def node_execution_model_from_log(data: dict[str, Any]) -> WorkflowNodeExecutionModel:
    """
    Convert LogStore result dictionary to WorkflowNodeExecutionModel instance.

    Args:
        data: Dictionary from LogStore query result

    Returns:
        WorkflowNodeExecutionModel instance (detached from session)

    Note:
        The returned model is not attached to any SQLAlchemy session.
        Relationship fields (like offload_data) are not loaded from LogStore.
    """
    logger.debug("node_execution_model_from_log: data keys=%s", list(data.keys())[:5])
    # Create model instance without session
    model = WorkflowNodeExecutionModel()

    # Map all required fields with validation
    # Critical fields - must not be None
    model.id = data.get("id") or ""
    model.tenant_id = data.get("tenant_id") or ""
    model.app_id = data.get("app_id") or ""
    model.workflow_id = data.get("workflow_id") or ""
    triggered_from_val = data.get("triggered_from")
    try:
        model.triggered_from = (
            WorkflowNodeExecutionTriggeredFrom(str(triggered_from_val))
            if triggered_from_val
            else WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        )
    except ValueError:
        logger.warning("Invalid triggered_from value: %s, falling back to WORKFLOW_RUN", triggered_from_val)
        model.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    model.node_id = data.get("node_id") or ""
    model.node_type = data.get("node_type") or ""
    model.status = WorkflowNodeExecutionStatus(data.get("status") or "running")
    model.title = data.get("title") or ""
    created_by_role_val = data.get("created_by_role")
    try:
        model.created_by_role = (
            CreatorUserRole(str(created_by_role_val)) if created_by_role_val else CreatorUserRole.ACCOUNT
        )
    except ValueError:
        logger.warning("Invalid created_by_role value: %s, falling back to ACCOUNT", created_by_role_val)
        model.created_by_role = CreatorUserRole.ACCOUNT
    model.created_by = data.get("created_by") or ""

    model.index = safe_int(data.get("index", 0))
    model.elapsed_time = safe_float(data.get("elapsed_time", 0))

    # Optional fields
    model.workflow_run_id = data.get("workflow_run_id")
    model.predecessor_node_id = data.get("predecessor_node_id")
    model.node_execution_id = data.get("node_execution_id")
    model.inputs = data.get("inputs")
    model.process_data = data.get("process_data")
    model.outputs = data.get("outputs")
    model.error = data.get("error")
    model.execution_metadata = data.get("execution_metadata")

    # Handle datetime fields
    # Every branch must yield naive UTC, matching what the database path stores.
    created_at = data.get("created_at")
    match created_at:
        case None:
            # Provide default created_at if missing
            model.created_at = naive_utc_now()
        case str():
            model.created_at = ensure_naive_utc(datetime.fromisoformat(created_at))
        case int() | float():
            model.created_at = datetime.fromtimestamp(created_at, tz=UTC).replace(tzinfo=None)
        case _:
            model.created_at = ensure_naive_utc(created_at)

    finished_at = data.get("finished_at") or None
    match finished_at:
        case None:
            ...
        case str():
            model.finished_at = ensure_naive_utc(datetime.fromisoformat(finished_at))
        case int() | float():
            model.finished_at = datetime.fromtimestamp(finished_at, tz=UTC).replace(tzinfo=None)
        case _:
            model.finished_at = ensure_naive_utc(finished_at)

    return model


def node_execution_from_log(data: dict[str, Any]) -> WorkflowNodeExecution:
    """
    Convert LogStore result dictionary to WorkflowNodeExecution domain model.

    Args:
        data: Dictionary from LogStore query result

    Returns:
        WorkflowNodeExecution domain model instance
    """
    logger.debug("node_execution_from_log: data keys=%s", list(data.keys())[:5])
    # Parse JSON fields
    inputs = JSON_DICT_ADAPTER.validate_json(data.get("inputs") or "{}")
    process_data = JSON_DICT_ADAPTER.validate_json(data.get("process_data") or "{}")
    outputs = JSON_DICT_ADAPTER.validate_json(data.get("outputs") or "{}")
    metadata = JSON_DICT_ADAPTER.validate_json(data.get("execution_metadata") or "{}")

    # Convert metadata to domain enum keys
    domain_metadata = {}
    for k, v in metadata.items():
        try:
            domain_metadata[WorkflowNodeExecutionMetadataKey(k)] = v
        except ValueError:
            # Skip invalid metadata keys
            continue

    # Convert status to domain enum
    status = WorkflowNodeExecutionStatus(data.get("status", "running"))

    # Parse datetime fields
    created_at = datetime.fromisoformat(data.get("created_at", "")) if data.get("created_at") else datetime.now()
    finished_at = datetime.fromisoformat(data.get("finished_at", "")) if data.get("finished_at") else None

    return WorkflowNodeExecution(
        id=data.get("id", ""),
        node_execution_id=data.get("node_execution_id"),
        workflow_id=data.get("workflow_id", ""),
        workflow_execution_id=data.get("workflow_run_id"),
        index=safe_int(data.get("index", 0)),
        predecessor_node_id=data.get("predecessor_node_id"),
        node_id=data.get("node_id", ""),
        node_type=data.get("node_type", "start"),
        title=data.get("title", ""),
        inputs=inputs,
        process_data=process_data,
        outputs=outputs,
        status=status,
        error=data.get("error"),
        elapsed_time=safe_float(data.get("elapsed_time", 0.0)),
        metadata=domain_metadata,
        created_at=created_at,
        finished_at=finished_at,
    )
