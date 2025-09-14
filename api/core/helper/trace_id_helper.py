import contextlib
import re
from collections.abc import Mapping
from typing import Any


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
