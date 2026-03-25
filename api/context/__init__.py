"""
Application-layer context adapters.

Concrete execution-context implementations live here so `graphon` only
depends on injected context managers rather than framework state capture.
"""

from context.execution_context import (
    AppContext,
    ContextProviderNotFoundError,
    ExecutionContext,
    ExecutionContextBuilder,
    IExecutionContext,
    NullAppContext,
    capture_current_context,
    read_context,
    register_context,
    register_context_capturer,
    reset_context_provider,
)
from context.models import SandboxContext

__all__ = [
    "AppContext",
    "ContextProviderNotFoundError",
    "ExecutionContext",
    "ExecutionContextBuilder",
    "IExecutionContext",
    "NullAppContext",
    "SandboxContext",
    "capture_current_context",
    "read_context",
    "register_context",
    "register_context_capturer",
    "reset_context_provider",
]
