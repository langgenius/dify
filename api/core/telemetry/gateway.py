"""Telemetry gateway — single routing layer for all editions.

Dispatches ``TelemetryEvent`` instances to either the trace pipeline
or the enterprise-only metric/log Celery queue.  Each event class
carries its own routing metadata (``signal_type``, ``ce_eligible``, and
``trace_payload`` for trace signals), so this module contains no
per-case mapping tables.

This module lives in ``core/`` so both CE and EE share one
``emit()`` entry point.  Enterprise-specific dispatch (Celery task,
payload offloading) is handled here behind lazy imports that no-op
in CE.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, cast

from core.telemetry.events import TelemetryEvent, TraceSignalEvent
from enterprise.telemetry.contracts import SignalType
from extensions.ext_storage import storage
from extensions.tracing import create_trace_scope_for_app

logger = logging.getLogger(__name__)


PAYLOAD_SIZE_THRESHOLD_BYTES = 1 * 1024 * 1024


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def is_enterprise_telemetry_enabled() -> bool:
    try:
        from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled

        return is_enterprise_telemetry_enabled()
    except Exception:
        return False


def _handle_payload_sizing(
    payload: dict[str, Any],
    tenant_id: str,
    event_id: str,
) -> tuple[dict[str, Any], str | None]:
    """Inline or offload payload based on size.

    Returns ``(payload_for_envelope, storage_key | None)``.  Payloads
    exceeding ``PAYLOAD_SIZE_THRESHOLD_BYTES`` are written to object
    storage and replaced with an empty dict in the envelope.
    """
    try:
        payload_json = json.dumps(payload)
        payload_size = len(payload_json.encode("utf-8"))
    except (TypeError, ValueError):
        logger.warning("Failed to serialize payload for sizing: event_id=%s", event_id)
        return payload, None

    if payload_size <= PAYLOAD_SIZE_THRESHOLD_BYTES:
        return payload, None

    storage_key = f"telemetry/{tenant_id}/{event_id}.json"
    try:
        storage.save(storage_key, payload_json.encode("utf-8"))
        logger.debug("Stored large payload to storage: key=%s, size=%d", storage_key, payload_size)
        return {}, storage_key
    except Exception:
        logger.warning("Failed to store large payload, inlining instead: event_id=%s", event_id, exc_info=True)
        return payload, None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def emit(event: TelemetryEvent) -> None:
    """Emit a telemetry event."""
    if not event.ce_eligible and not is_enterprise_telemetry_enabled():
        logger.debug("Dropping EE-only event: case=%s (EE disabled)", event.case)
        return

    if event.signal_type == SignalType.TRACE:
        _emit_trace(event)
    else:
        _emit_metric_log(event)


# ---------------------------------------------------------------------------
# Internal dispatch
# ---------------------------------------------------------------------------


def _emit_trace(event: TelemetryEvent) -> None:
    if not isinstance(event, TraceSignalEvent):
        logger.warning("Trace signal without a trace payload: case=%s", event.case)
        return
    ctx = event.context
    if ctx.tenant_id is None:
        logger.warning("Trace signal without a workspace: case=%s", event.case)
        return
    scope = create_trace_scope_for_app(tenant_id=ctx.tenant_id, app_id=ctx.app_id, user_id=ctx.user_id, extras={})
    if scope is not None:
        scope.emit(event.trace_payload())


def _emit_metric_log(event: TelemetryEvent) -> None:
    """Build envelope and dispatch to enterprise Celery queue.

    No-ops when the enterprise telemetry task is not importable (CE mode).
    """
    try:
        from tasks.enterprise_telemetry_task import process_enterprise_telemetry
    except ImportError:
        logger.debug("Enterprise metric/log dispatch unavailable, dropping: case=%s", event.case)
        return

    tenant_id = event.context.tenant_id or ""
    event_id = str(uuid.uuid4())

    payload_for_envelope, payload_ref = _handle_payload_sizing(cast(dict[str, Any], event.payload), tenant_id, event_id)

    from enterprise.telemetry.contracts import TelemetryEnvelope

    envelope = TelemetryEnvelope(
        case=event.case,
        tenant_id=tenant_id,
        event_id=event_id,
        payload=payload_for_envelope,
        metadata={"payload_ref": payload_ref} if payload_ref else None,
    )

    process_enterprise_telemetry.delay(envelope.model_dump_json())
    logger.debug(
        "Enqueued metric/log event: case=%s, tenant_id=%s, event_id=%s",
        event.case,
        tenant_id,
        event_id,
    )
