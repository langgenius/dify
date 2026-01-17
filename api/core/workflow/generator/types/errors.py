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
    """
    Specific error codes for workflow generation.

    System errors:
        MODEL_UNAVAILABLE: LLM model is not available
        RATE_LIMITED: Rate limit exceeded for LLM API
        DATABASE_ERROR: Database operation failed
        NETWORK_ERROR: Network connectivity issue

    User errors:
        INVALID_INPUT: User provided invalid input
        MISSING_CONFIGURATION: Required configuration is missing
        UNAUTHORIZED: User lacks required permissions

    Generation errors:
        VALIDATION_FAILED: Generated workflow failed validation
        TIMEOUT: Workflow generation timed out
        CONTEXT_TOO_LARGE: Context exceeds model limits
    """

    # System errors
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    RATE_LIMITED = "RATE_LIMITED"
    DATABASE_ERROR = "DATABASE_ERROR"
    NETWORK_ERROR = "NETWORK_ERROR"

    # User errors
    INVALID_INPUT = "INVALID_INPUT"
    MISSING_CONFIGURATION = "MISSING_CONFIGURATION"
    UNAUTHORIZED = "UNAUTHORIZED"

    # Generation errors
    VALIDATION_FAILED = "VALIDATION_FAILED"
    TIMEOUT = "TIMEOUT"
    CONTEXT_TOO_LARGE = "CONTEXT_TOO_LARGE"


class WorkflowGenerationError(BaseModel):
    """
    Structured error for workflow generation failures.

    Attributes:
        type: Error type category
        code: Specific error code
        message: Human-readable error message
        is_retryable: Whether the operation can be retried
        details: Additional error context
        suggestions: User-facing suggestions for resolution
    """

    type: ErrorType
    code: ErrorCode
    message: str
    is_retryable: bool = False
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
            "details": self.details,
            "suggestions": self.suggestions,
        }


# ============================================================
# Helper functions for common error scenarios
# ============================================================


def model_unavailable_error(
    model_name: str,
    provider: str | None = None,
    details: dict[str, Any] | None = None,
) -> WorkflowGenerationError:
    """
    Create a model unavailable error.

    Args:
        model_name: Name of the unavailable model
        provider: Model provider name
        details: Additional error details

    Returns:
        WorkflowGenerationError for model unavailability
    """
    provider_info = f" from {provider}" if provider else ""
    return WorkflowGenerationError(
        type=ErrorType.SYSTEM_ERROR,
        code=ErrorCode.MODEL_UNAVAILABLE,
        message=f"Model '{model_name}'{provider_info} is not available",
        is_retryable=True,
        details=details or {"model": model_name, "provider": provider},
        suggestions=[
            "Check if the model is configured correctly",
            "Verify model provider credentials",
            "Try using a different model",
        ],
    )


def rate_limited_error(
    retry_after: int | None = None,
    details: dict[str, Any] | None = None,
) -> WorkflowGenerationError:
    """
    Create a rate limit error.

    Args:
        retry_after: Seconds until retry is allowed
        details: Additional error details

    Returns:
        WorkflowGenerationError for rate limiting
    """
    retry_msg = f" Retry after {retry_after} seconds." if retry_after else ""
    return WorkflowGenerationError(
        type=ErrorType.SYSTEM_ERROR,
        code=ErrorCode.RATE_LIMITED,
        message=f"Rate limit exceeded.{retry_msg}",
        is_retryable=True,
        details=details or {"retry_after": retry_after},
        suggestions=[
            "Wait before retrying the request",
            "Consider using a different model provider",
            "Check your API quota and limits",
        ],
    )


def validation_failed_error(
    validation_errors: list[str] | None = None,
    details: dict[str, Any] | None = None,
) -> WorkflowGenerationError:
    """
    Create a validation failed error.

    Args:
        validation_errors: List of validation error messages
        details: Additional error details

    Returns:
        WorkflowGenerationError for validation failures
    """
    errors = validation_errors or []
    error_list = "; ".join(errors) if errors else "Unknown validation error"
    return WorkflowGenerationError(
        type=ErrorType.GENERATION_ERROR,
        code=ErrorCode.VALIDATION_FAILED,
        message=f"Workflow validation failed: {error_list}",
        is_retryable=True,
        details=details or {"validation_errors": errors},
        suggestions=[
            "Review the generated workflow structure",
            "Check node configurations",
            "Verify all required fields are present",
        ],
    )
