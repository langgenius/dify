"""
Execution Context - Context management for workflow execution.

This package provides Flask-independent context management for workflow
execution in multi-threaded environments.
"""

from core.workflow.context.execution_context import (
    AppContext,
    ExecutionContext,
    IExecutionContext,
    NullAppContext,
    capture_current_context,
)

__all__ = [
    "AppContext",
    "ExecutionContext",
    "IExecutionContext",
    "NullAppContext",
    "capture_current_context",
]
