"""
Generator timeout utilities for workflow nodes.

Provides timeout wrappers for streaming generators, primarily used for
LLM response streaming where we need to enforce time-to-first-token limits.
"""

import time
from collections.abc import Generator
from typing import TypeVar

T = TypeVar("T")


class FirstTokenTimeoutError(Exception):
    """Raised when a generator fails to yield its first item within the configured timeout."""

    def __init__(self, timeout_ms: int):
        self.timeout_ms = timeout_ms
        super().__init__(f"Generator timed out after {timeout_ms}ms without yielding first item")


def with_first_token_timeout(
    generator: Generator[T, None, None],
    timeout_seconds: float,
) -> Generator[T, None, None]:
    """
    Wrap a generator with first token timeout monitoring.

    Only monitors the time until the FIRST item is yielded.
    Once the first item arrives, timeout monitoring stops and
    subsequent items are yielded without timeout checks.

    Args:
        generator: The source generator to wrap
        timeout_seconds: Maximum time to wait for first item (in seconds)

    Yields:
        Items from the source generator

    Raises:
        FirstTokenTimeoutError: If first item doesn't arrive within timeout
    """
    start_time = time.monotonic()

    # Handle first item separately to check timeout only once
    try:
        first_item = next(generator)
        if time.monotonic() - start_time > timeout_seconds:
            raise FirstTokenTimeoutError(int(timeout_seconds * 1000))
        yield first_item
    except StopIteration:
        return

    # Yield remaining items without timeout checks
    yield from generator
