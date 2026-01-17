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
