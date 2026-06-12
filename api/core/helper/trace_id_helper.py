import contextlib
import re
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError
from werkzeug.exceptions import BadRequest


class ParentTraceContext(BaseModel):
    """Typed parent trace context propagated from an outer workflow tool node."""

    parent_workflow_run_id: StrictStr
    parent_node_execution_id: StrictStr | None = None

    model_config = ConfigDict(extra="forbid")


def is_valid_trace_id(trace_id: str) -> bool:
    """
    Check if the trace_id is valid.

    Requirements: 1-128 characters, only letters, numbers, '-', and '_'.
    """
    return bool(re.match(r"^[a-zA-Z0-9\-_]{1,128}$", trace_id))


def get_external_trace_id(request: Any) -> str | None:
    """
    Retrieve the trace_id from the request.

    Priority:
    1. header ('X-Trace-Id')
    2. parameters
    3. JSON body
    4. Current OpenTelemetry context (if enabled)
    5. OpenTelemetry traceparent header (if present and valid)

    Returns None if no valid trace_id is provided.
    """
    trace_id = request.headers.get("X-Trace-Id")

    if not trace_id:
        trace_id = request.args.get("trace_id")

    if not trace_id and getattr(request, "is_json", False):
        json_data = getattr(request, "json", None)
        if json_data:
            trace_id = json_data.get("trace_id")

    if not trace_id:
        trace_id = get_trace_id_from_otel_context()

    if not trace_id:
        traceparent = request.headers.get("traceparent")
        if traceparent:
            trace_id = parse_traceparent_header(traceparent)

    if isinstance(trace_id, str) and is_valid_trace_id(trace_id):
        return trace_id
    return None


def extract_external_trace_id_from_args(args: Mapping[str, Any]):
    """
    Extract 'external_trace_id' from args.

    Returns a dict suitable for use in extras. Returns an empty dict if not found.
    """
    trace_id = args.get("external_trace_id")
    if trace_id:
        return {"external_trace_id": trace_id}
    return {}


TRACE_SESSION_ID_HEADER = "X-Trace-Session-Id"
TRACE_SESSION_ID_ARG = "trace_session_id"
TRACE_SESSION_ID_MAX_LENGTH = 200


def _validate_trace_session_id(value: Any) -> str:
    if not isinstance(value, str):
        raise BadRequest("trace_session_id must be a string.")

    normalized = value.strip()
    if not normalized:
        raise BadRequest("trace_session_id must be 1 to 200 characters after trimming.")
    if len(normalized) > TRACE_SESSION_ID_MAX_LENGTH:
        raise BadRequest("trace_session_id must be 1 to 200 characters after trimming.")
    return normalized


def get_trace_session_id(request: Any) -> str | None:
    """
    Resolve the Service API trace session ID from explicit request inputs.

    Priority is ``X-Trace-Session-Id`` header, then ``trace_session_id`` query
    parameter, then ``trace_session_id`` JSON body field. Only the resolved
    highest-priority input is validated; lower-priority values are ignored.
    """
    if TRACE_SESSION_ID_HEADER in request.headers:
        return _validate_trace_session_id(request.headers.get(TRACE_SESSION_ID_HEADER))

    if TRACE_SESSION_ID_ARG in request.args:
        return _validate_trace_session_id(request.args.get(TRACE_SESSION_ID_ARG))

    if getattr(request, "is_json", False):
        json_data = getattr(request, "json", None)
        if isinstance(json_data, Mapping) and TRACE_SESSION_ID_ARG in json_data:
            return _validate_trace_session_id(json_data.get(TRACE_SESSION_ID_ARG))

    return None


def extract_trace_session_id_from_args(args: Mapping[str, Any]) -> dict[str, str]:
    """
    Extract normalized ``trace_session_id`` from generation args for entity extras.
    """
    trace_session_id = args.get(TRACE_SESSION_ID_ARG)
    if isinstance(trace_session_id, str):
        normalized = trace_session_id.strip()
        if normalized:
            return {TRACE_SESSION_ID_ARG: normalized}
    return {}


