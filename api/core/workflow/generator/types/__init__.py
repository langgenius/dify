"""Type definitions for Workflow Generator."""

# Error types
# Backward compatibility aliases for dictionary representations
# DEPRECATED: Migrate to using Pydantic models directly
# These represent the dictionary form of the Pydantic models
from typing import Any

# Constants
from core.workflow.generator.types.constants import (
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
)
from core.workflow.generator.types.errors import (
    ErrorCode,
    ErrorType,
    WorkflowGenerationError,
    model_unavailable_error,
    rate_limited_error,
    validation_failed_error,
)

# Models
from core.workflow.generator.types.models import (
    AvailableModel,
    AvailableTool,
    GenerationResult,
    ToolParameter,
    WorkflowData,
    WorkflowEdge,
    WorkflowNode,
)

WorkflowNodeDict = dict[str, Any]  # Use WorkflowNode.model_validate(data) for validation
WorkflowEdgeDict = dict[str, Any]  # Use WorkflowEdge.model_validate(data) for validation
AvailableModelDict = dict[str, Any]  # Use AvailableModel.model_validate(data) for validation
ToolParameterDict = dict[str, Any]  # Use ToolParameter.model_validate(data) for validation
AvailableToolDict = dict[str, Any]  # Use AvailableTool.model_validate(data) for validation
WorkflowDataDict = dict[str, Any]  # Use WorkflowData.model_validate(data) for validation

__all__ = [
    "AvailableModel",
    "AvailableModelDict",
    "AvailableTool",
    "AvailableToolDict",
    "ErrorCode",
    "ErrorType",
    "GenerationResult",
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
