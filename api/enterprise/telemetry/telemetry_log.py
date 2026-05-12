"""Structured-log emitter for enterprise telemetry events.

Emits structured JSON log lines correlated with OTEL traces via trace_id.
Picked up by ``StructuredJSONFormatter`` → stdout/Loki/Elastic.
"""

from __future__ import annotations

import logging
import uuid
from functools import lru_cache
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from enterprise.telemetry.entities import EnterpriseTelemetryEvent

logger = logging.getLogger("dify.telemetry")


@lru_cache(maxsize=4096)
def compute_trace_id_hex(uuid_str: str | None) -> str:
    """Convert a business UUID string to a 32-hex OTEL-compatible trace_id.

    Returns empty string when *uuid_str* is ``None`` or invalid.
    """
    if not uuid_str:
        return ""
    normalized = uuid_str.strip().lower()
    if len(normalized) == 32 and all(ch in "0123456789abcdef" for ch in normalized):
        return normalized
    try:
        return f"{uuid.UUID(normalized).int:032x}"
    except (ValueError, AttributeError):
        return ""


@lru_cache(maxsize=4096)
def compute_span_id_hex(uuid_str: str | None) -> str:
    if not uuid_str:
        return ""
    normalized = uuid_str.strip().lower()
    if len(normalized) == 16 and all(ch in "0123456789abcdef" for ch in normalized):
        return normalized
    try:
        from enterprise.telemetry.id_generator import compute_deterministic_span_id

        return f"{compute_deterministic_span_id(normalized):016x}"
    except (ValueError, AttributeError):
        return ""


def emit_telemetry_log(
    *,
    event_name: str | EnterpriseTelemetryEvent,
    attributes: dict[str, Any],
    signal: str = "metric_only",
    trace_id_source: str | None = None,
    span_id_source: str | None = None,
    tenant_id: str | None = None,
    user_id: str | None = None,
) -> None:
    """Emit a structured log line for a telemetry event.

    Parameters
    ----------
    event_name:
        Canonical event name, e.g. ``"dify.workflow.run"``.
    attributes:
        All event-specific attributes (already built by the caller).
    signal:
        ``"metric_only"`` for events with no span, ``"span_detail"``
        for detail logs accompanying a slim span.
    trace_id_source:
        A UUID string (e.g. ``workflow_run_id``) used to derive a 32-hex
        trace_id for cross-signal correlation.
    tenant_id:
        Tenant identifier (for the ``IdentityContextFilter``).
    user_id:
        User identifier (for the ``IdentityContextFilter``).
    """
    if not logger.isEnabledFor(logging.INFO):
        return
    attrs = {
        "dify.event.name": event_name,
        "dify.event.signal": signal,
        **attributes,
    }

    extra: dict[str, Any] = {"attributes": attrs}

    trace_id_hex = compute_trace_id_hex(trace_id_source)
    if trace_id_hex:
        extra["trace_id"] = trace_id_hex
    span_id_hex = compute_span_id_hex(span_id_source)
    if span_id_hex:
        extra["span_id"] = span_id_hex
    if tenant_id:
        extra["tenant_id"] = tenant_id
    if user_id:
        extra["user_id"] = user_id

    logger.info("telemetry.%s", signal, extra=extra)


def emit_metric_only_event(
    *,
    event_name: str | EnterpriseTelemetryEvent,
    attributes: dict[str, Any],
    trace_id_source: str | None = None,
    span_id_source: str | None = None,
    tenant_id: str | None = None,
    user_id: str | None = None,
) -> None:
    emit_telemetry_log(
        event_name=event_name,
        attributes=attributes,
        signal="metric_only",
        trace_id_source=trace_id_source,
        span_id_source=span_id_source,
        tenant_id=tenant_id,
        user_id=user_id,
    )
