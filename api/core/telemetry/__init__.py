"""Community telemetry helpers.

Provides ``emit()`` which enqueues trace events into the CE trace pipeline
(``TraceQueueManager`` → ``ops_trace`` Celery queue → Langfuse / LangSmith / etc.).

Enterprise-only traces (node execution, draft node execution, prompt generation)
are silently dropped when enterprise telemetry is disabled.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.events import TelemetryContext, TelemetryEvent

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager

_ENTERPRISE_ONLY_TRACES: frozenset[TraceTaskName] = frozenset(
    {
        TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
        TraceTaskName.NODE_EXECUTION_TRACE,
        TraceTaskName.PROMPT_GENERATION_TRACE,
    }
)


def _is_enterprise_telemetry_enabled() -> bool:
    try:
        from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled

        return is_enterprise_telemetry_enabled()
    except Exception:
        return False


def emit(event: TelemetryEvent, trace_manager: TraceQueueManager | None = None) -> None:
    from core.ops.ops_trace_manager import TraceQueueManager as LocalTraceQueueManager
    from core.ops.ops_trace_manager import TraceTask

    if event.name in _ENTERPRISE_ONLY_TRACES and not _is_enterprise_telemetry_enabled():
        return

    queue_manager = trace_manager or LocalTraceQueueManager(
        app_id=event.context.app_id,
        user_id=event.context.user_id,
    )
    queue_manager.add_trace_task(TraceTask(event.name, **event.payload))


is_enterprise_telemetry_enabled = _is_enterprise_telemetry_enabled

__all__ = [
    "TelemetryContext",
    "TelemetryEvent",
    "TraceTaskName",
    "emit",
    "is_enterprise_telemetry_enabled",
]
