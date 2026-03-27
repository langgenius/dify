"""Telemetry gateway — single routing layer for all editions.

Maps ``TelemetryCase`` → ``CaseRoute`` and dispatches events to either
the CE/EE trace pipeline (``TraceQueueManager``) or the enterprise-only
metric/log Celery queue.

This module lives in ``core/`` so both CE and EE share one routing table
and one ``emit()`` entry point.  No separate enterprise gateway module is
needed — enterprise-specific dispatch (Celery task, payload offloading)
is handled here behind lazy imports that no-op in CE.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import TYPE_CHECKING, Any

from core.ops.entities.trace_entity import TraceTaskName
from enterprise.telemetry.contracts import CaseRoute, SignalType
from extensions.ext_storage import storage

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager
    from enterprise.telemetry.contracts import TelemetryCase

logger = logging.getLogger(__name__)

PAYLOAD_SIZE_THRESHOLD_BYTES = 1 * 1024 * 1024

# ---------------------------------------------------------------------------
# Routing table — authoritative mapping for all editions
# ---------------------------------------------------------------------------

_case_to_trace_task: dict[TelemetryCase, TraceTaskName] | None = None
_case_routing: dict[TelemetryCase, CaseRoute] | None = None


def _get_case_to_trace_task() -> dict[TelemetryCase, TraceTaskName]:
    global _case_to_trace_task
    if _case_to_trace_task is None:
        from enterprise.telemetry.contracts import TelemetryCase

        _case_to_trace_task = {
            TelemetryCase.WORKFLOW_RUN: TraceTaskName.WORKFLOW_TRACE,
            TelemetryCase.MESSAGE_RUN: TraceTaskName.MESSAGE_TRACE,
            TelemetryCase.NODE_EXECUTION: TraceTaskName.NODE_EXECUTION_TRACE,
            TelemetryCase.DRAFT_NODE_EXECUTION: TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
            TelemetryCase.PROMPT_GENERATION: TraceTaskName.PROMPT_GENERATION_TRACE,
            TelemetryCase.TOOL_EXECUTION: TraceTaskName.TOOL_TRACE,
            TelemetryCase.MODERATION_CHECK: TraceTaskName.MODERATION_TRACE,
            TelemetryCase.SUGGESTED_QUESTION: TraceTaskName.SUGGESTED_QUESTION_TRACE,
            TelemetryCase.DATASET_RETRIEVAL: TraceTaskName.DATASET_RETRIEVAL_TRACE,
            TelemetryCase.GENERATE_NAME: TraceTaskName.GENERATE_NAME_TRACE,
        }
    return _case_to_trace_task


def get_trace_task_to_case() -> dict[TraceTaskName, TelemetryCase]:
    """Return TraceTaskName → TelemetryCase (inverse of _get_case_to_trace_task)."""
    return {v: k for k, v in _get_case_to_trace_task().items()}


def _get_case_routing() -> dict[TelemetryCase, CaseRoute]:
    global _case_routing
    if _case_routing is None:
        from enterprise.telemetry.contracts import CaseRoute, SignalType, TelemetryCase

        _case_routing = {
            # TRACE — CE-eligible (flow in both CE and EE)
            TelemetryCase.WORKFLOW_RUN: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
            TelemetryCase.MESSAGE_RUN: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
            TelemetryCase.TOOL_EXECUTION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
            TelemetryCase.MODERATION_CHECK: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
            TelemetryCase.SUGGESTED_QUESTION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
            TelemetryCase.DATASET_RETRIEVAL: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
            TelemetryCase.GENERATE_NAME: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
            # TRACE — enterprise-only
            TelemetryCase.NODE_EXECUTION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=False),
            TelemetryCase.DRAFT_NODE_EXECUTION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=False),
            TelemetryCase.PROMPT_GENERATION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=False),
            # METRIC_LOG — enterprise-only (signal-driven, not trace)
            TelemetryCase.APP_CREATED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
            TelemetryCase.APP_UPDATED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
            TelemetryCase.APP_DELETED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
            TelemetryCase.FEEDBACK_CREATED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
        }
    return _case_routing


def __getattr__(name: str) -> dict:
    """Lazy module-level access to routing tables."""
    if name == "CASE_ROUTING":
        return _get_case_routing()
    if name == "CASE_TO_TRACE_TASK":
        return _get_case_to_trace_task()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


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


def emit(
    case: TelemetryCase,
    context: dict[str, Any],
    payload: dict[str, Any],
    trace_manager: TraceQueueManager | None = None,
) -> None:
    """Route a telemetry event to the correct pipeline.

    TRACE events are enqueued into ``TraceQueueManager`` (works in both CE
    and EE).  Enterprise-only traces are silently dropped when EE is
    disabled.

    METRIC_LOG events are dispatched to the enterprise Celery queue;
    silently dropped when enterprise telemetry is unavailable.
    """
    route = _get_case_routing().get(case)
    if route is None:
        logger.warning("Unknown telemetry case: %s, dropping event", case)
        return

    if not route.ce_eligible and not is_enterprise_telemetry_enabled():
        logger.debug("Dropping EE-only event: case=%s (EE disabled)", case)
        return

    if route.signal_type == SignalType.TRACE:
        _emit_trace(case, context, payload, trace_manager)
    else:
        _emit_metric_log(case, context, payload)


def _emit_trace(
    case: TelemetryCase,
    context: dict[str, Any],
    payload: dict[str, Any],
    trace_manager: TraceQueueManager | None,
) -> None:
    from core.ops.ops_trace_manager import TraceQueueManager as LocalTraceQueueManager
    from core.ops.ops_trace_manager import TraceTask

    trace_task_name = _get_case_to_trace_task().get(case)
    if trace_task_name is None:
        logger.warning("No TraceTaskName mapping for case: %s", case)
        return

    queue_manager = trace_manager or LocalTraceQueueManager(
        app_id=context.get("app_id"),
        user_id=context.get("user_id"),
    )
    queue_manager.add_trace_task(TraceTask(trace_task_name, user_id=context.get("user_id"), **payload))
    logger.debug("Enqueued trace task: case=%s, app_id=%s", case, context.get("app_id"))


def _emit_metric_log(
    case: TelemetryCase,
    context: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    """Build envelope and dispatch to enterprise Celery queue.

    No-ops when the enterprise telemetry task is not importable (CE mode).
    """
    try:
        from tasks.enterprise_telemetry_task import process_enterprise_telemetry
    except ImportError:
        logger.debug("Enterprise metric/log dispatch unavailable, dropping: case=%s", case)
        return

    tenant_id = context.get("tenant_id") or ""
    event_id = str(uuid.uuid4())

    payload_for_envelope, payload_ref = _handle_payload_sizing(payload, tenant_id, event_id)

    from enterprise.telemetry.contracts import TelemetryEnvelope

    envelope = TelemetryEnvelope(
        case=case,
        tenant_id=tenant_id,
        event_id=event_id,
        payload=payload_for_envelope,
        metadata={"payload_ref": payload_ref} if payload_ref else None,
    )

    process_enterprise_telemetry.delay(envelope.model_dump_json())
    logger.debug(
        "Enqueued metric/log event: case=%s, tenant_id=%s, event_id=%s",
        case,
        tenant_id,
        event_id,
    )
