"""Tests for workflow generator error types."""


from core.workflow.generator.types.errors import (
    ErrorCode,
    ErrorType,
    WorkflowGenerationError,
    model_unavailable_error,
    rate_limited_error,
    validation_failed_error,
)


def test_workflow_generation_error_creation():
    """Test creating a WorkflowGenerationError with all fields."""
    error = WorkflowGenerationError(
        type=ErrorType.GENERATION_ERROR,
        code=ErrorCode.VALIDATION_FAILED,
        message="Workflow validation failed",
        is_retryable=True,
        details={"node_id": "llm_1"},
        suggestions=["Check model configuration"],
    )
    assert error.type == ErrorType.GENERATION_ERROR
    assert error.code == ErrorCode.VALIDATION_FAILED
    assert error.message == "Workflow validation failed"
    assert error.is_retryable is True
    assert error.details == {"node_id": "llm_1"}
    assert error.suggestions == ["Check model configuration"]


def test_workflow_generation_error_defaults():
    """Test WorkflowGenerationError with default values."""
    error = WorkflowGenerationError(
        type=ErrorType.SYSTEM_ERROR,
        code=ErrorCode.MODEL_UNAVAILABLE,
        message="Model not available",
    )
    assert error.is_retryable is False
    assert error.details == {}
    assert error.suggestions == []


def test_error_to_dict():
    """Test converting WorkflowGenerationError to dictionary."""
    error = WorkflowGenerationError(
        type=ErrorType.SYSTEM_ERROR,
        code=ErrorCode.MODEL_UNAVAILABLE,
        message="Model not available",
        is_retryable=False,
    )
    result = error.to_dict()
    assert result["type"] == "system_error"
    assert result["code"] == "MODEL_UNAVAILABLE"
    assert result["message"] == "Model not available"
    assert result["is_retryable"] is False
    assert result["details"] == {}
    assert result["suggestions"] == []


def test_error_to_dict_with_details():
    """Test to_dict with details and suggestions."""
    error = WorkflowGenerationError(
        type=ErrorType.USER_ERROR,
        code=ErrorCode.INVALID_INPUT,
        message="Invalid input provided",
        is_retryable=False,
        details={"field": "model_config", "value": None},
        suggestions=["Provide a valid model configuration"],
    )
    result = error.to_dict()
    assert result["details"] == {"field": "model_config", "value": None}
    assert result["suggestions"] == ["Provide a valid model configuration"]


def test_model_unavailable_error():
    """Test model_unavailable_error helper function."""
    error = model_unavailable_error("gpt-4", "openai")
    assert error.type == ErrorType.SYSTEM_ERROR
    assert error.code == ErrorCode.MODEL_UNAVAILABLE
    assert "gpt-4" in error.message
    assert "openai" in error.message
    assert error.is_retryable is True
    assert error.details["model"] == "gpt-4"
    assert error.details["provider"] == "openai"
    assert len(error.suggestions) > 0


def test_model_unavailable_error_without_provider():
    """Test model_unavailable_error without provider."""
    error = model_unavailable_error("claude-3")
    assert "claude-3" in error.message
    assert error.details["model"] == "claude-3"
    assert error.details["provider"] is None


def test_model_unavailable_error_with_custom_details():
    """Test model_unavailable_error with custom details."""
    custom_details = {"model": "gpt-4", "provider": "openai", "error_code": "503"}
    error = model_unavailable_error("gpt-4", "openai", custom_details)
    assert error.details == custom_details


def test_rate_limited_error():
    """Test rate_limited_error helper function."""
    error = rate_limited_error(retry_after=60)
    assert error.type == ErrorType.SYSTEM_ERROR
    assert error.code == ErrorCode.RATE_LIMITED
    assert "60" in error.message
    assert error.is_retryable is True
    assert error.details["retry_after"] == 60
    assert len(error.suggestions) > 0


def test_rate_limited_error_without_retry_after():
    """Test rate_limited_error without retry_after."""
    error = rate_limited_error()
    assert "Rate limit exceeded" in error.message
    assert error.details["retry_after"] is None


def test_rate_limited_error_with_custom_details():
    """Test rate_limited_error with custom details."""
    custom_details = {"retry_after": 120, "quota_reset": "2026-01-17T10:00:00Z"}
    error = rate_limited_error(retry_after=120, details=custom_details)
    assert error.details == custom_details


def test_validation_failed_error():
    """Test validation_failed_error helper function."""
    errors = ["Missing required field: model", "Invalid node type: unknown"]
    error = validation_failed_error(validation_errors=errors)
    assert error.type == ErrorType.GENERATION_ERROR
    assert error.code == ErrorCode.VALIDATION_FAILED
    assert "Missing required field" in error.message
    assert "Invalid node type" in error.message
    assert error.is_retryable is True
    assert error.details["validation_errors"] == errors
    assert len(error.suggestions) > 0


def test_validation_failed_error_without_errors():
    """Test validation_failed_error without specific errors."""
    error = validation_failed_error()
    assert "Unknown validation error" in error.message
    assert error.details["validation_errors"] == []


def test_validation_failed_error_with_custom_details():
    """Test validation_failed_error with custom details."""
    custom_details = {
        "validation_errors": ["Error 1"],
        "node_id": "llm_1",
        "workflow_id": "wf_123",
    }
    error = validation_failed_error(validation_errors=["Error 1"], details=custom_details)
    assert error.details == custom_details


def test_error_type_enum_values():
    """Test ErrorType enum values."""
    assert ErrorType.SYSTEM_ERROR.value == "system_error"
    assert ErrorType.USER_ERROR.value == "user_error"
    assert ErrorType.GENERATION_ERROR.value == "generation_error"


def test_error_code_enum_values():
    """Test ErrorCode enum values."""
    assert ErrorCode.MODEL_UNAVAILABLE.value == "MODEL_UNAVAILABLE"
    assert ErrorCode.RATE_LIMITED.value == "RATE_LIMITED"
    assert ErrorCode.VALIDATION_FAILED.value == "VALIDATION_FAILED"
    assert ErrorCode.INVALID_INPUT.value == "INVALID_INPUT"
    assert ErrorCode.DATABASE_ERROR.value == "DATABASE_ERROR"
    assert ErrorCode.NETWORK_ERROR.value == "NETWORK_ERROR"
    assert ErrorCode.MISSING_CONFIGURATION.value == "MISSING_CONFIGURATION"
    assert ErrorCode.UNAUTHORIZED.value == "UNAUTHORIZED"
    assert ErrorCode.TIMEOUT.value == "TIMEOUT"
    assert ErrorCode.CONTEXT_TOO_LARGE.value == "CONTEXT_TOO_LARGE"
