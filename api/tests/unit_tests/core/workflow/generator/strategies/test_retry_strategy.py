# api/tests/unit_tests/core/workflow/generator/strategies/test_retry_strategy.py
from core.workflow.generator.strategies.retry_strategy import (
    RetryContext,
    get_retry_strategy,
)
from core.workflow.generator.types.errors import ErrorCode


def test_retry_context_creation():
    ctx = RetryContext(
        attempt=1,
        max_attempts=3,
        last_error_code=ErrorCode.VALIDATION_FAILED,
    )
    assert ctx.attempt == 1
    assert ctx.can_retry is True


def test_retry_context_max_attempts_reached():
    ctx = RetryContext(
        attempt=3,
        max_attempts=3,
        last_error_code=ErrorCode.VALIDATION_FAILED,
    )
    assert ctx.can_retry is False


def test_retry_decision_first_retry():
    strategy = get_retry_strategy()
    ctx = RetryContext(
        attempt=1,
        max_attempts=3,
        last_error_code=ErrorCode.VALIDATION_FAILED,
        validation_errors=[{"node_id": "llm_1", "message": "missing model"}],
    )
    decision = strategy.decide(ctx)
    assert decision.should_retry is True
    assert decision.temperature_adjustment is not None


def test_retry_decision_unrecoverable_error():
    strategy = get_retry_strategy()
    ctx = RetryContext(
        attempt=1,
        max_attempts=3,
        last_error_code=ErrorCode.MODEL_UNAVAILABLE,
    )
    decision = strategy.decide(ctx)
    assert decision.should_retry is False


def test_retry_decision_prompt_simplification():
    strategy = get_retry_strategy()
    ctx = RetryContext(
        attempt=2,  # Second retry
        max_attempts=3,
        last_error_code=ErrorCode.JSON_PARSE_FAILED,
    )
    decision = strategy.decide(ctx)
    assert decision.should_retry is True
    assert decision.simplify_prompt is True


def test_retry_decision_rate_limit_backoff():
    """Test exponential backoff for rate limits."""
    strategy = get_retry_strategy()
    ctx = RetryContext(attempt=2, max_attempts=3, last_error_code=ErrorCode.RATE_LIMITED)
    decision = strategy.decide(ctx)
    assert decision.should_retry is True
    assert decision.backoff_ms == 2000  # 1000 * 2^(2-1)


def test_retry_decision_max_retries():
    """Test max retries reached."""
    strategy = get_retry_strategy()
    ctx = RetryContext(attempt=3, max_attempts=3, last_error_code=ErrorCode.VALIDATION_FAILED)
    decision = strategy.decide(ctx)
    assert decision.should_retry is False
    assert "Max retries" in decision.reason


def test_retry_decision_third_retry_with_fallback():
    """Test third retry with fallback model."""
    from core.workflow.generator.strategies.retry_strategy import RetryStrategy

    strategy = RetryStrategy(fallback_model_config={"model": "gpt-4"})
    ctx = RetryContext(attempt=3, max_attempts=4, last_error_code=ErrorCode.VALIDATION_FAILED)
    decision = strategy.decide(ctx)
    assert decision.should_retry is True
    assert decision.use_fallback_model is True


def test_retry_decision_third_retry_without_fallback():
    """Test third retry without fallback model."""
    from core.workflow.generator.strategies.retry_strategy import RetryStrategy

    strategy = RetryStrategy()
    ctx = RetryContext(attempt=3, max_attempts=4, last_error_code=ErrorCode.VALIDATION_FAILED)
    decision = strategy.decide(ctx)
    assert decision.should_retry is True
    assert decision.use_fallback_model is False
    assert decision.simplify_prompt is True


def test_build_error_context_with_validation_errors():
    """Test error context building."""
    from core.workflow.generator.strategies.retry_strategy import RetryStrategy

    strategy = RetryStrategy()
    ctx = RetryContext(
        attempt=1,
        max_attempts=3,
        validation_errors=[{"message": "Node llm_1 missing model"}, {"message": "Invalid edge connection"}],
    )
    context_str = strategy.build_error_context(ctx)
    assert "<validation_feedback>" in context_str
    assert "Node llm_1 missing model" in context_str


def test_build_error_context_without_validation_errors():
    """Test error context with just error message."""
    from core.workflow.generator.strategies.retry_strategy import RetryStrategy

    strategy = RetryStrategy()
    ctx = RetryContext(attempt=1, max_attempts=3, last_error_message="JSON parse failed")
    context_str = strategy.build_error_context(ctx)
    assert context_str == "Previous attempt failed: JSON parse failed"
