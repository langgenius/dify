"""
Backward compatibility layer.

DEPRECATED: Import from core.workflow.generator.types instead.
"""

import warnings

warnings.warn(
    "Importing from core.workflow.generator.types (the file) is deprecated. "
    "Use core.workflow.generator.types (the package) instead.",
    DeprecationWarning,
    stacklevel=2,
)

# Re-export everything for backward compatibility
from core.workflow.generator.types import (
    INITIAL_RETRY_DELAY_MS,
    INTENT_ERROR,
    INTENT_GENERATE,
    INTENT_OFF_TOPIC,
    MAX_RETRIES,
    MODEL_REQUIRED_NODE_TYPES,
    PLACEHOLDER_VALUE,
    STABILITY_WARNING_EN,
    STABILITY_WARNING_ZH,
    TEMPERATURE_DEFAULT,
    TEMPERATURE_HIGH,
    TEMPERATURE_LOW,
    AvailableModel,
    AvailableModelDict,
    AvailableTool,
    AvailableToolDict,
    ErrorCode,
    ErrorType,
    GenerationResult,
    ToolParameter,
    ToolParameterDict,
    WorkflowData,
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
    "INITIAL_RETRY_DELAY_MS",
    "INTENT_ERROR",
    "INTENT_GENERATE",
    "INTENT_OFF_TOPIC",
    "MAX_RETRIES",
    "MODEL_REQUIRED_NODE_TYPES",
    "PLACEHOLDER_VALUE",
    "STABILITY_WARNING_EN",
    "STABILITY_WARNING_ZH",
    "TEMPERATURE_DEFAULT",
    "TEMPERATURE_HIGH",
    "TEMPERATURE_LOW",
    "AvailableModel",
    "AvailableModelDict",
    "AvailableTool",
    "AvailableToolDict",
    "ErrorCode",
    "ErrorType",
    "GenerationResult",
    "ToolParameter",
    "ToolParameterDict",
    "WorkflowData",
    "WorkflowEdge",
    "WorkflowEdgeDict",
    "WorkflowGenerationError",
    "WorkflowNode",
    "WorkflowNodeDict",
    "model_unavailable_error",
    "rate_limited_error",
    "validation_failed_error",
]
