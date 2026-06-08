"""Structured-log emitter for enterprise telemetry events.

Emits structured JSON log lines correlated with OTEL traces via trace_id.
Picked up by ``StructuredJSONFormatter`` → stdout/Loki/Elastic.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import uuid
from functools import lru_cache
from typing import TYPE_CHECKING, Any

from configs import dify_config

if TYPE_CHECKING:
    from enterprise.telemetry.entities import EnterpriseTelemetryEvent

logger = logging.getLogger("dify.telemetry")

# --- OTLP dual-emit failure throttling ---
# When the collector is down, every telemetry event would otherwise log a full
# stack trace, flooding stdout/Loki with one ERROR per event. Instead we log the
# first failure at ERROR (with traceback) and thereafter emit a single throttled
# WARNING every ``_OTLP_FAILURE_LOG_INTERVAL`` failures carrying the aggregate
# count, so an outage stays observable without drowning the log pipeline.
_OTLP_FAILURE_LOG_INTERVAL = 1000
_otlp_failure_lock = threading.Lock()
_otlp_failure_count = 0


def _record_otlp_failure(event_name: object) -> None:
    """Record (and throttle the logging of) an OTLP dual-emit failure.

    Best-effort and thread-safe: the first failure logs once at ERROR with a
    traceback; subsequent failures are counted and only summarized at WARNING
    every ``_OTLP_FAILURE_LOG_INTERVAL`` occurrences. Never raises.
    """
    global _otlp_failure_count
    with _otlp_failure_lock:
        _otlp_failure_count += 1
        count = _otlp_failure_count
    if count == 1:
        logger.exception("Failed to dual-emit OTLP telemetry log for event %s (further failures throttled)", event_name)
    elif count % _OTLP_FAILURE_LOG_INTERVAL == 0:
        logger.warning("OTLP telemetry dual-emit still failing: %d failures so far", count)


def otlp_logs_enabled() -> bool:
    """Whether companion telemetry logs should also be emitted as OTLP logs.

    Independent of the application log level (so production ``LOG_LEVEL=WARNING``
    does not suppress OTLP content logs). Requires the full enterprise telemetry
    stack to be enabled plus the dedicated dual-emit switch.
    """
    return bool(
        dify_config.ENTERPRISE_ENABLED
        and dify_config.ENTERPRISE_TELEMETRY_ENABLED
        and dify_config.ENTERPRISE_OTLP_LOGS_ENABLED
    )


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


@lru_cache(maxsize=4096)
def compute_otlp_span_id_hex(seed: str | None) -> str:
    """Derive a deterministic, non-zero 64-bit span_id hex from an arbitrary seed.

    Unlike :func:`compute_span_id_hex`, the seed need not be a UUID — it may be any
    composite string (e.g. ``"<message_id>:message"``). Used **only** for the OTLP
    log path to give span-less ``metric_only`` events a stable, globally unique
    span_id without changing the stdout ``span_id`` value.

    Returns empty string when *seed* is falsy.
    """
    if not seed:
        return ""
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    span_id = int.from_bytes(digest[:8], "big")
    if span_id == 0:
        span_id = 1
    return f"{span_id:016x}"


def emit_telemetry_log(
    *,
    event_name: str | EnterpriseTelemetryEvent,
    attributes: dict[str, Any],
    signal: str = "metric_only",
    trace_id_source: str | None = None,
    span_id_source: str | None = None,
    tenant_id: str | None = None,
    user_id: str | None = None,
    start_unix_nano: int | None = None,
    end_unix_nano: int | None = None,
    otlp_span_seed: str | None = None,
    otlp_parent_trace_id: str | None = None,
    otlp_parent_node_execution_id: str | None = None,
    otlp_parent_workflow_run_id: str | None = None,
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
    span_id_source:
        A UUID string used to derive the 16-hex ``span_id`` for the stdout path.
    tenant_id:
        Tenant identifier (for the ``IdentityContextFilter``).
    user_id:
        User identifier (for the ``IdentityContextFilter``).
    start_unix_nano:
        Absolute event start in nanoseconds, used **only** for the OTLP log
        ``timestamp``. Does not affect the stdout path.
    end_unix_nano:
        Absolute event end in nanoseconds, used **only** for the OTLP log
        ``observed_timestamp``. Does not affect the stdout path.
    otlp_span_seed:
        Optional seed for an OTLP-only unique span_id (via
        :func:`compute_otlp_span_id_hex`). Used to give span-less
        ``metric_only`` events a stable, globally-unique span_id on the OTLP
        path **without** changing the stdout ``span_id`` (which still derives
        from ``span_id_source``). When ``None``, the OTLP span_id falls back to
        the stdout ``span_id`` value.
    otlp_parent_trace_id:
        Raw id (UUID string) of the trace this event's logical parent belongs to,
        emitted **only** on the OTLP path as ``dify.parent.trace_id`` for L1
        re-attachment. Never added to the stdout payload.
    otlp_parent_node_execution_id:
        Raw id of the node execution whose span is the direct parent, emitted
        **only** on the OTLP path as ``dify.parent.node.execution_id``.
    otlp_parent_workflow_run_id:
        Raw run id of the parent workflow, emitted **only** on the OTLP path as
        ``dify.parent.workflow.run_id``.
    """
    # Emit on the OTLP path before the INFO gate below, so it is independent of the
    # application log level (e.g. production LOG_LEVEL=WARNING).
    if otlp_logs_enabled():
        _emit_otlp_log(
            event_name=event_name,
            signal=signal,
            attributes=attributes,
            trace_id_source=trace_id_source,
            span_id_source=span_id_source,
            otlp_span_seed=otlp_span_seed,
            start_unix_nano=start_unix_nano,
            end_unix_nano=end_unix_nano,
            parent_trace_id=otlp_parent_trace_id,
            parent_node_execution_id=otlp_parent_node_execution_id,
            parent_workflow_run_id=otlp_parent_workflow_run_id,
        )

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
    start_unix_nano: int | None = None,
    end_unix_nano: int | None = None,
    otlp_span_seed: str | None = None,
    otlp_parent_trace_id: str | None = None,
    otlp_parent_node_execution_id: str | None = None,
    otlp_parent_workflow_run_id: str | None = None,
) -> None:
    emit_telemetry_log(
        event_name=event_name,
        attributes=attributes,
        signal="metric_only",
        trace_id_source=trace_id_source,
        span_id_source=span_id_source,
        tenant_id=tenant_id,
        user_id=user_id,
        start_unix_nano=start_unix_nano,
        end_unix_nano=end_unix_nano,
        otlp_span_seed=otlp_span_seed,
        otlp_parent_trace_id=otlp_parent_trace_id,
        otlp_parent_node_execution_id=otlp_parent_node_execution_id,
        otlp_parent_workflow_run_id=otlp_parent_workflow_run_id,
    )


