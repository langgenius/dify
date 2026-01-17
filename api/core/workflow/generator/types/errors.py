"""
Error types and helper functions for workflow generation.

This module provides:
- ErrorType enum for categorizing errors
- ErrorCode enum for specific error conditions
- WorkflowGenerationError Pydantic model for structured error handling
- Helper functions for common error scenarios
"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ErrorType(StrEnum):
    """
    Error type categories.

    Attributes:
        SYSTEM_ERROR: Infrastructure/system-level errors (DB, network, etc.)
        USER_ERROR: User input or configuration errors
        GENERATION_ERROR: LLM generation or workflow building errors
    """

    SYSTEM_ERROR = "system_error"
    USER_ERROR = "user_error"
    GENERATION_ERROR = "generation_error"


class ErrorCode(StrEnum):
    """Specific error codes for programmatic handling."""
    # System errors
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    RATE_LIMITED = "RATE_LIMITED"
    PROVIDER_ERROR = "PROVIDER_ERROR"

    # User errors
    INVALID_INSTRUCTION = "INVALID_INSTRUCTION"
    MISSING_CONFIG = "MISSING_CONFIG"
    OFF_TOPIC = "OFF_TOPIC"

    # Generation errors
    PLANNING_FAILED = "PLANNING_FAILED"
    BUILDING_FAILED = "BUILDING_FAILED"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    GRAPH_DISCONNECTED = "GRAPH_DISCONNECTED"
    JSON_PARSE_FAILED = "JSON_PARSE_FAILED"
    MAX_RETRIES_EXCEEDED = "MAX_RETRIES_EXCEEDED"


class WorkflowGenerationError(BaseModel):
    """
    Structured error for workflow generation failures.

    Attributes:
        type: Error type category
        code: Specific error code
        message: Human-readable error message
        is_retryable: Whether the operation can be retried
        severity: Error severity level (error | warning)
        details: Additional error context
        suggestions: User-facing suggestions for resolution
    """

    type: ErrorType
    code: ErrorCode
    message: str
    is_retryable: bool = False
    severity: str = Field(default="error")  # error | warning
    details: dict[str, Any] = Field(default_factory=dict)
    suggestions: list[str] = Field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """
        Convert error to dictionary format.

        Returns:
            Dictionary representation of the error
        """
        return {
            "type": self.type.value,
            "code": self.code.value,
            "message": self.message,
            "is_retryable": self.is_retryable,
            "severity": self.severity,
            "details": self.details,
            "suggestions": self.suggestions,
        }


# ============================================================
# Helper functions for common error scenarios
# ============================================================


def model_unavailable_error(provider: str, model: str) -> WorkflowGenerationError:
    return WorkflowGenerationError(
        type=ErrorType.SYSTEM_ERROR,
        code=ErrorCode.MODEL_UNAVAILABLE,
        message=f"Model {provider}/{model} is not available",
        is_retryable=False,
        suggestions=["Configure the model in Settings", "Choose a different model"],
    )


def rate_limited_error(retry_after: int | None = None) -> WorkflowGenerationError:
    return WorkflowGenerationError(
        type=ErrorType.SYSTEM_ERROR,
        code=ErrorCode.RATE_LIMITED,
        message="Rate limit exceeded",
        is_retryable=True,
        details={"retry_after": retry_after} if retry_after else {},
        suggestions=["Wait and try again"],
    )


def validation_failed_error(errors: list[dict]) -> WorkflowGenerationError:
    return WorkflowGenerationError(
        type=ErrorType.GENERATION_ERROR,
        code=ErrorCode.VALIDATION_FAILED,
        message=f"Workflow validation failed with {len(errors)} error(s)",
        is_retryable=True,
        details={"validation_errors": errors},
        suggestions=["Review the generated workflow", "Try simplifying your request"],
    )
