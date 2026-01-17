"""
Multi-Strategy Retry for Workflow Generation.

Retry strategies:
1. First retry: Increase temperature, encourage different approach
2. Second retry: Simplify prompt, reduce constraints
3. Third retry: Switch to fallback model (if configured)

Non-retryable errors:
- MODEL_UNAVAILABLE
- RATE_LIMITED (handled separately with backoff)
- PROVIDER_ERROR
"""

import logging
from typing import Any

from pydantic import BaseModel, Field

from core.workflow.generator.types.constants import (
    MAX_RETRIES,
    TEMPERATURE_DEFAULT,
    TEMPERATURE_HIGH,
    TEMPERATURE_LOW,
)
from core.workflow.generator.types.errors import ErrorCode

logger = logging.getLogger(__name__)


# Errors that should not be retried
NON_RETRYABLE_ERRORS = frozenset(
    {
        ErrorCode.MODEL_UNAVAILABLE,
        ErrorCode.PROVIDER_ERROR,
        ErrorCode.OFF_TOPIC,
        ErrorCode.INVALID_INSTRUCTION,
    }
)

# Errors that need exponential backoff
BACKOFF_ERRORS = frozenset(
    {
        ErrorCode.RATE_LIMITED,
    }
)


class RetryContext(BaseModel):
    """Context for retry decision making."""

    attempt: int = Field(ge=1)
    max_attempts: int = Field(default=MAX_RETRIES)
    last_error_code: ErrorCode | None = None
    last_error_message: str = ""
    validation_errors: list[dict[str, Any]] = Field(default_factory=list)
    previous_temperatures: list[float] = Field(default_factory=list)

    @property
    def can_retry(self) -> bool:
        """Check if more retries are allowed."""
        return self.attempt < self.max_attempts

    @property
    def is_first_retry(self) -> bool:
        return self.attempt == 1

    @property
    def is_second_retry(self) -> bool:
        return self.attempt == 2


class RetryDecision(BaseModel):
    """Decision from retry strategy."""

    should_retry: bool
    reason: str

    # Strategy adjustments
    temperature_adjustment: float | None = None
    simplify_prompt: bool = False
    use_fallback_model: bool = False
    add_error_context: bool = True

    # Backoff settings
    backoff_ms: int | None = None


class RetryStrategy:
    """
    Multi-strategy retry handler.

    Implements different strategies based on retry attempt number
    and error type.
    """

    def __init__(
        self,
        fallback_model_config: dict[str, Any] | None = None,
    ):
        self.fallback_model_config = fallback_model_config

    def decide(self, context: RetryContext) -> RetryDecision:
        """
        Decide whether and how to retry.

        Args:
            context: Current retry context

        Returns:
            RetryDecision with strategy adjustments
        """
        # Check for non-retryable errors
        if context.last_error_code and context.last_error_code in NON_RETRYABLE_ERRORS:
            return RetryDecision(
                should_retry=False,
                reason=f"Error {context.last_error_code.value} is not retryable",
            )

        # Check for backoff errors
        if context.last_error_code and context.last_error_code in BACKOFF_ERRORS:
            backoff_ms = self._calculate_backoff(context.attempt)
            return RetryDecision(
                should_retry=context.can_retry,
                reason="Rate limited, backing off",
                backoff_ms=backoff_ms,
            )

        # Max retries reached
        if not context.can_retry:
            return RetryDecision(
                should_retry=False,
                reason=f"Max retries ({context.max_attempts}) reached",
            )

        # Apply strategy based on attempt number
        if context.is_first_retry:
            return self._first_retry_strategy(context)
        elif context.is_second_retry:
            return self._second_retry_strategy(context)
        else:
            return self._third_retry_strategy(context)

    def _first_retry_strategy(self, context: RetryContext) -> RetryDecision:
        """
        First retry: Increase temperature to encourage different approach.
        """
        logger.info("Retry strategy: Increasing temperature for diverse output")
        return RetryDecision(
            should_retry=True,
            reason="First retry: trying higher temperature for different approach",
            temperature_adjustment=TEMPERATURE_HIGH,
            add_error_context=True,
        )

    def _second_retry_strategy(self, context: RetryContext) -> RetryDecision:
        """
        Second retry: Simplify prompt, reduce constraints.
        """
        logger.info("Retry strategy: Simplifying prompt")
        return RetryDecision(
            should_retry=True,
            reason="Second retry: simplifying prompt and constraints",
            temperature_adjustment=TEMPERATURE_DEFAULT,
            simplify_prompt=True,
            add_error_context=True,
        )

    def _third_retry_strategy(self, context: RetryContext) -> RetryDecision:
        """
        Third retry: Try fallback model if available.
        """
        if self.fallback_model_config:
            logger.info("Retry strategy: Switching to fallback model")
            return RetryDecision(
                should_retry=True,
                reason="Third retry: switching to fallback model",
                temperature_adjustment=TEMPERATURE_LOW,
                use_fallback_model=True,
                add_error_context=True,
            )
        else:
            logger.info("Retry strategy: Final attempt with low temperature")
            return RetryDecision(
                should_retry=True,
                reason="Third retry: conservative approach with low temperature",
                temperature_adjustment=TEMPERATURE_LOW,
                simplify_prompt=True,
                add_error_context=True,
            )

    def _calculate_backoff(self, attempt: int) -> int:
        """Calculate exponential backoff in milliseconds."""
        base_ms = 1000
        return base_ms * (2 ** (attempt - 1))

    def build_error_context(self, context: RetryContext) -> str:
        """
        Build error context string for prompt injection.

        This helps the LLM understand what went wrong in the previous attempt.
        """
        if not context.validation_errors:
            return f"Previous attempt failed: {context.last_error_message}"

        lines = ["<validation_feedback>"]
        lines.append("The previous generation had these errors:")
        for i, error in enumerate(context.validation_errors[:5], 1):
            msg = error.get("message", str(error))
            lines.append(f"{i}. {msg}")
        lines.append("Please fix these issues while keeping the workflow structure.")
        lines.append("</validation_feedback>")

        return "\n".join(lines)


# Default strategy instance
_default_strategy: RetryStrategy | None = None


def get_retry_strategy(
    fallback_model_config: dict[str, Any] | None = None,
) -> RetryStrategy:
    """Get or create the default retry strategy."""
    global _default_strategy
    if _default_strategy is None or fallback_model_config:
        _default_strategy = RetryStrategy(fallback_model_config)
    return _default_strategy
