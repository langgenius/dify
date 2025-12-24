"""Logging filters for structured logging."""

import contextlib
import logging
import uuid

import flask


class TraceContextFilter(logging.Filter):
    """
    Filter that adds trace_id and span_id to log records.
    Integrates with OpenTelemetry when available, falls back to request_id.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        # Get trace context from OpenTelemetry
        trace_id, span_id = self._get_otel_context()

        # Set trace_id (fallback to request_id if no OTEL context)
        if trace_id:
            record.trace_id = trace_id
        else:
            record.trace_id = self._get_or_create_request_trace_id()

        record.span_id = span_id or ""

        # For backward compatibility, also set req_id
        record.req_id = self._get_request_id()

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

    def _get_request_id(self) -> str:
        """Get request ID from Flask context."""
        if flask.has_request_context():
            if hasattr(flask.g, "request_id"):
                return flask.g.request_id
            flask.g.request_id = uuid.uuid4().hex[:10]
            return flask.g.request_id
        return ""

    def _get_or_create_request_trace_id(self) -> str:
        """Get or create a trace_id derived from request context."""
        if flask.has_request_context():
            if hasattr(flask.g, "_trace_id"):
                return flask.g._trace_id
            # Derive trace_id from request_id for consistency
            request_id = self._get_request_id()
            if request_id:
                # Generate a 32-char hex trace_id from request_id
                flask.g._trace_id = uuid.uuid5(uuid.NAMESPACE_DNS, request_id).hex
                return flask.g._trace_id
        return ""


class IdentityContextFilter(logging.Filter):
    """
    Filter that adds user identity context to log records.
    Extracts tenant_id, user_id, and user_type from Flask-Login current_user.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        identity = self._extract_identity()
        record.tenant_id = identity.get("tenant_id", "")
        record.user_id = identity.get("user_id", "")
        record.user_type = identity.get("user_type", "")
        return True

    def _extract_identity(self) -> dict[str, str]:
        """Extract identity from current_user if in request context."""
        try:
            if not flask.has_request_context():
                return {}
            from flask_login import current_user

            # Check if user is authenticated using the proxy
            if not current_user.is_authenticated:
                return {}

            # Access the underlying user object
            user = current_user

            from models import Account
            from models.model import EndUser

            identity: dict[str, str] = {}

            if isinstance(user, Account):
                if user.current_tenant_id:
                    identity["tenant_id"] = user.current_tenant_id
                identity["user_id"] = user.id
                identity["user_type"] = "account"
            elif isinstance(user, EndUser):
                identity["tenant_id"] = user.tenant_id
                identity["user_id"] = user.id
                identity["user_type"] = user.type or "end_user"

            return identity
        except Exception:
            return {}
