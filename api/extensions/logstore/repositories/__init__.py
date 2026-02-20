"""
LogStore repository utilities.

This module provides shared utility functions and converters for LogStore repositories.
It serves as a common layer to avoid circular dependencies between repository implementations.
"""

import logging
from datetime import datetime
from typing import Any

from models.workflow import WorkflowNodeExecutionModel

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


def dict_to_workflow_node_execution_model(data: dict[str, Any]) -> WorkflowNodeExecutionModel:
    """
    Convert LogStore result dictionary to WorkflowNodeExecutionModel instance.

    This function is shared across LogStore repositories to ensure consistent
    conversion from LogStore data format to the database model.

    Args:
        data: Dictionary from LogStore query result

    Returns:
        WorkflowNodeExecutionModel instance (detached from session)

    Note:
        The returned model is not attached to any SQLAlchemy session.
        Relationship fields (like offload_data) are not loaded from LogStore.
    """
    logger.debug("dict_to_workflow_node_execution_model: data keys=%s", list(data.keys())[:5])
    # Create model instance without session
    model = WorkflowNodeExecutionModel()

    # Map all required fields with validation
    # Critical fields - must not be None
    model.id = data.get("id") or ""
    model.tenant_id = data.get("tenant_id") or ""
    model.app_id = data.get("app_id") or ""
    model.workflow_id = data.get("workflow_id") or ""
    model.triggered_from = data.get("triggered_from") or ""
    model.node_id = data.get("node_id") or ""
    model.node_type = data.get("node_type") or ""
    model.status = data.get("status") or "running"  # Default status if missing
    model.title = data.get("title") or ""
    model.created_by_role = data.get("created_by_role") or ""
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
    created_at = data.get("created_at")
    if created_at and created_at not in {"null", ""}:
        if isinstance(created_at, str):
            model.created_at = datetime.fromisoformat(created_at)
        elif isinstance(created_at, (int, float)):
            model.created_at = datetime.fromtimestamp(created_at)
        else:
            model.created_at = created_at
    else:
        # Provide default created_at if missing
        model.created_at = datetime.now()

    finished_at = data.get("finished_at")
    if finished_at and finished_at not in {"null", ""}:
        if isinstance(finished_at, str):
            model.finished_at = datetime.fromisoformat(finished_at)
        elif isinstance(finished_at, (int, float)):
            model.finished_at = datetime.fromtimestamp(finished_at)
        else:
            model.finished_at = finished_at

    return model