def omit_trace_session_id_from_payload(payload: Any) -> Any:
    """
    Return a payload copy without transport-level ``trace_session_id``.

    Controllers validate this field through :func:`get_trace_session_id` so lower-priority
    body values cannot fail DTO validation before header/query priority is applied.
    """
    if isinstance(payload, Mapping) and TRACE_SESSION_ID_ARG in payload:
        return {key: value for key, value in payload.items() if key != TRACE_SESSION_ID_ARG}
    return payload


def extract_parent_trace_context_from_args(args: Mapping[str, Any]) -> dict[str, ParentTraceContext]:
    """
    Extract 'parent_trace_context' from args.

    Returns a dict suitable for use in extras when both parent identifiers exist.
    Returns an empty dict if the context is missing or incomplete.
    """
    parent_trace_context = args.get("parent_trace_context")
    match parent_trace_context:
        case ParentTraceContext():
            context = parent_trace_context
        case Mapping():
            try:
                context = ParentTraceContext.model_validate(parent_trace_context)
            except ValidationError:
                return {}
        case _:
            return {}

    if context.parent_node_execution_id is None:
        return {}

    return {"parent_trace_context": context}


def get_trace_id_from_otel_context() -> str | None:
    """
    Retrieve the current trace ID from the active OpenTelemetry trace context.
    Returns None if:
    1. OpenTelemetry SDK is not installed or enabled.
    2. There is no active span or trace context.
    """
    try:
        from opentelemetry.trace import SpanContext, get_current_span
        from opentelemetry.trace.span import INVALID_TRACE_ID

        span = get_current_span()
        if not span:
            return None

        span_context: SpanContext = span.get_span_context()

        if not span_context or span_context.trace_id == INVALID_TRACE_ID:
            return None

        trace_id_hex = f"{span_context.trace_id:032x}"
        return trace_id_hex

    except Exception:
        return None


def parse_traceparent_header(traceparent: str) -> str | None:
    """
    Parse the `traceparent` header to extract the trace_id.

    Expected format:
        'version-trace_id-span_id-flags'

    Reference:
        W3C Trace Context Specification: https://www.w3.org/TR/trace-context/
    """
    with contextlib.suppress(Exception):
        parts = traceparent.split("-")
        if len(parts) == 4 and len(parts[1]) == 32:
            return parts[1]
    return None


def get_span_id_from_otel_context() -> str | None:
    """
    Retrieve the current span ID from the active OpenTelemetry trace context.

    Returns:
        A 16-character hex string representing the span ID, or None if not available.
    """
    try:
        from opentelemetry.trace import get_current_span
        from opentelemetry.trace.span import INVALID_SPAN_ID

        span = get_current_span()
        if not span:
            return None

        span_context = span.get_span_context()
        if not span_context or span_context.span_id == INVALID_SPAN_ID:
            return None

        return f"{span_context.span_id:016x}"
    except Exception:
        return None


def generate_traceparent_header() -> str | None:
    """
    Generate a W3C traceparent header from the current context.

    Uses OpenTelemetry context if available, otherwise uses the
    ContextVar-based trace_id from the logging context.

    Format: {version}-{trace_id}-{span_id}-{flags}
    Example: 00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01

    Returns:
        A valid traceparent header string, or None if generation fails.
    """
    import uuid

    # Try OTEL context first
    trace_id = get_trace_id_from_otel_context()
    span_id = get_span_id_from_otel_context()

    if trace_id and span_id:
        return f"00-{trace_id}-{span_id}-01"

    # Fallback: use ContextVar-based trace_id or generate new one
    from core.logging.context import get_trace_id as get_logging_trace_id

    trace_id = get_logging_trace_id() or uuid.uuid4().hex

    # Generate a new span_id (16 hex chars)
    span_id = uuid.uuid4().hex[:16]

    return f"00-{trace_id}-{span_id}-01"
