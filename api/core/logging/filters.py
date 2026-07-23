"""Logging filters for structured logging."""

import contextlib
import logging
from typing import override

from core.logging.context import get_identity_context, get_request_id, get_trace_id


class TraceContextFilter(logging.Filter):
    """
    Filter that adds trace_id and span_id to log records.
    Integrates with OpenTelemetry when available, falls back to ContextVar-based trace_id.
    """

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        # Get trace context from OpenTelemetry
        trace_id, span_id = self._get_otel_context()

        # Set trace_id (fallback to ContextVar if no OTEL context)
        if trace_id:
            record.trace_id = trace_id
        else:
            record.trace_id = get_trace_id()

        record.span_id = span_id or ""

        # For backward compatibility, also set req_id
        record.req_id = get_request_id()

        return True

    def _get_otel_context(self) -> tuple[str, str]:
        """Extract trace_id and span_id from OpenTelemetry context."""
        with contextlib.suppress(Exception):
            from opentelemetry.trace import get_current_span
            from opentelemetry.trace.span import INVALID_SPAN_ID, INVALID_TRACE_ID

            span = get_current_span()
            if span and span.get_span_context():
                ctx = span.get_span_context()
                if ctx.is_valid and ctx.trace_id != INVALID_TRACE_ID:
                    trace_id = f"{ctx.trace_id:032x}"
                    span_id = f"{ctx.span_id:016x}" if ctx.span_id != INVALID_SPAN_ID else ""
                    return trace_id, span_id
        return "", ""


class IdentityContextFilter(logging.Filter):
    """Add an identity snapshot without invoking authentication or database work.

    Logging can run while other libraries hold internal locks, so this filter must
    only read primitive ContextVar values populated by authentication boundaries.
    """

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        identity = get_identity_context()
        record.tenant_id = identity.tenant_id
        record.user_id = identity.user_id
        record.user_type = identity.user_type
        return True
