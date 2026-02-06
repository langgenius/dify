"""Telemetry gateway routing and dispatch.

Maps ``TelemetryCase`` → ``CaseRoute`` (signal type + CE eligibility)
and dispatches events to either the trace pipeline or the metric/log
Celery queue.

Singleton lifecycle is managed by ``ext_enterprise_telemetry.init_app()``
which creates the instance during single-threaded Flask app startup.
Access via ``ext_enterprise_telemetry.get_gateway()``.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import TYPE_CHECKING, Any

from core.ops.entities.trace_entity import TraceTaskName
from enterprise.telemetry.contracts import CaseRoute, SignalType, TelemetryCase, TelemetryEnvelope
from extensions.ext_storage import storage

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager

logger = logging.getLogger(__name__)

PAYLOAD_SIZE_THRESHOLD_BYTES = 1 * 1024 * 1024

CASE_TO_TRACE_TASK: dict[TelemetryCase, TraceTaskName] = {
    TelemetryCase.WORKFLOW_RUN: TraceTaskName.WORKFLOW_TRACE,
    TelemetryCase.MESSAGE_RUN: TraceTaskName.MESSAGE_TRACE,
    TelemetryCase.NODE_EXECUTION: TraceTaskName.NODE_EXECUTION_TRACE,
    TelemetryCase.DRAFT_NODE_EXECUTION: TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
    TelemetryCase.PROMPT_GENERATION: TraceTaskName.PROMPT_GENERATION_TRACE,
}

CASE_ROUTING: dict[TelemetryCase, CaseRoute] = {
    TelemetryCase.WORKFLOW_RUN: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
    TelemetryCase.MESSAGE_RUN: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=True),
    TelemetryCase.NODE_EXECUTION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=False),
    TelemetryCase.DRAFT_NODE_EXECUTION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=False),
    TelemetryCase.PROMPT_GENERATION: CaseRoute(signal_type=SignalType.TRACE, ce_eligible=False),
    TelemetryCase.APP_CREATED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.APP_UPDATED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.APP_DELETED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.FEEDBACK_CREATED: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.TOOL_EXECUTION: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.MODERATION_CHECK: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.SUGGESTED_QUESTION: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.DATASET_RETRIEVAL: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
    TelemetryCase.GENERATE_NAME: CaseRoute(signal_type=SignalType.METRIC_LOG, ce_eligible=False),
}


def _is_enterprise_telemetry_enabled() -> bool:
    try:
        from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled

        return is_enterprise_telemetry_enabled()
    except Exception:
        return False


def _should_drop_ee_only_event(route: CaseRoute) -> bool:
    """Return True when the event is enterprise-only and EE telemetry is disabled."""
    return not route.ce_eligible and not _is_enterprise_telemetry_enabled()


class TelemetryGateway:
    """Routes telemetry events to the trace pipeline or the metric/log Celery queue.

    Stateless — instantiated once during ``ext_enterprise_telemetry.init_app()``
    and shared for the lifetime of the process.
    """

    def emit(
        self,
        case: TelemetryCase,
        context: dict[str, Any],
        payload: dict[str, Any],
        trace_manager: TraceQueueManager | None = None,
    ) -> None:
        route = CASE_ROUTING.get(case)
        if route is None:
            logger.warning("Unknown telemetry case: %s, dropping event", case)
            return

        logger.debug(
            "Gateway routing: case=%s, signal_type=%s, ce_eligible=%s",
            case,
            route.signal_type,
            route.ce_eligible,
        )

        if route.signal_type is SignalType.TRACE:
            self._emit_trace(case, context, payload, route, trace_manager)
        else:
            self._emit_metric_log(case, context, payload)

    def _emit_trace(
        self,
        case: TelemetryCase,
        context: dict[str, Any],
        payload: dict[str, Any],
        route: CaseRoute,
        trace_manager: TraceQueueManager | None,
    ) -> None:
        from core.ops.ops_trace_manager import TraceQueueManager as LocalTraceQueueManager
        from core.ops.ops_trace_manager import TraceTask

        if _should_drop_ee_only_event(route):
            logger.debug("Dropping enterprise-only trace event: case=%s (EE disabled)", case)
            return

        trace_task_name = CASE_TO_TRACE_TASK.get(case)
        if trace_task_name is None:
            logger.warning("No TraceTaskName mapping for case: %s", case)
            return

        queue_manager = trace_manager or LocalTraceQueueManager(
            app_id=context.get("app_id"),
            user_id=context.get("user_id"),
        )

        queue_manager.add_trace_task(TraceTask(trace_task_name, **payload))
        logger.debug("Enqueued trace task: case=%s, app_id=%s", case, context.get("app_id"))

    def _emit_metric_log(
        self,
        case: TelemetryCase,
        context: dict[str, Any],
        payload: dict[str, Any],
    ) -> None:
        from tasks.enterprise_telemetry_task import process_enterprise_telemetry

        tenant_id = context.get("tenant_id", "")
        event_id = str(uuid.uuid4())

        payload_for_envelope, payload_ref = self._handle_payload_sizing(payload, tenant_id, event_id)

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

    def _handle_payload_sizing(
        self,
        payload: dict[str, Any],
        tenant_id: str,
        event_id: str,
    ) -> tuple[dict[str, Any], str | None]:
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


def emit(
    case: TelemetryCase,
    context: dict[str, Any],
    payload: dict[str, Any],
    trace_manager: TraceQueueManager | None = None,
) -> None:
    """Module-level convenience wrapper.

    Fetches the gateway singleton from the extension; no-ops when
    enterprise telemetry is disabled (gateway is ``None``).
    """
    from extensions.ext_enterprise_telemetry import get_gateway

    gateway = get_gateway()
    if gateway is not None:
        gateway.emit(case, context, payload, trace_manager)
