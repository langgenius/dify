"""
Execution Context - Context management for workflow execution.

This package provides Flask-independent context management for workflow
execution in multi-threaded environments.
"""

from core.workflow.context.execution_context import (
    AppContext,
    ContextProviderNotFoundError,
    ExecutionContext,
    IExecutionContext,
    NullAppContext,
    capture_current_context,
    read_context,
    register_context,
    register_context_capturer,
    reset_context_provider,
)
from core.workflow.context.models import SandboxContext

__all__ = [
    "AppContext",
    "ContextProviderNotFoundError",
    "ExecutionContext",
    "IExecutionContext",
    "NullAppContext",
    "SandboxContext",
    "capture_current_context",
    "read_context",
    "register_context",
    "register_context_capturer",
    "reset_context_provider",
]
