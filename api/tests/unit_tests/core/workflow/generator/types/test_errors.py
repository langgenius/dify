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
    assert error.severity == "error"
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
    assert result["severity"] == "error"
    assert result["details"] == {}
    assert result["suggestions"] == []


def test_error_to_dict_with_details():
    """Test to_dict with details and suggestions."""
    error = WorkflowGenerationError(
        type=ErrorType.USER_ERROR,
        code=ErrorCode.INVALID_INSTRUCTION,
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
    error = model_unavailable_error("openai", "gpt-4")
    assert error.type == ErrorType.SYSTEM_ERROR
    assert error.code == ErrorCode.MODEL_UNAVAILABLE
    assert error.message == "Model openai/gpt-4 is not available"
    assert error.is_retryable is False
    assert len(error.suggestions) == 2
    assert "Configure the model in Settings" in error.suggestions
    assert "Choose a different model" in error.suggestions


def test_rate_limited_error():
    """Test rate_limited_error helper function."""
    error = rate_limited_error(retry_after=60)
    assert error.type == ErrorType.SYSTEM_ERROR
    assert error.code == ErrorCode.RATE_LIMITED
    assert error.message == "Rate limit exceeded"
    assert error.is_retryable is True
    assert error.details["retry_after"] == 60
    assert len(error.suggestions) == 1
    assert "Wait and try again" in error.suggestions


def test_rate_limited_error_without_retry_after():
    """Test rate_limited_error without retry_after."""
    error = rate_limited_error()
    assert error.message == "Rate limit exceeded"
    assert error.details == {}


def test_validation_failed_error():
    """Test validation_failed_error helper function."""
    errors = [{"field": "model", "message": "Missing required field"}]
    error = validation_failed_error(errors)
    assert error.type == ErrorType.GENERATION_ERROR
    assert error.code == ErrorCode.VALIDATION_FAILED
    assert error.message == "Workflow validation failed with 1 error(s)"
    assert error.is_retryable is True
    assert error.details["validation_errors"] == errors
    assert len(error.suggestions) == 2
    assert "Review the generated workflow" in error.suggestions
    assert "Try simplifying your request" in error.suggestions


def test_error_type_enum_values():
    """Test ErrorType enum values."""
    assert ErrorType.SYSTEM_ERROR.value == "system_error"
    assert ErrorType.USER_ERROR.value == "user_error"
    assert ErrorType.GENERATION_ERROR.value == "generation_error"


def test_error_code_enum_values():
    """Test ErrorCode enum values."""
    # System errors
    assert ErrorCode.MODEL_UNAVAILABLE.value == "MODEL_UNAVAILABLE"
    assert ErrorCode.RATE_LIMITED.value == "RATE_LIMITED"
    assert ErrorCode.PROVIDER_ERROR.value == "PROVIDER_ERROR"

    # User errors
    assert ErrorCode.INVALID_INSTRUCTION.value == "INVALID_INSTRUCTION"
    assert ErrorCode.MISSING_CONFIG.value == "MISSING_CONFIG"
    assert ErrorCode.OFF_TOPIC.value == "OFF_TOPIC"

    # Generation errors
    assert ErrorCode.PLANNING_FAILED.value == "PLANNING_FAILED"
    assert ErrorCode.BUILDING_FAILED.value == "BUILDING_FAILED"
    assert ErrorCode.VALIDATION_FAILED.value == "VALIDATION_FAILED"
    assert ErrorCode.GRAPH_DISCONNECTED.value == "GRAPH_DISCONNECTED"
    assert ErrorCode.JSON_PARSE_FAILED.value == "JSON_PARSE_FAILED"
    assert ErrorCode.MAX_RETRIES_EXCEEDED.value == "MAX_RETRIES_EXCEEDED"
