"""Request context for logging - framework agnostic.

This module provides request-scoped context variables for logging,
using Python's contextvars for thread-safe and async-safe storage.
"""

import uuid
from contextvars import ContextVar

_request_id: ContextVar[str] = ContextVar("log_request_id", default="")
_trace_id: ContextVar[str] = ContextVar("log_trace_id", default="")


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
