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
from core.workflow.generator.types import (  # noqa: F401
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
    AvailableTool,
    ErrorCode,
    ErrorType,
    GenerationResult,
    ToolParameter,
    WorkflowData,
    WorkflowEdge,
    WorkflowGenerationError,
    WorkflowNode,
    model_unavailable_error,
    rate_limited_error,
    validation_failed_error,
)
