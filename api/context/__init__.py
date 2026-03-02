"""
Core Context - Framework-agnostic context management.

This module provides context management that is independent of any specific
web framework. Framework-specific implementations register their context
capture functions at application initialization time.

This ensures the workflow layer remains completely decoupled from Flask
or any other web framework.
"""

import contextvars
from collections.abc import Callable

from core.workflow.context.execution_context import (
    ExecutionContext,
    IExecutionContext,
    NullAppContext,
)

# Global capturer function - set by framework-specific modules
_capturer: Callable[[], IExecutionContext] | None = None


def register_context_capturer(capturer: Callable[[], IExecutionContext]) -> None:
    """
    Register a context capture function.

    This should be called by framework-specific modules (e.g., Flask)
    during application initialization.

    Args:
        capturer: Function that captures current context and returns IExecutionContext
    """
    global _capturer
    _capturer = capturer


def capture_current_context() -> IExecutionContext:
    """
    Capture current execution context.

    This function uses the registered context capturer. If no capturer
    is registered, it returns a minimal context with only contextvars
    (suitable for non-framework environments like tests or standalone scripts).

    Returns:
        IExecutionContext with captured context
    """
    if _capturer is None:
        # No framework registered - return minimal context
        return ExecutionContext(
            app_context=NullAppContext(),
            context_vars=contextvars.copy_context(),
        )

    return _capturer()


def reset_context_provider() -> None:
    """
    Reset the context capturer.

    This is primarily useful for testing to ensure a clean state.
    """
    global _capturer
    _capturer = None


__all__ = [
    "capture_current_context",
    "register_context_capturer",
    "reset_context_provider",
]
