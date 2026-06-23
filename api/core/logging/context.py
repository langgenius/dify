"""Request context for logging - framework agnostic.

This module provides request-scoped context variables for logging,
using Python's contextvars for thread-safe and async-safe storage.
"""

import uuid
from contextvars import ContextVar
from enum import StrEnum


class ErrorSource(StrEnum):
    """Classification of error sources for structured logging.

    Used in the ``error_source`` field of ERROR+ log records to enable
    differentiated alerting rules (e.g. workflow errors are user-caused,
    system errors trigger on-call alerts).
    """

    WORKFLOW = "workflow"
    SYSTEM = "system"


_request_id: ContextVar[str] = ContextVar("log_request_id", default="")
_trace_id: ContextVar[str] = ContextVar("log_trace_id", default="")

# Workflow log context
_app_id: ContextVar[str] = ContextVar("log_app_id", default="")
_workflow_id: ContextVar[str] = ContextVar("log_workflow_id", default="")
_node_id: ContextVar[str] = ContextVar("log_node_id", default="")

# Error source context (set by WorkflowEntry.run during workflow execution)
_error_source: ContextVar[ErrorSource] = ContextVar("log_error_source", default=ErrorSource.SYSTEM)


def get_request_id() -> str:
    """Get current request ID (10 hex chars)."""
    return _request_id.get()


def get_trace_id() -> str:
    """Get fallback trace ID when OTEL is unavailable (32 hex chars)."""
    return _trace_id.get()


def init_request_context() -> None:
    """Initialize request context. Call at start of each request."""
    req_id = uuid.uuid4().hex[:10]
    trace_id = uuid.uuid5(uuid.NAMESPACE_DNS, req_id).hex
    _request_id.set(req_id)
    _trace_id.set(trace_id)


def clear_request_context() -> None:
    """Clear request context. Call at end of request (optional)."""
    _request_id.set("")
    _trace_id.set("")


# ---------------------------------------------------------------------------
# Workflow log context
# ---------------------------------------------------------------------------


def get_app_id() -> str:
    """Get current workflow app_id for logging."""
    return _app_id.get()


def get_workflow_id() -> str:
    """Get current workflow_id for logging."""
    return _workflow_id.get()


def get_node_id() -> str:
    """Get current node_id for logging."""
    return _node_id.get()


def set_workflow_log_context(app_id: str, workflow_id: str) -> None:
    """Set workflow-level log context (app_id, workflow_id).

    Call at graph start. Use ``clear_workflow_log_context`` at graph end.
    """
    _app_id.set(app_id)
    _workflow_id.set(workflow_id)


def set_node_log_context(node_id: str) -> None:
    """Set or clear node-level log context.

    Pass empty string to clear node_id between node executions.
    """
    _node_id.set(node_id)


def clear_workflow_log_context() -> None:
    """Clear workflow log context (app_id, workflow_id, node_id).

    Call at graph end to ensure no stale context leaks to subsequent logs.

    Note: This does **not** reset ``error_source``.  When ``on_graph_end``
    receives a non-None error, the subsequent ``logger.exception`` call in
    ``WorkflowEntry.run`` still needs ``error_source == WORKFLOW`` to
    correctly classify the error.  ``error_source`` is reset separately
    via ``clear_error_source`` after the error has been logged.
    """
    _app_id.set("")
    _workflow_id.set("")
    _node_id.set("")


# ---------------------------------------------------------------------------
# Error source context
# ---------------------------------------------------------------------------


def get_error_source() -> ErrorSource:
    """Get current error_source for logging.

    Defaults to ``ErrorSource.SYSTEM`` when no execution context is active.
    Set to ``ErrorSource.WORKFLOW`` by ``WorkflowEntry.run`` during
    workflow graph execution.
    """
    return _error_source.get()


def set_error_source(source: ErrorSource) -> None:
    """Set error_source context.

    Typically called by ``WorkflowEntry.run`` with
    ``ErrorSource.WORKFLOW`` before graph execution starts.
    """
    _error_source.set(source)


def clear_error_source() -> None:
    """Reset error_source context to the default (SYSTEM)."""
    _error_source.set(ErrorSource.SYSTEM)