def _emit_otlp_log(
    *,
    event_name: str | EnterpriseTelemetryEvent,
    signal: str,
    attributes: dict[str, Any],
    trace_id_source: str | None,
    span_id_source: str | None,
    otlp_span_seed: str | None,
    start_unix_nano: int | None,
    end_unix_nano: int | None,
    parent_trace_id: str | None = None,
    parent_node_execution_id: str | None = None,
    parent_workflow_run_id: str | None = None,
) -> None:
    """Forward a telemetry event to the OTLP log exporter (dual-emit).

    Best-effort and self-contained: swallows all errors and is a no-op when the
    enterprise exporter is unavailable, so it never affects the stdout log path
    or the calling business thread.

    The OTLP ``span_id`` is derived from ``otlp_span_seed`` when provided (giving
    span-less ``metric_only`` events a unique id) and otherwise mirrors the stdout
    span_id. ``trace_id`` always matches the stdout trace_id.

    The ``dify.parent.*`` linkage attributes are built here on a fresh ``otlp_attrs``
    dict from the ``parent_*`` arguments — never written back to the caller's
    ``attributes`` dict, so the stdout path stays free of ``dify.parent.*``. They let
    the collector L1 re-attach nested-workflow / ``metric_only`` events to the parent.
    """
    try:
        from extensions.ext_enterprise_telemetry import get_enterprise_exporter

        exporter = get_enterprise_exporter()
        if exporter is None:
            return

        # No own-id source (e.g. app-lifecycle / feedback events that carry no trace
        # context) → the record would be id-less and the collector drops it; skip.
        if not trace_id_source and not span_id_source and not otlp_span_seed:
            return

        trace_id_hex = compute_trace_id_hex(trace_id_source)
        if otlp_span_seed:
            span_id_hex = compute_otlp_span_id_hex(otlp_span_seed)
        else:
            span_id_hex = compute_span_id_hex(span_id_source)

        otlp_attrs = {
            "dify.event.name": str(event_name),
            "dify.event.signal": signal,
            **attributes,
        }
        # OTLP-only parent linkage; never leaks into ``attributes`` / stdout.
        if parent_trace_id is not None:
            otlp_attrs["dify.parent.trace_id"] = parent_trace_id
        if parent_node_execution_id is not None:
            otlp_attrs["dify.parent.node.execution_id"] = parent_node_execution_id
        if parent_workflow_run_id is not None:
            otlp_attrs["dify.parent.workflow.run_id"] = parent_workflow_run_id

        exporter.emit_otel_log(
            event_name=str(event_name),
            body=f"telemetry.{signal}",
            attributes=otlp_attrs,
            trace_id_hex=trace_id_hex or None,
            span_id_hex=span_id_hex or None,
            start_unix_nano=start_unix_nano,
            end_unix_nano=end_unix_nano,
        )
    except Exception:
        _record_otlp_failure(event_name)
