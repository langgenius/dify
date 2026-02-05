from __future__ import annotations

from typing import TYPE_CHECKING

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.events import TelemetryEvent

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager

_ENTERPRISE_ONLY_TRACES: frozenset[TraceTaskName] = frozenset(
    {
        TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
        TraceTaskName.NODE_EXECUTION_TRACE,
        TraceTaskName.PROMPT_GENERATION_TRACE,
    }
)


class TelemetryFacade:
    @staticmethod
    def emit(event: TelemetryEvent, trace_manager: TraceQueueManager | None = None) -> None:
        from core.ops.ops_trace_manager import TraceQueueManager, TraceTask

        if event.name in _ENTERPRISE_ONLY_TRACES and not is_enterprise_telemetry_enabled():
            return

        trace_queue_manager = trace_manager or TraceQueueManager(
            app_id=event.context.app_id,
            user_id=event.context.user_id,
        )
        trace_queue_manager.add_trace_task(
            TraceTask(
                event.name,
                **event.payload,
            )
        )


def is_enterprise_telemetry_enabled() -> bool:
    try:
        from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled
    except Exception:
        return False

    return is_enterprise_telemetry_enabled()


def emit(event: TelemetryEvent, trace_manager: TraceQueueManager | None = None) -> None:
    TelemetryFacade.emit(event, trace_manager=trace_manager)
