"""Telemetry facade.

Thin public API for emitting telemetry events.  All routing logic
lives in ``core.telemetry.gateway`` which is shared by both CE and EE.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.events import TelemetryContext, TelemetryEvent
from core.telemetry.gateway import emit as gateway_emit
from core.telemetry.gateway import get_trace_task_to_case

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager


def emit(event: TelemetryEvent, trace_manager: TraceQueueManager | None = None) -> None:
    """Emit a telemetry event.

    Translates the ``TelemetryEvent`` (keyed by ``TraceTaskName``) into a
    ``TelemetryCase`` and delegates to ``core.telemetry.gateway.emit()``.
    """
    case = get_trace_task_to_case().get(event.name)
    if case is None:
        return

    context: dict[str, object] = {
        "tenant_id": event.context.tenant_id,
        "user_id": event.context.user_id,
        "app_id": event.context.app_id,
    }
    gateway_emit(case, context, event.payload, trace_manager)


__all__ = [
    "TelemetryContext",
    "TelemetryEvent",
    "TraceTaskName",
    "emit",
]
