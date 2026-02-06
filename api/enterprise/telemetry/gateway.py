"""Telemetry gateway routing configuration and implementation.

This module defines the routing table that maps telemetry cases to their
processing routes (trace vs metric/log) and customer engagement eligibility.
It also provides the TelemetryGateway class that routes events to the
appropriate processing path.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import TYPE_CHECKING, Any

from enterprise.telemetry.contracts import CaseRoute, TelemetryCase, TelemetryEnvelope
from extensions.ext_storage import storage

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager

logger = logging.getLogger(__name__)

PAYLOAD_SIZE_THRESHOLD_BYTES = 1 * 1024 * 1024

CASE_TO_TRACE_TASK_NAME: dict[TelemetryCase, str] = {
    TelemetryCase.WORKFLOW_RUN: "workflow",
    TelemetryCase.MESSAGE_RUN: "message",
    TelemetryCase.NODE_EXECUTION: "node_execution",
    TelemetryCase.DRAFT_NODE_EXECUTION: "draft_node_execution",
    TelemetryCase.PROMPT_GENERATION: "prompt_generation",
}

CASE_ROUTING: dict[TelemetryCase, CaseRoute] = {
    TelemetryCase.WORKFLOW_RUN: CaseRoute(signal_type="trace", ce_eligible=True),
    TelemetryCase.MESSAGE_RUN: CaseRoute(signal_type="trace", ce_eligible=True),
    TelemetryCase.NODE_EXECUTION: CaseRoute(signal_type="trace", ce_eligible=False),
    TelemetryCase.DRAFT_NODE_EXECUTION: CaseRoute(signal_type="trace", ce_eligible=False),
    TelemetryCase.PROMPT_GENERATION: CaseRoute(signal_type="trace", ce_eligible=False),
    TelemetryCase.APP_CREATED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.APP_UPDATED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.APP_DELETED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.FEEDBACK_CREATED: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.TOOL_EXECUTION: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.MODERATION_CHECK: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.SUGGESTED_QUESTION: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.DATASET_RETRIEVAL: CaseRoute(signal_type="metric_log", ce_eligible=False),
    TelemetryCase.GENERATE_NAME: CaseRoute(signal_type="metric_log", ce_eligible=False),
}


def is_gateway_enabled() -> bool:
    """Check if the telemetry gateway is enabled via feature flag.

    Returns:
        True if ENTERPRISE_TELEMETRY_GATEWAY_ENABLED is set to a truthy value.
    """
    return os.environ.get("ENTERPRISE_TELEMETRY_GATEWAY_ENABLED", "").lower() in ("true", "1", "yes")


def _is_enterprise_telemetry_enabled() -> bool:
    try:
        from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled

        return is_enterprise_telemetry_enabled()
    except Exception:
        return False


is_enterprise_telemetry_enabled = _is_enterprise_telemetry_enabled


class TelemetryGateway:
    """Gateway for routing telemetry events to appropriate processing paths.

    Routes trace-shaped events to TraceQueueManager and metric/log events
    to the enterprise telemetry Celery queue. Handles CE eligibility checks,
    large payload storage, and feature flag gating.
    """

    def emit(
        self,
        case: TelemetryCase,
        context: dict[str, Any],
        payload: dict[str, Any],
        trace_manager: TraceQueueManager | None = None,
    ) -> None:
        """Emit a telemetry event through the gateway.

        Routes the event based on its case type:
        - trace: Routes to TraceQueueManager for existing trace pipeline
        - metric_log: Routes to enterprise telemetry Celery task

        Args:
            case: The telemetry case type.
            context: Event context containing tenant_id, app_id, user_id.
            payload: The event payload data.
            trace_manager: Optional TraceQueueManager for trace routing.
        """
        if not is_gateway_enabled():
            logger.debug("Gateway disabled, using legacy path for case=%s", case)
            self._emit_legacy(case, context, payload, trace_manager)
            return

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

        if route.signal_type == "trace":
            self._emit_trace(case, context, payload, route, trace_manager)
        else:
            self._emit_metric_log(case, context, payload)

    def _emit_legacy(
        self,
        case: TelemetryCase,
        context: dict[str, Any],
        payload: dict[str, Any],
        trace_manager: TraceQueueManager | None,
    ) -> None:
        """Emit using legacy path (TelemetryFacade behavior).

        Used when gateway feature flag is disabled.
        """
        route = CASE_ROUTING.get(case)
        if route is None or route.signal_type != "trace":
            return

        trace_task_name_str = CASE_TO_TRACE_TASK_NAME.get(case)
        if trace_task_name_str is None:
            return

        if not route.ce_eligible and not _is_enterprise_telemetry_enabled():
            return

        from core.ops.entities.trace_entity import TraceTaskName
        from core.ops.ops_trace_manager import (
            TraceQueueManager as LocalTraceQueueManager,
        )
        from core.ops.ops_trace_manager import (
            TraceTask,
        )

        try:
            trace_task_name = TraceTaskName(trace_task_name_str)
        except ValueError:
            logger.warning("Invalid trace task name: %s", trace_task_name_str)
            return

        queue_manager = trace_manager or LocalTraceQueueManager(
            app_id=context.get("app_id"),
            user_id=context.get("user_id"),
        )

        queue_manager.add_trace_task(
            TraceTask(
                trace_task_name,
                **payload,
            )
        )

    def _emit_trace(
        self,
        case: TelemetryCase,
        context: dict[str, Any],
        payload: dict[str, Any],
        route: CaseRoute,
        trace_manager: TraceQueueManager | None,
    ) -> None:
        """Emit a trace-shaped event to TraceQueueManager.

        Args:
            case: The telemetry case type.
            context: Event context.
            payload: The event payload.
            route: Routing configuration for this case.
            trace_manager: Optional TraceQueueManager.
        """
        from core.ops.entities.trace_entity import TraceTaskName
        from core.ops.ops_trace_manager import (
            TraceQueueManager as LocalTraceQueueManager,
        )
        from core.ops.ops_trace_manager import (
            TraceTask,
        )

        if not route.ce_eligible and not _is_enterprise_telemetry_enabled():
            logger.debug(
                "Dropping enterprise-only trace event: case=%s (EE disabled)",
                case,
            )
            return

        trace_task_name_str = CASE_TO_TRACE_TASK_NAME.get(case)
        if trace_task_name_str is None:
            logger.warning("No TraceTaskName mapping for case: %s", case)
            return

        try:
            trace_task_name = TraceTaskName(trace_task_name_str)
        except ValueError:
            logger.warning("Invalid trace task name: %s", trace_task_name_str)
            return

        queue_manager = trace_manager or LocalTraceQueueManager(
            app_id=context.get("app_id"),
            user_id=context.get("user_id"),
        )

        queue_manager.add_trace_task(
            TraceTask(
                trace_task_name,
                **payload,
            )
        )
        logger.debug(
            "Enqueued trace task: case=%s, app_id=%s",
            case,
            context.get("app_id"),
        )

    def _emit_metric_log(
        self,
        case: TelemetryCase,
        context: dict[str, Any],
        payload: dict[str, Any],
    ) -> None:
        """Emit a metric/log event to the enterprise telemetry Celery queue.

        Args:
            case: The telemetry case type.
            context: Event context containing tenant_id.
            payload: The event payload.
        """
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
        """Handle large payload storage.

        If payload exceeds threshold, stores to shared storage and returns
        a reference. Otherwise returns payload as-is.

        Args:
            payload: The event payload.
            tenant_id: Tenant identifier for storage path.
            event_id: Event identifier for storage path.

        Returns:
            Tuple of (payload_for_envelope, payload_ref).
            If stored, payload_for_envelope is empty and payload_ref is set.
            Otherwise, payload_for_envelope is the original payload and
            payload_ref is None.
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


_gateway: TelemetryGateway | None = None


def get_gateway() -> TelemetryGateway:
    """Get the module-level gateway instance.

    Returns:
        The singleton TelemetryGateway instance.
    """
    global _gateway
    if _gateway is None:
        _gateway = TelemetryGateway()
    return _gateway


def emit(
    case: TelemetryCase,
    context: dict[str, Any],
    payload: dict[str, Any],
    trace_manager: TraceQueueManager | None = None,
) -> None:
    """Emit a telemetry event through the gateway.

    Convenience function that uses the module-level gateway instance.

    Args:
        case: The telemetry case type.
        context: Event context containing tenant_id, app_id, user_id.
        payload: The event payload data.
        trace_manager: Optional TraceQueueManager for trace routing.
    """
    get_gateway().emit(case, context, payload, trace_manager)
