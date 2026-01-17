"""
DEPRECATED: This module is kept for backward compatibility only.
Please import from core.workflow.generator.types package instead.

This module re-exports all types from the types package.
The actual definitions have been moved to:
- core.workflow.generator.types/__init__.py (TypedDict and Pydantic models)
- core.workflow.generator.types/errors.py (Error types)
- core.workflow.generator.types/constants.py (Constants)
"""

# Re-export everything from the types package for backward compatibility
from core.workflow.generator.types import (
    INTENT_CLASSIFICATION_MAX_TOKENS,
    INTENT_CLASSIFICATION_MODEL_NAME,
    INTENT_CLASSIFICATION_MODEL_PROVIDER,
    INTENT_CLASSIFICATION_TEMPERATURE,
    MAX_RETRIES,
    PLACEHOLDER_VALUE,
    TEMPERATURE_DEFAULT,
    TEMPERATURE_MAX,
    TEMPERATURE_MIN,
    AvailableModel,
    AvailableModelDict,
    AvailableTool,
    AvailableToolDict,
    ErrorCode,
    ErrorType,
    ToolParameter,
    ToolParameterDict,
    WorkflowData,
    WorkflowDataDict,
    WorkflowEdge,
    WorkflowEdgeDict,
    WorkflowGenerationError,
    WorkflowNode,
    WorkflowNodeDict,
    model_unavailable_error,
    rate_limited_error,
    validation_failed_error,
)

__all__ = [
    "AvailableModel",
    "AvailableModelDict",
    "AvailableTool",
    "AvailableToolDict",
    "ErrorCode",
    "ErrorType",
    "INTENT_CLASSIFICATION_MAX_TOKENS",
    "INTENT_CLASSIFICATION_MODEL_NAME",
    "INTENT_CLASSIFICATION_MODEL_PROVIDER",
    "INTENT_CLASSIFICATION_TEMPERATURE",
    "MAX_RETRIES",
    "PLACEHOLDER_VALUE",
    "TEMPERATURE_DEFAULT",
    "TEMPERATURE_MAX",
    "TEMPERATURE_MIN",
    "ToolParameter",
    "ToolParameterDict",
    "WorkflowData",
    "WorkflowDataDict",
    "WorkflowEdge",
    "WorkflowEdgeDict",
    "WorkflowGenerationError",
    "WorkflowNode",
    "WorkflowNodeDict",
    "model_unavailable_error",
    "rate_limited_error",
    "validation_failed_error",
]
