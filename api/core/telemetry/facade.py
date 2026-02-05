from __future__ import annotations

from typing import TYPE_CHECKING

from core.telemetry.events import TelemetryEvent

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager


class TelemetryFacade:
    @staticmethod
    def emit(event: TelemetryEvent, trace_manager: TraceQueueManager | None = None) -> None:
        from core.ops.ops_trace_manager import TraceQueueManager, TraceTask, TraceTaskName

        trace_task_name_map = {
            "draft_node_execution": TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
            "dataset_retrieval": TraceTaskName.DATASET_RETRIEVAL_TRACE,
            "generate_name": TraceTaskName.GENERATE_NAME_TRACE,
            "message": TraceTaskName.MESSAGE_TRACE,
            "moderation": TraceTaskName.MODERATION_TRACE,
            "node_execution": TraceTaskName.NODE_EXECUTION_TRACE,
            "prompt_generation": TraceTaskName.PROMPT_GENERATION_TRACE,
            "suggested_question": TraceTaskName.SUGGESTED_QUESTION_TRACE,
            "tool": TraceTaskName.TOOL_TRACE,
            "workflow": TraceTaskName.WORKFLOW_TRACE,
        }

        trace_task_name = trace_task_name_map.get(event.name)
        if not trace_task_name:
            return

        trace_queue_manager = trace_manager or TraceQueueManager(
            app_id=event.context.app_id,
            user_id=event.context.user_id,
        )
        trace_queue_manager.add_trace_task(
            TraceTask(
                trace_task_name,
                **event.payload,
            )
        )


def is_telemetry_enabled() -> bool:
    try:
        from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled
    except Exception:
        return False

    return is_enterprise_telemetry_enabled()


def emit(event: TelemetryEvent, trace_manager: TraceQueueManager | None = None) -> None:
    TelemetryFacade.emit(event, trace_manager=trace_manager)
