"""Request context for logging - framework agnostic.

This module provides request-scoped context variables for logging,
using Python's contextvars for thread-safe and async-safe storage.
"""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar, Token

type IdentityContext = tuple[str, str, str]
type LoggingContextTokens = tuple[Token[str], Token[str], Token[IdentityContext]]

_request_id: ContextVar[str] = ContextVar("log_request_id", default="")
_trace_id: ContextVar[str] = ContextVar("log_trace_id", default="")
_identity: ContextVar[IdentityContext] = ContextVar("log_identity", default=("", "", ""))


def get_request_id() -> str:
    """Get current request ID (10 hex chars)."""
    return _request_id.get()


def get_trace_id() -> str:
    """Get fallback trace ID when OTEL is unavailable (32 hex chars)."""
    return _trace_id.get()


def get_identity_context() -> IdentityContext:
    """Get the immutable tenant, user, and user-type snapshot for logging."""
    return _identity.get()


def set_identity_context(
    *, tenant_id: str | None = None, user_id: str | None = None, user_type: str | None = None
) -> None:
    """Set primitive identity values already resolved by an authentication boundary."""
    _identity.set((tenant_id or "", user_id or "", user_type or ""))


def init_request_context() -> LoggingContextTokens:
    """Initialize request context and discard identity left by earlier work."""
    req_id = uuid.uuid4().hex[:10]
    trace_id = uuid.uuid5(uuid.NAMESPACE_DNS, req_id).hex
    return (
        _request_id.set(req_id),
        _trace_id.set(trace_id),
        _identity.set(("", "", "")),
    )


def reset_request_context(tokens: LoggingContextTokens) -> None:
    """Restore the logging context that preceded ``init_request_context``."""
    request_id_token, trace_id_token, identity_token = tokens
    _identity.reset(identity_token)
    _trace_id.reset(trace_id_token)
    _request_id.reset(request_id_token)


@contextmanager
def request_logging_context() -> Generator[None, None, None]:
    """Run work in an isolated logging context and restore its caller afterward."""
    tokens = init_request_context()
    try:
        yield
    finally:
        reset_request_context(tokens)


def clear_request_context() -> None:
    """Clear request context at a request or task lifecycle boundary."""
    _request_id.set("")
    _trace_id.set("")
    _identity.set(("", "", ""))
